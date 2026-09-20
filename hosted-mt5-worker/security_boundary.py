"""Security boundary for the ZenCore managed MT5 worker.

This module contains the hard security boundary shared by the managed MT5
worker.  The DEMO execution release still receives unwrap capability only from
an external identity-scoped key service and never persists decrypted MT5 secrets.
"""

from __future__ import annotations

import base64
import json
import math
import os
from dataclasses import dataclass
from typing import Any, Protocol

from cryptography.hazmat.primitives.ciphers.aead import AESGCM


CONTRACT_VERSION = "ZENCORE_ANALYSIS_EXECUTION_V1"
STRATEGY = "NORMAL_3M_SOP_V32"
SCHEMA_VERSION = "32.3-EXIT-STEPLOCK"
ENVELOPE_ALGORITHM = "RSA-OAEP-256+A256GCM"
HOSTED_DEMO_ORDER_EXECUTION_BUILD_UNLOCKED = True
SUPPORTED_MARKETS = (
    "XAUUSD", "EURUSD", "GBPUSD", "USDJPY", "US30", "USDCAD",
    "USDCHF", "EURJPY", "GBPJPY", "EURGBP", "BTCUSD",
)
FORBIDDEN_SECRET_ENVIRONMENT = (
    "MT5_LOGIN", "MT5_PASSWORD", "MT5_SERVER", "MT5_PRIVATE_KEY",
    "ZENCORE_MT5_PRIVATE_KEY", "ZENCORE_BROKER_PASSWORD",
)


class ExternalKeyUnwrapper(Protocol):
    """Implemented by an external HSM/attested-key adapter, never by a file key."""

    def unwrap_rsa_oaep_sha256(self, key_id: str, wrapped_key: bytes) -> bytes:
        """Return a 32-byte AES key after workload identity and IAM checks."""


def _decode_base64url(value: Any, label: str, minimum: int, maximum: int) -> bytes:
    text = str(value or "")
    if not text or any(character not in "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_" for character in text):
        raise RuntimeError(f"{label} is not valid base64url")
    padding = "=" * ((4 - len(text) % 4) % 4)
    try:
        decoded = base64.urlsafe_b64decode(text + padding)
    except (ValueError, TypeError) as exc:
        raise RuntimeError(f"{label} is not valid base64url") from exc
    if not minimum <= len(decoded) <= maximum:
        raise RuntimeError(f"{label} length is invalid")
    return decoded


def _wipe(value: bytearray) -> None:
    for index in range(len(value)):
        value[index] = 0


@dataclass
class Mt5Credential:
    """Short-lived credential buffer; call wipe immediately after MT5 initialize."""

    login: bytearray
    password: bytearray
    server: bytearray
    trade_mode: str
    created_at: int

    def text(self) -> tuple[str, str, str]:
        return (
            self.login.decode("utf-8"),
            self.password.decode("utf-8"),
            self.server.decode("utf-8"),
        )

    def wipe(self) -> None:
        _wipe(self.login)
        _wipe(self.password)
        _wipe(self.server)


def validate_envelope(envelope: Any, expected_key_id: str) -> dict[str, Any]:
    if not isinstance(envelope, dict):
        raise RuntimeError("credential envelope must be an object")
    allowed = {"version", "algorithm", "keyId", "wrappedKey", "iv", "ciphertext"}
    if set(envelope) != allowed:
        raise RuntimeError("credential envelope fields are invalid")
    if envelope.get("version") != 1 or envelope.get("algorithm") != ENVELOPE_ALGORITHM:
        raise RuntimeError("credential envelope version or algorithm is invalid")
    if str(envelope.get("keyId") or "") != expected_key_id:
        raise RuntimeError("credential envelope key id does not match worker assignment")
    return envelope


