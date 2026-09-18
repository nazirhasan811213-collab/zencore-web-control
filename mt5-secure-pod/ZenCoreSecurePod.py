"""ZenCore MT5 Secure Pod agent (DEMO-only first rollout).

This process runs beside MetaTrader 5 on a trader-owned Windows PC or inside a
trader-owned Windows confidential VM.
It never accepts broker login, password, or full server values from ZenCore's
control-plane API. The terminal must already have an enrolled DEMO session.
"""

from __future__ import annotations

import argparse
import base64
import ctypes
import getpass
import hashlib
import hmac
import json
import math
import os
import re
import sqlite3
import ssl
import sys
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

try:
    import MetaTrader5 as mt5
except ImportError as exc:  # pragma: no cover - only available on Windows worker
    raise SystemExit("MetaTrader5 Python package is required inside the Secure Pod") from exc


SUPPORTED_MARKETS = (
    "XAUUSD", "EURUSD", "GBPUSD", "USDJPY", "US30", "USDCAD",
    "USDCHF", "EURJPY", "GBPJPY", "EURGBP", "BTCUSD",
)
MAGIC = 3233001
CONNECTOR_VERSION = "1.4.0-demo-execution"
HOST_OWNERSHIP_MODES = {
    "WINDOWS_PC": "TRADER_OWNED_WINDOWS_PC",
    "AZURE_CONFIDENTIAL_VM": "TRADER_OWNED_AZURE",
}
CONFIG_SCHEMA_VERSION = 1
PRODUCTION_CONTROL_HOST = "zencore-precision-entry.onrender.com"
# Execution still requires the local config switch, the Render control-plane gate,
# an InterStellar DEMO terminal, a signed command and an armed local ledger.
DEMO_ORDER_EXECUTION_BUILD_UNLOCKED = True
DEMO_EXECUTION_MARKETS = ("XAUUSD",)
INTERSTELLAR_DEMO_SERVER_ID = "INTERSTELLARFINANCIALDEMO"
FORBIDDEN_CREDENTIAL_ENVIRONMENT = (
    "MT5_LOGIN",
    "MT5_PASSWORD",
    "MT5_SERVER",
    "ZENCORE_BROKER_LOGIN",
    "ZENCORE_BROKER_PASSWORD",
    "ZENCORE_BROKER_SERVER",
    "ZENCORE_PAIRING_CODE",
    "ZENCORE_POD_TOKEN",
    "ZENCORE_COMMAND_SIGNING_KEY",
)


class _DataBlob(ctypes.Structure):
    _fields_ = [("cbData", ctypes.c_ulong), ("pbData", ctypes.POINTER(ctypes.c_ubyte))]


class _RejectRedirects(urllib.request.HTTPRedirectHandler):
    """Fail closed instead of forwarding pairing material or pod auth on redirects."""

    def redirect_request(self, request: Any, file_pointer: Any, code: int, message: str,
                         headers: Any, new_url: str) -> None:
        return None


TLS_CONTEXT = ssl.create_default_context()
TLS_CONTEXT.minimum_version = ssl.TLSVersion.TLSv1_2
NO_REDIRECT_OPENER = urllib.request.build_opener(
    urllib.request.ProxyHandler({}),
    _RejectRedirects(),
    urllib.request.HTTPSHandler(context=TLS_CONTEXT),
)


class UserCredentialStore:
    """DPAPI-protected pod identity bound to the dedicated trader Windows user."""

    def __init__(self, path: Path):
        self.path = path

    @staticmethod
    def _blob(data: bytes) -> tuple[_DataBlob, Any]:
        buffer = ctypes.create_string_buffer(data)
        blob = _DataBlob(len(data), ctypes.cast(buffer, ctypes.POINTER(ctypes.c_ubyte)))
        return blob, buffer

    @staticmethod
    def _protect(data: bytes) -> bytes:
        if os.name != "nt":
            raise RuntimeError("Secure Pod machine credentials require Windows DPAPI")
        source, source_buffer = UserCredentialStore._blob(data)
        output = _DataBlob()
        description = "ZenCore Secure Pod machine credentials"
        flags = 0x1  # no UI; default DPAPI scope binds to this Windows user profile
        if not ctypes.windll.crypt32.CryptProtectData(
            ctypes.byref(source), description, None, None, None, flags, ctypes.byref(output)
        ):
            raise ctypes.WinError()
        try:
            return ctypes.string_at(output.pbData, output.cbData)
        finally:
            ctypes.windll.kernel32.LocalFree(output.pbData)
            ctypes.memset(source_buffer, 0, len(data))

    @staticmethod
    def _unprotect(data: bytes) -> bytes:
        if os.name != "nt":
            raise RuntimeError("Secure Pod machine credentials require Windows DPAPI")
        source, source_buffer = UserCredentialStore._blob(data)
        output = _DataBlob()
        flags = 0x1
        if not ctypes.windll.crypt32.CryptUnprotectData(
            ctypes.byref(source), None, None, None, None, flags, ctypes.byref(output)
        ):
            raise ctypes.WinError()
        try:
            return ctypes.string_at(output.pbData, output.cbData)
        finally:
            ctypes.windll.kernel32.LocalFree(output.pbData)
            ctypes.memset(source_buffer, 0, len(data))

    def load(self) -> dict[str, str] | None:
        if not self.path.exists():
            return None
        raw = self._unprotect(self.path.read_bytes())
        try:
            parsed = json.loads(raw.decode("utf-8"))
        finally:
            raw = b""
        token = str(parsed.get("podToken", ""))
        signing_key = str(parsed.get("commandSigningKey", ""))
        if not token.startswith("zcpod_") or len(signing_key.encode("utf-8")) < 32:
            raise RuntimeError("Protected Secure Pod machine credentials are invalid")
        return {"podToken": token, "commandSigningKey": signing_key}

    def save(self, credentials: dict[str, str]) -> None:
        encoded = json.dumps(credentials, separators=(",", ":")).encode("utf-8")
        protected = self._protect(encoded)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.path.with_suffix(self.path.suffix + ".tmp")
        temporary.write_bytes(protected)
        os.replace(temporary, self.path)


