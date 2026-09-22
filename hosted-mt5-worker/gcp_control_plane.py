"""Authenticated Google Compute worker transport for the ZenCore control plane.

The worker obtains a Google-signed instance identity from the metadata server for
each request.  The control plane pins that token to one project, zone, instance
and attached service account.  Broker plaintext must never be sent by this
client; only the encrypted lease envelope may travel from ZenCore to the cell.
"""

from __future__ import annotations

import json
import re
import ssl
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from typing import Any, Callable


METADATA_IDENTITY_ENDPOINT = (
    "http://metadata.google.internal/computeMetadata/v1/instance/"
    "service-accounts/default/identity"
)
_UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
    re.IGNORECASE,
)
_CELL_RE = re.compile(r"^[a-z]([-a-z0-9]{0,61}[a-z0-9])?$")
_JWT_RE = re.compile(r"^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$")
_FORBIDDEN_PLAINTEXT_KEYS = {
    "login", "password", "server", "mt5login", "mt5password", "mt5server",
    "brokerlogin", "brokerpassword", "brokerserver", "credential", "credentials",
}


class ControlPlaneError(RuntimeError):
    """Fail-closed transport error without response bodies or credentials."""


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


def _exact_https_origin(value: str) -> str:
    try:
        parsed = urllib.parse.urlsplit(str(value))
        port = parsed.port
    except (TypeError, ValueError) as exc:
        raise ValueError("control_plane_url must be an exact HTTPS origin") from exc
    if (
        parsed.scheme != "https"
        or not parsed.hostname
        or parsed.username is not None
        or parsed.password is not None
        or parsed.path not in ("", "/")
        or parsed.query
        or parsed.fragment
    ):
        raise ValueError("control_plane_url must be an exact HTTPS origin")
    if not re.fullmatch(r"[A-Za-z0-9.-]+", parsed.hostname):
        raise ValueError("control_plane_url host is invalid")
    default_port = "" if port in (None, 443) else f":{port}"
    return f"https://{parsed.hostname.lower()}{default_port}"


def _response_bytes(response: Any, maximum: int) -> bytes:
    payload = response.read(maximum + 1)
    if not isinstance(payload, bytes) or len(payload) > maximum:
        raise ControlPlaneError("Remote response was invalid")
    return payload


def _header(response: Any, name: str) -> str:
    headers = getattr(response, "headers", None)
    if headers is None:
        return ""
    getter = getattr(headers, "get", None)
    return str(getter(name, "") if callable(getter) else "")


def _contains_plaintext_credential(value: Any) -> bool:
    if isinstance(value, dict):
        for key, child in value.items():
            compact = re.sub(r"[^a-z0-9]", "", str(key).lower())
            if compact in _FORBIDDEN_PLAINTEXT_KEYS or _contains_plaintext_credential(child):
                return True
    elif isinstance(value, (list, tuple)):
        return any(_contains_plaintext_credential(item) for item in value)
    return False


