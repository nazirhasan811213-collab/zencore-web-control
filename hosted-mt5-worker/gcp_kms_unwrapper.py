"""Google Cloud KMS adapter for the ZenCore hosted MT5 worker.

The adapter deliberately uses the Compute Engine metadata identity instead of
service-account JSON keys. Cloud KMS performs RSA-OAEP decryption inside the
configured KMS/HSM key; the private key is never returned to the VM.
"""

from __future__ import annotations

import base64
import json
import re
import ssl
import time
import urllib.error
import urllib.request
from typing import Any, Callable


METADATA_TOKEN_URL = (
    "http://metadata.google.internal/computeMetadata/v1/instance/"
    "service-accounts/default/token"
)
KMS_API_ORIGIN = "https://cloudkms.googleapis.com"
KEY_ALIAS_PATTERN = re.compile(r"^[A-Za-z0-9._:-]{3,80}$")
KEY_VERSION_PATTERN = re.compile(
    r"^projects/[a-z][a-z0-9-]{4,28}[a-z0-9]/locations/[a-z0-9-]+/"
    r"keyRings/[A-Za-z0-9_-]{1,63}/cryptoKeys/[A-Za-z0-9_-]{1,63}/"
    r"cryptoKeyVersions/[1-9][0-9]*$"
)


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: ANN001
        return None


_TLS_CONTEXT = ssl.create_default_context()
_TLS_CONTEXT.minimum_version = ssl.TLSVersion.TLSv1_2


def _default_open(request: urllib.request.Request, timeout: float):
    return urllib.request.build_opener(
        urllib.request.ProxyHandler({}),
        _NoRedirect(),
        urllib.request.HTTPSHandler(context=_TLS_CONTEXT),
    ).open(request, timeout=timeout)


def crc32c(data: bytes) -> int:
    """Return the Castagnoli CRC32C used by Cloud KMS integrity fields."""

    value = 0xFFFFFFFF
    for byte in data:
        value ^= byte
        for _ in range(8):
            value = (value >> 1) ^ (0x82F63B78 if value & 1 else 0)
    return (~value) & 0xFFFFFFFF


def _decode_standard_base64(value: Any, label: str, maximum: int) -> bytes:
    text = str(value or "")
    if not text or len(text) > maximum * 2:
        raise RuntimeError(f"{label} is invalid")
    try:
        decoded = base64.b64decode(text, validate=True)
    except (ValueError, TypeError) as exc:
        raise RuntimeError(f"{label} is invalid") from exc
    if not decoded or len(decoded) > maximum:
        raise RuntimeError(f"{label} is invalid")
    return decoded


def _response_json(response: Any, maximum: int) -> dict[str, Any]:
    raw = response.read(maximum + 1)
    if len(raw) > maximum:
        raise RuntimeError("Google Cloud response is too large")
    try:
        parsed = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise RuntimeError("Google Cloud response is invalid") from exc
    if not isinstance(parsed, dict):
        raise RuntimeError("Google Cloud response is invalid")
    return parsed


class GcpMetadataTokenProvider:
    """Short-lived access tokens from the fixed Compute Engine metadata URL."""

    def __init__(
        self,
        opener: Callable[..., Any] | None = None,
        clock: Callable[[], float] | None = None,
    ) -> None:
        self._opener = opener or _default_open
        self._clock = clock or time.time
        self._token = ""
        self._expires_at = 0.0

    def __call__(self) -> str:
        current = self._clock()
        if self._token and current < self._expires_at - 60:
            return self._token
        request = urllib.request.Request(
            METADATA_TOKEN_URL,
            headers={"Metadata-Flavor": "Google", "Accept": "application/json"},
            method="GET",
        )
        try:
            with self._opener(request, timeout=5) as response:
                if str(response.headers.get("Metadata-Flavor", "")) != "Google":
                    raise RuntimeError("Compute metadata identity was not verified")
                payload = _response_json(response, 8192)
        except RuntimeError:
            raise
        except (OSError, urllib.error.URLError, urllib.error.HTTPError) as exc:
            raise RuntimeError("Compute metadata identity is unavailable") from exc
        token = str(payload.get("access_token") or "")
        expires_in = int(payload.get("expires_in") or 0)
        if not 20 <= len(token) <= 4096 or not 120 <= expires_in <= 7200:
            raise RuntimeError("Compute metadata token is invalid")
        self._token = token
        self._expires_at = current + expires_in
        return token


class GcpKmsUnwrapper:
    """Unwrap the per-envelope AES key through Cloud KMS asymmetricDecrypt."""

    def __init__(
        self,
        key_alias: str,
        key_version_resource: str,
        token_provider: Callable[[], str] | None = None,
        opener: Callable[..., Any] | None = None,
    ) -> None:
        if not KEY_ALIAS_PATTERN.fullmatch(str(key_alias or "")):
            raise RuntimeError("Google Cloud KMS key alias is invalid")
        if not KEY_VERSION_PATTERN.fullmatch(str(key_version_resource or "")):
            raise RuntimeError("Google Cloud KMS key version resource is invalid")
        self.key_alias = key_alias
        self.key_version_resource = key_version_resource
        self._token_provider = token_provider or GcpMetadataTokenProvider()
        self._opener = opener or _default_open

    def unwrap_rsa_oaep_sha256(self, key_id: str, wrapped_key: bytes) -> bytes:
        if key_id != self.key_alias:
            raise RuntimeError("credential envelope key id does not match Google Cloud assignment")
        ciphertext = bytes(wrapped_key)
        if not 256 <= len(ciphertext) <= 512:
            raise RuntimeError("wrapped key size does not match an approved RSA key")
        checksum = crc32c(ciphertext)
        body = json.dumps(
            {
                "ciphertext": base64.b64encode(ciphertext).decode("ascii"),
                "ciphertextCrc32c": str(checksum),
            },
            separators=(",", ":"),
        ).encode("utf-8")
        token = self._token_provider()
        if not 20 <= len(str(token or "")) <= 4096:
            raise RuntimeError("Google Cloud workload token is invalid")
        request = urllib.request.Request(
            f"{KMS_API_ORIGIN}/v1/{self.key_version_resource}:asymmetricDecrypt",
            data=body,
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
                "Accept": "application/json",
            },
            method="POST",
        )
        try:
            with self._opener(request, timeout=10) as response:
                payload = _response_json(response, 16384)
        except RuntimeError:
            raise
        except (OSError, urllib.error.URLError, urllib.error.HTTPError) as exc:
            # Never include response bodies because they can contain plaintext.
            raise RuntimeError("Google Cloud KMS unwrap failed") from exc
        if payload.get("verifiedCiphertextCrc32c") is not True:
            raise RuntimeError("Google Cloud KMS rejected ciphertext integrity")
        plaintext = _decode_standard_base64(payload.get("plaintext"), "KMS plaintext", 64)
        if len(plaintext) != 32:
            raise RuntimeError("Google Cloud KMS returned an invalid AES key")
        returned_checksum = payload.get("plaintextCrc32c")
        try:
            checksum_value = int(returned_checksum)
        except (TypeError, ValueError) as exc:
            raise RuntimeError("Google Cloud KMS plaintext checksum is missing") from exc
        if checksum_value != crc32c(plaintext):
            raise RuntimeError("Google Cloud KMS plaintext integrity check failed")
        return plaintext