def pair_trader_owned_pod(
    control_url: str, pairing_code: str, ownership_mode: str
) -> dict[str, str]:
    if not re.fullmatch(r"zcpair_[A-Za-z0-9_-]{40,}", pairing_code):
        raise RuntimeError("One-time pairing code is invalid")
    body = json.dumps({
        "pairingCode": pairing_code,
        "ownershipMode": ownership_mode,
        "connectorVersion": CONNECTOR_VERSION,
    }, separators=(",", ":")).encode("utf-8")
    request = urllib.request.Request(
        f"{control_url}/api/execution/pair",
        data=body,
        method="POST",
        headers={"Accept": "application/json", "Content-Type": "application/json"},
    )
    try:
        with NO_REDIRECT_OPENER.open(request, timeout=15) as response:
            result = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        raise RuntimeError(f"Secure Pod pairing rejected (HTTP {exc.code})") from exc
    token = str(result.get("podToken", ""))
    signing_key = str(result.get("commandSigningKey", ""))
    if not token.startswith("zcpod_") or len(signing_key.encode("utf-8")) < 32:
        raise RuntimeError("Secure Pod pairing response is invalid")
    return {"podToken": token, "commandSigningKey": signing_key}


@dataclass(frozen=True)
class Config:
    control_url: str
    pod_token: str
    signing_key: bytes
    host_profile: str
    terminal_path: str
    ledger_path: Path
    poll_seconds: float
    demo_execution_enabled: bool
    symbol_map: dict[str, str]
    credential_path: Path

    @staticmethod
    def _load_file(config_path: Path | None) -> dict[str, Any]:
        if config_path is None:
            return {}
        try:
            parsed = json.loads(config_path.read_text(encoding="utf-8-sig"))
        except (OSError, json.JSONDecodeError) as exc:
            raise SystemExit(f"Unable to read Secure Pod config: {exc}") from exc
        if not isinstance(parsed, dict):
            raise SystemExit("Secure Pod config must be a JSON object")
        allowed = {
            "schemaVersion",
            "controlUrl",
            "hostProfile",
            "mt5TerminalPath",
            "symbolMap",
            "pollSeconds",
            "demoExecutionEnabled",
            "dataRoot",
        }
        unknown = sorted(set(parsed) - allowed)
        if unknown:
            raise SystemExit(f"Unsupported Secure Pod config fields: {', '.join(unknown)}")
        if parsed.get("schemaVersion") != CONFIG_SCHEMA_VERSION:
            raise SystemExit(f"Secure Pod config schemaVersion must be {CONFIG_SCHEMA_VERSION}")
        return parsed

    @staticmethod
    def load(config_path: Path | None = None, pairing_code: str = "") -> "Config":
        file_config = Config._load_file(config_path)
        environment_mode = config_path is None
        present_forbidden = [name for name in FORBIDDEN_CREDENTIAL_ENVIRONMENT if os.environ.get(name)]
        if present_forbidden:
            raise SystemExit(
                "Credential material is forbidden in Secure Pod environment variables; remove: "
                + ", ".join(present_forbidden)
            )

        control_url = str(
            (os.environ.get("ZENCORE_CONTROL_URL") if environment_mode else None)
            or file_config.get("controlUrl")
            or ""
        ).rstrip("/")
        terminal_path = str(
            (os.environ.get("MT5_TERMINAL_PATH") if environment_mode else None)
            or file_config.get("mt5TerminalPath")
            or ""
        )
        host_profile = str(
            (os.environ.get("ZENCORE_HOST_PROFILE") if environment_mode else None)
            or file_config.get("hostProfile")
            or "AZURE_CONFIDENTIAL_VM"
        ).strip().upper()
        if host_profile not in HOST_OWNERSHIP_MODES:
            raise SystemExit(
                "Secure Pod hostProfile must be WINDOWS_PC or AZURE_CONFIDENTIAL_VM"
            )
        parsed_control_url = urlparse(control_url)
        try:
            control_port = parsed_control_url.port
        except ValueError as exc:
            raise SystemExit("Secure Pod controlUrl port is invalid") from exc
        loopback_http = (
            environment_mode
            and parsed_control_url.scheme == "http"
            and parsed_control_url.hostname in {"127.0.0.1", "localhost"}
        )
        approved_production_origin = (
            parsed_control_url.scheme == "https"
            and parsed_control_url.hostname == PRODUCTION_CONTROL_HOST
            and control_port in {None, 443}
        )
        if (
            (not approved_production_origin and not loopback_http)
            or not parsed_control_url.hostname
            or parsed_control_url.username is not None
            or parsed_control_url.password is not None
            or parsed_control_url.path not in {"", "/"}
            or parsed_control_url.query
            or parsed_control_url.fragment
        ):
            raise SystemExit("Secure Pod controlUrl must be the approved ZenCore HTTPS origin")
        if not terminal_path:
            raise SystemExit("Secure Pod mt5TerminalPath is required")

        raw_map = os.environ.get("ZENCORE_SYMBOL_MAP_JSON") if environment_mode else None
        if raw_map is not None:
            try:
                parsed_map = json.loads(raw_map)
            except json.JSONDecodeError as exc:
                raise SystemExit("ZENCORE_SYMBOL_MAP_JSON is invalid") from exc
        else:
            parsed_map = file_config.get("symbolMap", {})
        if not isinstance(parsed_map, dict):
            raise SystemExit("Secure Pod symbolMap must be a JSON object")
        symbol_map = {
            str(key).upper(): str(value)
            for key, value in parsed_map.items()
            if str(key).upper() in SUPPORTED_MARKETS and str(value).strip()
        }

        poll_seconds_value = (
            os.environ.get("ZENCORE_POLL_SECONDS") if environment_mode else None
        ) or file_config.get("pollSeconds", 2)
        try:
            poll_seconds = max(0.5, float(poll_seconds_value))
        except (TypeError, ValueError) as exc:
            raise SystemExit("Secure Pod pollSeconds must be numeric") from exc

        demo_environment_value = os.environ.get("ZENCORE_DEMO_EXECUTION") if environment_mode else None
        if demo_environment_value is None:
            demo_execution_enabled = file_config.get("demoExecutionEnabled", False)
            if not isinstance(demo_execution_enabled, bool):
                raise SystemExit("Secure Pod demoExecutionEnabled must be true or false")
        else:
            normalised_demo_value = demo_environment_value.strip().lower()
            if normalised_demo_value not in {"0", "1", "false", "true", "no", "yes", "off", "on"}:
                raise SystemExit("ZENCORE_DEMO_EXECUTION must be true or false")
            demo_execution_enabled = normalised_demo_value in {"1", "true", "yes", "on"}
        if demo_execution_enabled and not DEMO_ORDER_EXECUTION_BUILD_UNLOCKED:
            raise SystemExit("This Secure Pod build cannot unlock DEMO order execution")

        platform_data_root = Path(os.environ.get("PROGRAMDATA", Path.cwd())) / "ZenCoreSecurePod"
        default_root = Path(
            (os.environ.get("ZENCORE_DATA_ROOT") if environment_mode else None)
            or file_config.get("dataRoot")
            or platform_data_root
        )
        credential_path = Path(
            (os.environ.get("ZENCORE_MACHINE_CREDENTIAL_PATH") if environment_mode else None)
            or default_root / "machine-credentials.dpapi"
        )
        credential_store = UserCredentialStore(credential_path)
        try:
            protected_credentials = credential_store.load()
        except (OSError, RuntimeError, ValueError, json.JSONDecodeError) as exc:
            raise SystemExit(f"Unable to unlock Secure Pod machine credentials: {exc}") from exc
        pod_token = protected_credentials["podToken"] if protected_credentials else ""
        signing_key_text = protected_credentials["commandSigningKey"] if protected_credentials else ""
        if not pod_token or not signing_key_text:
            if not pairing_code:
                raise SystemExit("Run one-time Secure Pod pairing before starting the worker")
            try:
                paired = pair_trader_owned_pod(
                    control_url, pairing_code, HOST_OWNERSHIP_MODES[host_profile]
                )
                credential_store.save(paired)
            except (OSError, RuntimeError, ValueError, json.JSONDecodeError) as exc:
                raise SystemExit(f"Secure Pod pairing failed: {exc}") from exc
            pod_token = paired["podToken"]
            signing_key_text = paired["commandSigningKey"]
        signing_key = signing_key_text.encode("utf-8")
        if not pod_token.startswith("zcpod_"):
            raise SystemExit("Secure Pod token is missing or invalid")
        if len(signing_key) < 32:
            raise SystemExit("Secure Pod command signing key is invalid")
        ledger_path = Path(
            (os.environ.get("ZENCORE_LEDGER_PATH") if environment_mode else None)
            or default_root / "command-ledger.db"
        )
        return Config(
            control_url=control_url,
            pod_token=pod_token,
            signing_key=signing_key,
            host_profile=host_profile,
            terminal_path=terminal_path,
            ledger_path=ledger_path,
            poll_seconds=poll_seconds,
            demo_execution_enabled=(demo_execution_enabled and DEMO_ORDER_EXECUTION_BUILD_UNLOCKED),
            symbol_map=symbol_map,
            credential_path=credential_path,
        )