class GcpControlPlaneClient:
    """HTTPS client authenticated with a full Google instance identity JWT."""

    def __init__(
        self,
        control_plane_url: str,
        *,
        opener: Callable[[urllib.request.Request, float], Any] | None = None,
        timeout: float = 10.0,
        clock: Callable[[], float] = time.time,
        uuid_factory: Callable[[], uuid.UUID] = uuid.uuid4,
    ) -> None:
        self.origin = _exact_https_origin(control_plane_url)
        self.audience = f"{self.origin}/api/hosted-execution"
        self._open = opener or _default_open
        self._timeout = max(2.0, min(30.0, float(timeout)))
        self._clock = clock
        self._uuid_factory = uuid_factory

    def _instance_identity(self) -> str:
        query = urllib.parse.urlencode(
            {"audience": self.audience, "format": "full", "licenses": "FALSE"}
        )
        request = urllib.request.Request(
            f"{METADATA_IDENTITY_ENDPOINT}?{query}",
            method="GET",
            headers={"Metadata-Flavor": "Google", "Accept": "text/plain"},
        )
        try:
            with self._open(request, self._timeout) as response:
                if _header(response, "Metadata-Flavor").lower() != "google":
                    raise ControlPlaneError("Google metadata identity was not verified")
                token = _response_bytes(response, 20_000).decode("ascii")
        except ControlPlaneError:
            raise
        except (OSError, UnicodeError, urllib.error.URLError) as exc:
            raise ControlPlaneError("Google metadata identity is unavailable") from exc
        if len(token) < 100 or not _JWT_RE.fullmatch(token):
            raise ControlPlaneError("Google metadata identity was invalid")
        return token

    def _post(self, action: str, payload: dict[str, Any]) -> dict[str, Any]:
        if (
            action not in {"assignments", "lease", "heartbeat", "commands/next"}
            and not re.fullmatch(r"commands/[0-9a-fA-F-]{36}/ack", action)
        ):
            raise ValueError("unsupported control-plane action")
        request_payload = dict(payload)
        request_payload["requestId"] = str(self._uuid_factory())
        request_payload["requestTimestamp"] = int(self._clock() * 1000)
        encoded = json.dumps(
            request_payload, separators=(",", ":"), ensure_ascii=True
        ).encode("utf-8")
        if len(encoded) > 32 * 1024:
            raise ControlPlaneError("Control-plane request was too large")
        endpoint = f"{self.audience}/{action}"
        request = urllib.request.Request(
            endpoint,
            data=encoded,
            method="POST",
            headers={
                "Accept": "application/json",
                "Authorization": f"Bearer {self._instance_identity()}",
                "Content-Type": "application/json",
            },
        )
        try:
            with self._open(request, self._timeout) as response:
                final_url = getattr(response, "geturl", lambda: endpoint)()
                if final_url != endpoint:
                    raise ControlPlaneError("Control-plane redirect was rejected")
                if not _header(response, "Content-Type").lower().startswith("application/json"):
                    raise ControlPlaneError("Control-plane response type was invalid")
                raw = _response_bytes(response, 128 * 1024)
        except ControlPlaneError:
            raise
        except urllib.error.HTTPError as exc:
            raise ControlPlaneError(f"Control plane rejected request (HTTP {exc.code})") from None
        except (OSError, urllib.error.URLError) as exc:
            raise ControlPlaneError("Control plane is unavailable") from exc
        try:
            result = json.loads(raw.decode("utf-8"))
        except (UnicodeError, json.JSONDecodeError) as exc:
            raise ControlPlaneError("Control-plane response was invalid") from exc
        if not isinstance(result, dict) or result.get("ok") is not True:
            raise ControlPlaneError("Control plane rejected request")
        return result

    def assignments(self) -> dict[str, Any]:
        return self._post("assignments", {})

    def lease(self, account_id: str, cell_id: str) -> dict[str, Any]:
        if not _UUID_RE.fullmatch(str(account_id)):
            raise ValueError("account_id must be a UUIDv4")
        if not _CELL_RE.fullmatch(str(cell_id)):
            raise ValueError("cell_id is invalid")
        return self._post("lease", {"accountId": account_id, "cellId": cell_id})


    def next_command(self, account_id: str, lease_id: str) -> dict[str, Any]:
        if not _UUID_RE.fullmatch(str(account_id)) or not _UUID_RE.fullmatch(str(lease_id)):
            raise ValueError("hosted command accountId/leaseId must be UUIDv4")
        return self._post("commands/next", {"accountId": account_id, "leaseId": lease_id})

    def acknowledge_command(
        self,
        account_id: str,
        lease_id: str,
        command_id: str,
        *,
        status: str,
        code: str = "",
        message: str = "",
        broker_order_id: str = "",
    ) -> dict[str, Any]:
        if not all(_UUID_RE.fullmatch(str(value)) for value in (account_id, lease_id, command_id)):
            raise ValueError("hosted command identifiers must be UUIDv4")
        clean_status = str(status).upper()
        if clean_status not in {"EXECUTED", "FAILED", "REJECTED"}:
            raise ValueError("hosted command acknowledgement status is invalid")
        payload = {
            "accountId": account_id,
            "leaseId": lease_id,
            "status": clean_status,
            "code": str(code)[:40],
            "message": str(message)[:180],
            "brokerOrderId": str(broker_order_id)[:180],
        }
        return self._post(f"commands/{command_id}/ack", payload)

    def heartbeat(self, payload: dict[str, Any]) -> dict[str, Any]:
        if not isinstance(payload, dict):
            raise ValueError("heartbeat payload must be an object")
        if not _UUID_RE.fullmatch(str(payload.get("accountId", ""))):
            raise ValueError("heartbeat accountId must be a UUIDv4")
        if not _UUID_RE.fullmatch(str(payload.get("leaseId", ""))):
            raise ValueError("heartbeat leaseId must be a UUIDv4")
        if _contains_plaintext_credential(payload):
            raise ValueError("plaintext MT5 credentials are forbidden in heartbeat")
        return self._post("heartbeat", payload)


__all__ = [
    "ControlPlaneError",
    "GcpControlPlaneClient",
    "METADATA_IDENTITY_ENDPOINT",
]