def decrypt_credential_envelope(
    envelope: Any,
    expected_key_id: str,
    key_unwrapper: ExternalKeyUnwrapper,
) -> Mt5Credential:
    validated = validate_envelope(envelope, expected_key_id)
    wrapped_key = _decode_base64url(validated["wrappedKey"], "wrapped key", 128, 1024)
    iv = _decode_base64url(validated["iv"], "iv", 12, 12)
    ciphertext = _decode_base64url(validated["ciphertext"], "ciphertext", 32, 8192)
    aes_key = bytearray(key_unwrapper.unwrap_rsa_oaep_sha256(expected_key_id, wrapped_key))
    if len(aes_key) != 32:
        _wipe(aes_key)
        raise RuntimeError("external key service returned an invalid AES key")
    plaintext = bytearray()
    try:
        plaintext = bytearray(AESGCM(bytes(aes_key)).decrypt(iv, ciphertext, None))
        parsed = json.loads(plaintext.decode("utf-8"))
        allowed = {"login", "password", "server", "tradeMode", "createdAt"}
        if not isinstance(parsed, dict) or set(parsed) != allowed:
            raise RuntimeError("decrypted MT5 credential fields are invalid")
        login = str(parsed.get("login") or "")
        password = str(parsed.get("password") or "")
        server = str(parsed.get("server") or "")
        trade_mode = str(parsed.get("tradeMode") or "").upper()
        created_at = int(parsed.get("createdAt") or 0)
        if not login.isdigit() or not 2 <= len(login) <= 32:
            raise RuntimeError("decrypted MT5 login is invalid")
        if not password or len(password) > 128:
            raise RuntimeError("decrypted MT5 password is invalid")
        if not 2 <= len(server) <= 120:
            raise RuntimeError("decrypted MT5 server is invalid")
        if trade_mode != "DEMO":
            raise RuntimeError("hosted worker accepts DEMO credentials only")
        if created_at <= 0:
            raise RuntimeError("credential creation time is invalid")
        return Mt5Credential(
            login=bytearray(login.encode("utf-8")),
            password=bytearray(password.encode("utf-8")),
            server=bytearray(server.encode("utf-8")),
            trade_mode=trade_mode,
            created_at=created_at,
        )
    except (ValueError, TypeError, json.JSONDecodeError) as exc:
        raise RuntimeError("credential envelope decryption failed") from exc
    finally:
        _wipe(aes_key)
        if plaintext:
            _wipe(plaintext)


def assert_clean_worker_environment(environment: dict[str, str] | None = None) -> None:
    values = environment if environment is not None else dict(os.environ)
    forbidden = [name for name in FORBIDDEN_SECRET_ENVIRONMENT if values.get(name)]
    if forbidden:
        raise RuntimeError(f"broker secrets are forbidden in worker environment: {', '.join(forbidden)}")


def _finite_number(value: Any, label: str) -> float:
    try:
        result = float(value)
    except (TypeError, ValueError) as exc:
        raise RuntimeError(f"{label} is invalid") from exc
    if not math.isfinite(result):
        raise RuntimeError(f"{label} is invalid")
    return result


def validate_entry_command(payload: Any) -> dict[str, Any]:
    """Verify parity with the signed Analysis snapshot; never derive a trade."""

    if not isinstance(payload, dict):
        raise RuntimeError("entry payload must be an object")
    if payload.get("analysisContractVersion") != CONTRACT_VERSION:
        raise RuntimeError("analysis contract version is invalid")
    snapshot = payload.get("analysisSnapshot")
    if not isinstance(snapshot, dict):
        raise RuntimeError("analysis snapshot is missing")
    if (
        snapshot.get("contractVersion") != CONTRACT_VERSION
        or snapshot.get("decision") != "ENTRY_AUTHORIZED"
        or snapshot.get("decisionOwner") != "ZENCORE_ANALYSIS"
        or snapshot.get("strategy") != STRATEGY
        or snapshot.get("schemaVersion") != SCHEMA_VERSION
    ):
        raise RuntimeError("analysis authorization is invalid")
    symbol = str(snapshot.get("symbol") or "").upper()
    side = str(snapshot.get("side") or "").upper()
    if symbol not in SUPPORTED_MARKETS or side not in {"BUY", "SELL"}:
        raise RuntimeError("analysis symbol or side is invalid")
    for key in ("entry", "sl", "tp1", "tp2", "tp3"):
        snapshot_value = _finite_number(snapshot.get(key), f"snapshot {key}")
        payload_value = _finite_number(payload.get(key), f"payload {key}")
        if snapshot_value != payload_value:
            raise RuntimeError(f"payload {key} does not match Analysis snapshot")
    for key in ("symbol", "side", "strategy", "schemaVersion"):
        if str(payload.get(key) or "") != str(snapshot.get(key) or ""):
            raise RuntimeError(f"payload {key} does not match Analysis snapshot")
    if int(payload.get("signalReceivedAt") or 0) != int(snapshot.get("sourceReceivedAt") or 0):
        raise RuntimeError("payload source time does not match Analysis snapshot")
    return snapshot