class Ledger:
    def __init__(self, path: Path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(path)
        self.db.execute(
            "CREATE TABLE IF NOT EXISTS commands ("
            "id TEXT PRIMARY KEY, status TEXT NOT NULL, result_json TEXT NOT NULL, processed_at INTEGER NOT NULL)"
        )
        self.db.execute(
            "CREATE TABLE IF NOT EXISTS runtime_state (key TEXT PRIMARY KEY, value TEXT NOT NULL)"
        )
        self.db.execute(
            "CREATE TABLE IF NOT EXISTS position_plans (symbol TEXT PRIMARY KEY, data_json TEXT NOT NULL)"
        )
        self.db.commit()

    def previous_result(self, command_id: str) -> tuple[str, dict[str, Any]] | None:
        row = self.db.execute(
            "SELECT status, result_json FROM commands WHERE id = ?", (command_id,)
        ).fetchone()
        return (row[0], json.loads(row[1])) if row else None

    def claim_command(self, command_id: str) -> bool:
        cursor = self.db.execute(
            "INSERT OR IGNORE INTO commands (id, status, result_json, processed_at) "
            "VALUES (?, 'IN_PROGRESS', '{}', ?)",
            (command_id, int(time.time() * 1000)),
        )
        self.db.commit()
        return cursor.rowcount == 1

    def save_result(self, command_id: str, status: str, result: dict[str, Any]) -> None:
        self.db.execute(
            "INSERT OR REPLACE INTO commands (id, status, result_json, processed_at) VALUES (?, ?, ?, ?)",
            (command_id, status, json.dumps(result, separators=(",", ":")), int(time.time() * 1000)),
        )
        self.db.commit()

    def armed(self) -> bool:
        row = self.db.execute("SELECT value FROM runtime_state WHERE key = 'armed'").fetchone()
        return bool(row and row[0] == "1")

    def set_armed(self, armed: bool) -> None:
        self.db.execute(
            "INSERT OR REPLACE INTO runtime_state (key, value) VALUES ('armed', ?)",
            ("1" if armed else "0",),
        )
        self.db.commit()

    def save_plan(self, symbol: str, plan: dict[str, Any]) -> None:
        self.db.execute(
            "INSERT OR REPLACE INTO position_plans (symbol, data_json) VALUES (?, ?)",
            (symbol, json.dumps(plan, separators=(",", ":"))),
        )
        self.db.commit()

    def plans(self) -> list[dict[str, Any]]:
        return [json.loads(row[0]) for row in self.db.execute("SELECT data_json FROM position_plans")]

    def plan(self, symbol: str) -> dict[str, Any] | None:
        row = self.db.execute(
            "SELECT data_json FROM position_plans WHERE symbol = ?", (symbol,)
        ).fetchone()
        return json.loads(row[0]) if row else None

    def delete_plan(self, symbol: str) -> None:
        self.db.execute("DELETE FROM position_plans WHERE symbol = ?", (symbol,))
        self.db.commit()


class ControlPlane:
    def __init__(self, config: Config):
        self.config = config

    def request(self, method: str, path: str, body: dict[str, Any] | None = None) -> dict[str, Any]:
        encoded = None if body is None else json.dumps(body, separators=(",", ":")).encode("utf-8")
        request = urllib.request.Request(
            f"{self.config.control_url}{path}",
            data=encoded,
            method=method,
            headers={
                "Authorization": f"Bearer {self.config.pod_token}",
                "Accept": "application/json",
                **({"Content-Type": "application/json"} if encoded is not None else {}),
            },
        )
        with NO_REDIRECT_OPENER.open(request, timeout=10) as response:
            return json.loads(response.read().decode("utf-8"))

    def heartbeat(self, payload: dict[str, Any]) -> dict[str, Any]:
        return self.request("POST", "/api/execution/heartbeat", payload)

    def next_command(self) -> dict[str, Any] | None:
        return self.request("GET", "/api/execution/commands/next").get("command")

    def acknowledge(self, command_id: str, status: str, result: dict[str, Any]) -> None:
        self.request("POST", f"/api/execution/commands/{command_id}/ack", {"status": status, **result})


class SecurePod:
    def __init__(self, config: Config):
        self.config = config
        self.control = ControlPlane(config)
        self.ledger = Ledger(config.ledger_path)

    @staticmethod
    def mask(value: Any, visible: int = 4) -> str:
        safe = "".join(character for character in str(value or "") if character.isalnum() or character in "._- ")
        if len(safe) <= 2:
            return "****MT5"
        # Never return the full source value, even for unusually short account or
        # server identifiers. At most half of a short value is revealed.
        visible_count = min(visible, max(2, len(safe) // 2))
        tail = safe[-visible_count:]
        return f"****{tail}"

    @staticmethod
    def server_id(value: Any) -> str:
        return re.sub(r"[^A-Z0-9]", "", str(value or "").upper())

    def assert_demo_terminal(self, require_execution: bool = False) -> tuple[Any, Any]:
        account = mt5.account_info()
        terminal = mt5.terminal_info()
        if account is None or terminal is None:
            raise RuntimeError("MT5 account or terminal state unavailable")
        if account.trade_mode != mt5.ACCOUNT_TRADE_MODE_DEMO:
            raise RuntimeError("Secure Pod only permits an MT5 DEMO account")
        if require_execution:
            if self.server_id(account.server) != INTERSTELLAR_DEMO_SERVER_ID:
                raise RuntimeError("DEMO execution only permits InterStellarFinancial-Demo")
            if not bool(account.trade_allowed) or not bool(getattr(account, "trade_expert", False)):
                raise RuntimeError("MT5 DEMO account does not allow expert trading")
            if not bool(terminal.trade_allowed) or bool(terminal.tradeapi_disabled):
                raise RuntimeError("Enable Algo Trading and Python API trading in MT5")
        return account, terminal

    def initialise_terminal(self) -> None:
        if not mt5.initialize(path=self.config.terminal_path):
            raise RuntimeError(f"MT5 initialize failed: {mt5.last_error()}")
        self.assert_demo_terminal(require_execution=self.config.demo_execution_enabled)

    def canonical_symbol(self, broker_symbol: str) -> str | None:
        upper = broker_symbol.upper()
        for canonical, actual in self.config.symbol_map.items():
            if actual.upper() == upper:
                return canonical
        return next((symbol for symbol in SUPPORTED_MARKETS if symbol in upper), None)

    def broker_symbol(self, canonical: str) -> str:
        mapped = self.config.symbol_map.get(canonical, canonical)
        if mt5.symbol_info(mapped) is not None:
            return mapped
        candidates = mt5.symbols_get(group=f"*{canonical}*") or ()
        if not candidates:
            raise RuntimeError(f"Broker symbol not found for {canonical}")
        return candidates[0].name

    def symbol_specs(self) -> list[dict[str, Any]]:
        specs: list[dict[str, Any]] = []
        for canonical in SUPPORTED_MARKETS:
            try:
                info = mt5.symbol_info(self.broker_symbol(canonical))
                if info is None:
                    continue
                specs.append({
                    "symbol": canonical,
                    "tickSize": info.trade_tick_size or info.point,
                    "tickValue": info.trade_tick_value,
                    "volumeMin": info.volume_min,
                    "volumeMax": info.volume_max,
                    "volumeStep": info.volume_step,
                })
            except RuntimeError:
                continue
        return specs

    def zencore_positions(self) -> list[Any]:
        return [position for position in (mt5.positions_get() or ()) if int(position.magic) == MAGIC]

    def positions_payload(self) -> list[dict[str, Any]]:
        payload = []
        counts: dict[str, int] = {}
        for item in self.zencore_positions():
            canonical = self.canonical_symbol(item.symbol)
            if canonical:
                counts[canonical] = counts.get(canonical, 0) + 1
        for position in self.zencore_positions():
            canonical = self.canonical_symbol(position.symbol)
            if not canonical:
                continue
            plan = self.ledger.plan(canonical) or {}
            stage = int(plan.get("lockStage", 0))
            lock_label = ("TP2_LOCKED" if stage >= 3 else "TP1_LOCKED" if stage == 2 else "BREAK_EVEN" if stage == 1 else "INITIAL")
            payload.append({
                "ticket": str(position.ticket),
                "symbol": canonical,
                "side": "BUY" if position.type == mt5.POSITION_TYPE_BUY else "SELL",
                "volume": position.volume,
                "layers": counts.get(canonical, 1),
                "entry": position.price_open,
                "currentPrice": position.price_current,
                "initialSl": plan.get("initialSl", position.sl),
                "activeSl": position.sl,
                "tp1": plan.get("tp1"),
                "tp2": plan.get("tp2"),
                "tp3": plan.get("tp3"),
                "profitUsd": position.profit,
                "openedAt": int(position.time_msc),
                "exitStage": "HOLD",
                "slLock": lock_label,
            })
        return payload

    def heartbeat_payload(self) -> dict[str, Any]:
        account = mt5.account_info()
        terminal = mt5.terminal_info()
        if account is None or terminal is None:
            raise RuntimeError("MT5 account or terminal state unavailable")
        return {
            "accountMask": self.mask(account.login, 4),
            "serverMask": self.mask(account.server, 8),
            "brokerMask": self.mask(account.company, 12),
            "tradeMode": "DEMO" if account.trade_mode == mt5.ACCOUNT_TRADE_MODE_DEMO else "REAL",
            "terminalTradeAllowed": bool(terminal.trade_allowed),
            "accountTradeAllowed": bool(account.trade_allowed),
            "expertTradeAllowed": bool(
                terminal.trade_allowed and not terminal.tradeapi_disabled
                and getattr(account, "trade_expert", False)
            ),
            "demoExecutionUnlocked": bool(
                self.config.demo_execution_enabled
                and account.trade_mode == mt5.ACCOUNT_TRADE_MODE_DEMO
                and self.server_id(account.server) == INTERSTELLAR_DEMO_SERVER_ID
            ),
            "connectorVersion": CONNECTOR_VERSION,
            "terminalBuild": str(terminal.build),
            "symbolSpecs": self.symbol_specs(),
            "positions": self.positions_payload(),
        }

    def verify_command(self, command: dict[str, Any]) -> dict[str, Any]:
        raw = command.get("signedEnvelope", "")
        padding = "=" * (-len(raw) % 4)
        envelope_bytes = base64.urlsafe_b64decode(raw + padding)
        expected = hmac.new(self.config.signing_key, envelope_bytes, hashlib.sha256).hexdigest()
        if not hmac.compare_digest(expected, str(command.get("signature", ""))):
            raise RuntimeError("Command signature is invalid")
        envelope = json.loads(envelope_bytes.decode("utf-8"))
        for key in ("id", "type", "payload", "createdAt", "expiresAt"):
            if envelope.get(key) != command.get(key):
                raise RuntimeError(f"Signed command mismatch: {key}")
        if int(envelope["expiresAt"]) <= int(time.time() * 1000):
            raise RuntimeError("Command expired")
        return envelope

    @staticmethod
    def volume_digits(step: float) -> int:
        text = f"{float(step):.10f}".rstrip("0")
        return len(text.split(".", 1)[1]) if "." in text else 0

    @staticmethod
    def normalise_volume(info: Any, volume: float, rounding: str = "nearest") -> float:
        step = float(info.volume_step)
        ratio = max(0.0, float(volume)) / step
        if rounding == "up":
            steps = math.ceil(ratio - 1e-9)
        elif rounding == "down":
            steps = math.floor(ratio + 1e-9)
        else:
            steps = math.floor(ratio + 0.5 + 1e-9)
        normalised = max(float(info.volume_min), min(float(info.volume_max), steps * step))
        return round(normalised, SecurePod.volume_digits(step))

    @staticmethod
    def success_retcodes() -> set[int]:
        return {
            int(mt5.TRADE_RETCODE_DONE),
            int(getattr(mt5, "TRADE_RETCODE_DONE_PARTIAL", mt5.TRADE_RETCODE_DONE)),
        }

    @staticmethod
    def filling_modes(info: Any) -> list[int]:
        modes: list[int] = []
        flags = int(getattr(info, "filling_mode", 0) or 0)
        if flags & 1:
            modes.append(mt5.ORDER_FILLING_FOK)
        if flags & 2:
            modes.append(mt5.ORDER_FILLING_IOC)
        market_execution = getattr(mt5, "SYMBOL_TRADE_EXECUTION_MARKET", 2)
        if int(getattr(info, "trade_exemode", -1)) != int(market_execution):
            modes.append(mt5.ORDER_FILLING_RETURN)
        if not modes:
            modes.extend([mt5.ORDER_FILLING_FOK, mt5.ORDER_FILLING_IOC])
        return list(dict.fromkeys(modes))

    def checked_deal_request(self, info: Any, request: dict[str, Any]) -> dict[str, Any]:
        errors = []
        for filling_mode in self.filling_modes(info):
            candidate = {**request, "type_filling": filling_mode}
            checked = mt5.order_check(candidate)
            retcode = getattr(checked, "retcode", None)
            if checked is not None and retcode in (0, mt5.TRADE_RETCODE_DONE):
                return candidate
            errors.append(str(getattr(checked, "comment", retcode if retcode is not None else mt5.last_error())))
        raise RuntimeError(f"OrderCheck failed: {'; '.join(errors)[:120]}")

    def send_checked_deal(self, info: Any, request: dict[str, Any]) -> Any:
        checked_request = self.checked_deal_request(info, request)
        result = mt5.order_send(checked_request)
        if result is None or int(result.retcode) not in self.success_retcodes():
            raise RuntimeError(f"OrderSend failed: {getattr(result, 'comment', mt5.last_error())}")
        return result

    def send_market_layer(self, payload: dict[str, Any], layer: int) -> str:
        self.assert_demo_terminal(require_execution=True)
        canonical = payload["symbol"]
        symbol = self.broker_symbol(canonical)
        if not mt5.symbol_select(symbol, True):
            raise RuntimeError(f"Unable to select {canonical}")
        info = mt5.symbol_info(symbol)
        tick = mt5.symbol_info_tick(symbol)
        if info is None or tick is None:
            raise RuntimeError(f"No live tick for {canonical}")
        side = payload["side"]
        order_type = mt5.ORDER_TYPE_BUY if side == "BUY" else mt5.ORDER_TYPE_SELL
        request = {
            "action": mt5.TRADE_ACTION_DEAL,
            "symbol": symbol,
            "volume": self.normalise_volume(info, float(payload["lotPerLayer"])),
            "type": order_type,
            "price": round(tick.ask if side == "BUY" else tick.bid, int(info.digits)),
            "sl": round(float(payload["sl"]), int(info.digits)),
            "tp": 0.0,
            "deviation": 30,
            "magic": MAGIC,
            "comment": f"ZenCore:{str(payload.get('signalReceivedAt', ''))[-8:]}:L{layer}",
            "type_time": mt5.ORDER_TIME_GTC,
        }
        result = self.send_checked_deal(info, request)
        return str(result.order or result.deal)

    def validate_setup_payload(self, payload: dict[str, Any]) -> None:
        if payload.get("strategy") != "NORMAL_3M_SOP_V32" or payload.get("schemaVersion") != "32.3-EXIT-STEPLOCK":
            raise RuntimeError("Unknown strategy or exit schema")
        symbol = str(payload.get("symbol", "")).upper()
        side = str(payload.get("side", "")).upper()
        if symbol not in DEMO_EXECUTION_MARKETS:
            raise RuntimeError("This DEMO execution release only permits XAUUSD")
        if side not in {"BUY", "SELL"}:
            raise RuntimeError("Setup side must be BUY or SELL")
        try:
            layers = int(payload.get("layers"))
            lot = float(payload.get("lotPerLayer"))
            values = [float(payload.get(key)) for key in ("entry", "sl", "tp1", "tp2", "tp3")]
        except (TypeError, ValueError) as exc:
            raise RuntimeError("Setup price, lot or layer value is invalid") from exc
        if not 1 <= layers <= 10 or lot <= 0 or not all(math.isfinite(value) and value > 0 for value in values):
            raise RuntimeError("Setup price, lot or layer range is invalid")
        entry, sl, tp1, tp2, tp3 = values
        levels_valid = sl < entry < tp1 < tp2 < tp3 if side == "BUY" else sl > entry > tp1 > tp2 > tp3
        if not levels_valid:
            raise RuntimeError("Setup SL/TP levels do not match the trade side")
        signal_time = int(payload.get("signalReceivedAt") or 0)
        age = int(time.time() * 1000) - signal_time
        if signal_time <= 0 or age < -60_000 or age > 10 * 60 * 1000:
            raise RuntimeError("Setup signal is outside the DEMO execution freshness window")

    def place_setup(self, payload: dict[str, Any], command_id: str) -> list[str]:
        if not self.config.demo_execution_enabled:
            raise RuntimeError("DEMO execution lock is active")
        if not self.ledger.armed():
            raise RuntimeError("Auto Trade is not armed")
        self.assert_demo_terminal(require_execution=True)
        self.validate_setup_payload(payload)
        canonical = payload["symbol"]
        if any(self.canonical_symbol(position.symbol) == canonical for position in self.zencore_positions()):
            raise RuntimeError("An open ZenCore position already exists for this symbol")
        info = mt5.symbol_info(self.broker_symbol(canonical))
        if info is None:
            raise RuntimeError(f"Broker symbol not found for {canonical}")
        requested_lot = float(payload["lotPerLayer"])
        broker_lot = self.normalise_volume(info, requested_lot)
        if abs(broker_lot - requested_lot) > 1e-9:
            raise RuntimeError("Lot per layer does not match the broker volume step")
        self.ledger.save_plan(canonical, {
            "symbol": canonical,
            "side": payload["side"],
            "entry": float(payload["entry"]),
            "initialSl": float(payload["sl"]),
            "tp1": float(payload["tp1"]),
            "tp2": float(payload["tp2"]),
            "tp3": float(payload["tp3"]),
            "lockStage": 0,
            "partialCloseDone": False,
            "commandId": command_id,
        })
        orders = []
        try:
            for index in range(int(payload["layers"])):
                orders.append(self.send_market_layer(payload, index + 1))
        except Exception as exc:
            raise RuntimeError(
                f"Layer execution stopped after {len(orders)}; any filled layer keeps its broker SL: {exc}"
            ) from exc
        positions = [
            position for position in self.zencore_positions()
            if self.canonical_symbol(position.symbol) == canonical
        ]
        if positions:
            total_volume = sum(float(position.volume) for position in positions)
            plan = self.ledger.plan(canonical) or {}
            plan["entry"] = sum(
                float(position.price_open) * float(position.volume) for position in positions
            ) / total_volume
            self.ledger.save_plan(canonical, plan)
        return orders

    def modify_sl(self, canonical: str, active_sl: float | None, use_position_entry: bool = False) -> int:
        self.assert_demo_terminal(require_execution=True)
        changed = 0
        for position in self.zencore_positions():
            if self.canonical_symbol(position.symbol) != canonical:
                continue
            info = mt5.symbol_info(position.symbol)
            if info is None:
                raise RuntimeError(f"Broker symbol unavailable for {canonical}")
            target_sl = float(position.price_open) if use_position_entry else float(active_sl)
            target_sl = round(target_sl, int(info.digits))
            if position.type == mt5.POSITION_TYPE_BUY and position.sl and position.sl >= target_sl:
                continue
            if position.type == mt5.POSITION_TYPE_SELL and position.sl and position.sl <= target_sl:
                continue
            result = mt5.order_send({
                "action": mt5.TRADE_ACTION_SLTP,
                "position": position.ticket,
                "symbol": position.symbol,
                "sl": target_sl,
                "tp": position.tp,
                "magic": MAGIC,
            })
            if result is None or int(result.retcode) not in self.success_retcodes():
                raise RuntimeError(f"SL modification failed for {position.ticket}")
            changed += 1
        return changed

    def close_position(self, position: Any, volume: float) -> str:
        self.assert_demo_terminal(require_execution=True)
        info = mt5.symbol_info(position.symbol)
        tick = mt5.symbol_info_tick(position.symbol)
        if info is None or tick is None:
            raise RuntimeError(f"No live tick for {position.symbol}")
        close_volume = min(float(position.volume), float(volume))
        close_volume = round(close_volume, self.volume_digits(float(info.volume_step)))
        if close_volume < float(info.volume_min) - 1e-9:
            raise RuntimeError(f"Close volume is below broker minimum for {position.symbol}")
        order_type = mt5.ORDER_TYPE_SELL if position.type == mt5.POSITION_TYPE_BUY else mt5.ORDER_TYPE_BUY
        request = {
            "action": mt5.TRADE_ACTION_DEAL,
            "position": position.ticket,
            "symbol": position.symbol,
            "volume": close_volume,
            "type": order_type,
            "price": round(
                tick.bid if order_type == mt5.ORDER_TYPE_SELL else tick.ask,
                int(info.digits),
            ),
            "deviation": 40,
            "magic": MAGIC,
            "comment": "ZenCore:managed-exit",
            "type_time": mt5.ORDER_TIME_GTC,
        }
        result = self.send_checked_deal(info, request)
        return str(result.order or result.deal)

    def close_symbol_percent(self, canonical: str, percent: float) -> list[str]:
        positions = sorted(
            [
                position for position in self.zencore_positions()
                if self.canonical_symbol(position.symbol) == canonical
            ],
            key=lambda position: int(position.ticket),
        )
        if not positions:
            return []
        if percent >= 100:
            return [self.close_position(position, float(position.volume)) for position in positions]
        info = mt5.symbol_info(positions[0].symbol)
        if info is None:
            raise RuntimeError(f"Broker symbol unavailable for {canonical}")
        total_volume = sum(float(position.volume) for position in positions)
        minimum = float(info.volume_min)
        maximum_partial = total_volume - minimum
        if maximum_partial < minimum - 1e-9:
            raise RuntimeError("Broker minimum lot does not permit a 50% partial close")
        step = float(info.volume_step)
        target = math.ceil((total_volume * percent / 100.0) / step - 1e-9) * step
        target = min(target, maximum_partial)
        target = round(target, self.volume_digits(float(info.volume_step)))
        closed: list[str] = []
        remaining = target
        for position in positions:
            if remaining <= 1e-9:
                break
            position_volume = float(position.volume)
            if remaining >= position_volume - 1e-9:
                close_volume = position_volume
            else:
                max_from_position = position_volume - minimum
                if max_from_position < minimum - 1e-9:
                    continue
                close_volume = min(
                    self.normalise_volume(info, remaining, "nearest"),
                    max_from_position,
                )
            if close_volume < minimum - 1e-9:
                continue
            closed.append(self.close_position(position, close_volume))
            remaining = round(
                remaining - close_volume,
                self.volume_digits(float(info.volume_step)),
            )
        if remaining > 1e-9:
            raise RuntimeError("Unable to complete broker-rounded 50% partial close")
        return closed

    def manage_position(self, payload: dict[str, Any]) -> dict[str, Any]:
        if payload.get("strategy") != "NORMAL_3M_SOP_V32" or payload.get("schemaVersion") != "32.3-EXIT-STEPLOCK":
            raise RuntimeError("Unknown management strategy or exit schema")
        self.assert_demo_terminal(require_execution=True)
        canonical = payload["symbol"]
        if canonical not in DEMO_EXECUTION_MARKETS:
            raise RuntimeError("This DEMO execution release only permits XAUUSD")
        changed_sl = 0
        closed: list[str] = []
        for action in payload.get("actions", []):
            if action["type"].startswith("MOVE_SL_"):
                use_entry = action["type"] == "MOVE_SL_ENTRY"
                changed_sl += self.modify_sl(
                    canonical,
                    None if use_entry else float(action["activeSl"]),
                    use_position_entry=use_entry,
                )
                plan = self.ledger.plan(canonical)
                if plan:
                    plan["lockStage"] = max(int(plan.get("lockStage", 0)), {
                        "MOVE_SL_ENTRY": 1, "MOVE_SL_TP1": 2, "MOVE_SL_TP2": 3,
                    }.get(action["type"], 0))
                    self.ledger.save_plan(canonical, plan)
            elif action["type"] == "CLOSE_PERCENT":
                percent = float(action["percent"])
                plan = self.ledger.plan(canonical)
                if percent < 100 and not plan:
                    raise RuntimeError("Position plan is missing; refusing repeated partial close")
                if percent < 100 and plan and plan.get("partialCloseDone"):
                    continue
                closed.extend(self.close_symbol_percent(canonical, percent))
                if percent < 100 and plan:
                    plan["partialCloseDone"] = True
                    self.ledger.save_plan(canonical, plan)
        if not any(self.canonical_symbol(item.symbol) == canonical for item in self.zencore_positions()):
            self.ledger.delete_plan(canonical)
        return {"changedSl": changed_sl, "closedOrders": closed}

    def emergency_close_all(self) -> list[str]:
        closed = [
            self.close_position(position, float(position.volume))
            for position in list(self.zencore_positions())
        ]
        for plan in self.ledger.plans():
            self.ledger.delete_plan(plan["symbol"])
        return closed

    def local_step_lock(self) -> None:
        """Keep TP1/TP2/TP3 SL protection alive even during control-plane outages."""
        open_positions = self.zencore_positions()
        for plan in self.ledger.plans():
            canonical = plan["symbol"]
            positions = [item for item in open_positions if self.canonical_symbol(item.symbol) == canonical]
            if not positions:
                self.ledger.delete_plan(canonical)
                continue
            tick = mt5.symbol_info_tick(positions[0].symbol)
            if tick is None:
                continue
            current = tick.bid if plan["side"] == "BUY" else tick.ask
            reached = (lambda level: current >= level) if plan["side"] == "BUY" else (lambda level: current <= level)
            stage = int(plan.get("lockStage", 0))
            target_stage = stage
            target_sl = None
            if reached(float(plan["tp3"])):
                target_stage, target_sl = 3, float(plan["tp2"])
            elif reached(float(plan["tp2"])):
                target_stage, target_sl = 2, float(plan["tp1"])
            elif reached(float(plan["tp1"])):
                target_stage, target_sl = 1, None
            if target_stage > stage:
                self.modify_sl(canonical, target_sl, use_position_entry=target_stage == 1)
                plan["lockStage"] = target_stage
                self.ledger.save_plan(canonical, plan)

    def execute(self, envelope: dict[str, Any]) -> tuple[str, dict[str, Any]]:
        command_type = envelope["type"]
        payload = envelope.get("payload", {})
        try:
            if command_type == "SYSTEM_ON":
                if not self.config.demo_execution_enabled:
                    raise RuntimeError("DEMO execution lock is active")
                if payload.get("mode") != "DEMO" or payload.get("strategy") != "NORMAL_3M_SOP_V32" or payload.get("exitSchema") != "32.3-EXIT-STEPLOCK":
                    raise RuntimeError("SYSTEM_ON policy does not match this DEMO release")
                settings = payload.get("settings", {})
                if any(symbol not in DEMO_EXECUTION_MARKETS for symbol in settings.get("symbols", [])):
                    raise RuntimeError("SYSTEM_ON includes a symbol outside the XAUUSD Demo rollout")
                self.initialise_terminal()
                self.ledger.set_armed(True)
                return "EXECUTED", {"code": "ARMED", "message": "DEMO Auto Trade armed"}
            if command_type == "SYSTEM_STOP":
                self.ledger.set_armed(False)
                return "EXECUTED", {"code": "STOPPED", "message": "New entries stopped; exit management remains active"}
            if command_type == "EMERGENCY_CLOSE_ALL":
                self.ledger.set_armed(False)
                closed = self.emergency_close_all()
                return "EXECUTED", {"code": "CLOSED_ALL", "message": f"Closed {len(closed)} positions"}
            if command_type == "PLACE_SETUP":
                orders = self.place_setup(payload, str(envelope["id"]))
                return "EXECUTED", {"code": "ORDERS_PLACED", "message": f"Placed {len(orders)} layers", "brokerOrderId": orders[-1] if orders else ""}
            if command_type == "MANAGE_POSITION":
                result = self.manage_position(payload)
                return "EXECUTED", {"code": "POSITION_MANAGED", "message": json.dumps(result, separators=(",", ":"))[:180]}
            return "REJECTED", {"code": "UNKNOWN_COMMAND", "message": "Command type is not supported"}
        except Exception as exc:  # broker/runtime errors are acknowledged without leaking credentials
            return "FAILED", {"code": "EXECUTION_FAILED", "message": str(exc)[:180]}

    def process_command(self, command: dict[str, Any]) -> None:
        command_id = str(command.get("id", ""))
        previous = self.ledger.previous_result(command_id)
        if previous:
            if previous[0] == "IN_PROGRESS":
                recovery = {
                    "code": "REPLAY_BLOCKED",
                    "message": "A prior execution was interrupted; duplicate broker action was blocked",
                }
                self.ledger.save_result(command_id, "FAILED", recovery)
                self.control.acknowledge(command_id, "FAILED", recovery)
                return
            self.control.acknowledge(command_id, previous[0], previous[1])
            return
        try:
            envelope = self.verify_command(command)
            if not self.ledger.claim_command(command_id):
                raise RuntimeError("Command replay was blocked by the local ledger")
            status, result = self.execute(envelope)
        except Exception as exc:
            status, result = "REJECTED", {"code": "SECURITY_REJECTED", "message": str(exc)[:180]}
        self.ledger.save_result(command_id, status, result)
        self.control.acknowledge(command_id, status, result)

    def run(self) -> None:
        self.initialise_terminal()
        print(
            f"ZenCore Secure Pod started in DEMO mode ({self.config.host_profile})",
            flush=True,
        )
        while True:
            try:
                self.local_step_lock()
                heartbeat = self.control.heartbeat(self.heartbeat_payload())
                if str(heartbeat.get("desiredState", "STOPPED")).upper() != "ON":
                    self.ledger.set_armed(False)
                command = self.control.next_command()
                if command:
                    self.process_command(command)
            except (urllib.error.URLError, TimeoutError, RuntimeError) as exc:
                print(f"Secure Pod waiting: {str(exc)[:180]}", file=sys.stderr, flush=True)
            time.sleep(self.config.poll_seconds)


def parse_arguments(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="ZenCore trader-owned Windows MT5 Secure Pod")
    parser.add_argument("--config", type=Path, help="Path to the non-secret Secure Pod JSON config")
    parser.add_argument(
        "--pair-only",
        action="store_true",
        help="Exchange a one-time pairing code, protect the pod identity with DPAPI, then exit",
    )
    parser.add_argument(
        "--terminal-preflight",
        action="store_true",
        help="Verify the local MT5 DEMO terminal without reading or transmitting broker credentials",
    )
    return parser.parse_args(argv)


def run_terminal_preflight(config_path: Path | None) -> int:
    if config_path is None:
        raise SystemExit("--terminal-preflight requires --config")
    file_config = Config._load_file(config_path)
    terminal_path = str(file_config.get("mt5TerminalPath") or "")
    symbol_map = file_config.get("symbolMap") if isinstance(file_config.get("symbolMap"), dict) else {}
    if not terminal_path or not mt5.initialize(path=terminal_path):
        print(json.dumps({"ok": False, "code": "MT5_INITIALIZE_FAILED"}, separators=(",", ":")))
        return 1
    try:
        account = mt5.account_info()
        terminal = mt5.terminal_info()
        if account is None or terminal is None:
            print(json.dumps({"ok": False, "code": "MT5_STATE_UNAVAILABLE"}, separators=(",", ":")))
            return 1
        mapped_xau = str(symbol_map.get("XAUUSD") or "XAUUSD")
        xau_ready = mt5.symbol_info(mapped_xau) is not None or bool(mt5.symbols_get(group="*XAUUSD*"))
        demo = account.trade_mode == mt5.ACCOUNT_TRADE_MODE_DEMO
        server_allowed = SecurePod.server_id(account.server) == INTERSTELLAR_DEMO_SERVER_ID
        trading_allowed = bool(
            account.trade_allowed and getattr(account, "trade_expert", False)
            and terminal.trade_allowed and not terminal.tradeapi_disabled
        )
        ready = demo and server_allowed and trading_allowed and xau_ready
        print(json.dumps({
            "ok": ready,
            "tradeMode": "DEMO" if demo else "REAL",
            "serverAllowed": server_allowed,
            "tradingAllowed": trading_allowed,
            "xauusdReady": xau_ready,
            "accountMask": SecurePod.mask(account.login, 4),
            "serverMask": SecurePod.mask(account.server, 8),
            "terminalBuild": str(terminal.build),
            "connectorVersion": CONNECTOR_VERSION,
        }, separators=(",", ":")))
        return 0 if ready else 1
    finally:
        mt5.shutdown()


def main(argv: list[str] | None = None) -> int:
    arguments = parse_arguments(argv)
    if arguments.terminal_preflight:
        return run_terminal_preflight(arguments.config)
    if arguments.pair_only:
        pairing_code = getpass.getpass("One-time ZenCore pairing code: ")
        try:
            configuration = Config.load(arguments.config, pairing_code=pairing_code)
        finally:
            pairing_code = ""
        print("Secure Pod pairing completed; no broker credentials were requested or transmitted.", flush=True)
        return 0
    configuration = Config.load(arguments.config)
    pod = SecurePod(configuration)
    try:
        pod.run()
    finally:
        mt5.shutdown()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
