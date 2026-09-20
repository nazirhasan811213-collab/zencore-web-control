"""ZenCore Google Cloud hosted MT5 worker (DEMO execution release).

This build can authenticate the assigned Google VM, lease an encrypted broker
credential, unwrap it through Cloud HSM, initialize one MT5 Demo terminal and
report sanitized telemetry and execute only validated XAUUSD DEMO commands behind explicit gates.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable
from urllib.parse import urlsplit

from gcp_control_plane import ControlPlaneError, GcpControlPlaneClient
from gcp_kms_unwrapper import (
    GcpKmsUnwrapper,
    KEY_ALIAS_PATTERN,
    KEY_VERSION_PATTERN,
)
from demo_executor import DemoExecutionError, DemoExecutor
from security_boundary import (
    HOSTED_DEMO_ORDER_EXECUTION_BUILD_UNLOCKED,
    Mt5Credential,
    SUPPORTED_MARKETS,
    assert_clean_worker_environment,
    decrypt_credential_envelope,
)


CONNECTOR_VERSION = "2.1.0-gcp-demo-execution"
MAGIC = 3233001
INTERSTELLAR_DEMO_SERVER_ID = "INTERSTELLARFINANCIALDEMO"
_UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
    re.IGNORECASE,
)
_CELL_RE = re.compile(r"^[a-z]([-a-z0-9]{0,61}[a-z0-9])?$")
_CONNECTOR_RE = re.compile(r"^[A-Za-z0-9._-]{3,32}$")


class WorkerFailure(RuntimeError):
    """Safe machine-readable failure. The message is never broker plaintext."""

    def __init__(self, code: str):
        safe = re.sub(r"[^A-Z0-9_.-]", "", str(code).upper())[:64]
        super().__init__(safe or "WORKER_FAILED")
        self.code = safe or "WORKER_FAILED"


def _normalise_server(value: Any) -> str:
    return re.sub(r"[^A-Z0-9]", "", str(value or "").upper())


def _mask(value: Any, suffix: int, fallback: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9 ._-]", "", str(value or "")).strip()
    compact = cleaned[-suffix:] if cleaned else fallback
    compact = compact[-suffix:]
    if len(compact) < 2:
        compact = fallback[-suffix:]
    return f"****{compact}"


def _https_origin(value: Any) -> str:
    try:
        parsed = urlsplit(str(value or ""))
        port = parsed.port
    except (TypeError, ValueError) as exc:
        raise WorkerFailure("CONFIG_CONTROL_PLANE_INVALID") from exc
    if (
        parsed.scheme != "https"
        or not parsed.hostname
        or parsed.username is not None
        or parsed.password is not None
        or parsed.path not in ("", "/")
        or parsed.query
        or parsed.fragment
        or not re.fullmatch(r"[A-Za-z0-9.-]+", parsed.hostname)
    ):
        raise WorkerFailure("CONFIG_CONTROL_PLANE_INVALID")
    suffix = "" if port in (None, 443) else f":{port}"
    return f"https://{parsed.hostname.lower()}{suffix}"


@dataclass(frozen=True)
class WorkerConfig:
    cell_id: str
    control_plane_url: str
    control_plane_audience: str
    hosted_account_id: str
    key_alias: str
    key_version_resource: str
    allowed_demo_symbols: tuple[str, ...]
    mt5_terminal_path: str
    approved_demo_server: str
    heartbeat_seconds: float
    connector_version: str
    execution_enabled: bool

    @staticmethod
    def load(path: Path) -> "WorkerConfig":
        try:
            raw = json.loads(path.read_text(encoding="utf-8-sig"))
        except (OSError, UnicodeError, json.JSONDecodeError) as exc:
            raise WorkerFailure("CONFIG_READ_FAILED") from exc
        if not isinstance(raw, dict):
            raise WorkerFailure("CONFIG_INVALID")
        allowed = {
            "schemaVersion", "cellId", "provider", "controlPlaneUrl",
            "controlPlaneAudience", "hostedAccountId", "keyAlias",
            "keyVersionResource", "demoOnly", "executionEnabled",
            "allowedDemoSymbols", "credentialStorage", "privateKeyAvailable",
            "mt5TerminalPath", "approvedDemoServer", "heartbeatIntervalSeconds",
            "connectorVersion",
        }
        if set(raw) != allowed:
            raise WorkerFailure("CONFIG_FIELDS_INVALID")
        if (
            raw.get("schemaVersion") != 1
            or raw.get("provider") != "GOOGLE_CLOUD"
            or raw.get("demoOnly") is not True
            or raw.get("executionEnabled") is not True
            or raw.get("credentialStorage") != "MEMORY_ONLY"
            or raw.get("privateKeyAvailable") is not False
            or not HOSTED_DEMO_ORDER_EXECUTION_BUILD_UNLOCKED
        ):
            raise WorkerFailure("CONFIG_SECURITY_BOUNDARY_INVALID")
        cell_id = str(raw.get("cellId") or "")
        account_id = str(raw.get("hostedAccountId") or "")
        origin = _https_origin(raw.get("controlPlaneUrl"))
        audience = str(raw.get("controlPlaneAudience") or "")
        key_alias = str(raw.get("keyAlias") or "")
        key_resource = str(raw.get("keyVersionResource") or "")
        terminal_path = str(raw.get("mt5TerminalPath") or "")
        approved_server = str(raw.get("approvedDemoServer") or "")
        connector_version = str(raw.get("connectorVersion") or "")
        try:
            heartbeat = float(raw.get("heartbeatIntervalSeconds"))
        except (TypeError, ValueError) as exc:
            raise WorkerFailure("CONFIG_HEARTBEAT_INVALID") from exc
        symbols_raw = raw.get("allowedDemoSymbols")
        symbols = tuple(dict.fromkeys(
            str(symbol or "").upper() for symbol in symbols_raw
        )) if isinstance(symbols_raw, list) else ()
        if (
            not _CELL_RE.fullmatch(cell_id)
            or not _UUID_RE.fullmatch(account_id)
            or audience != f"{origin}/api/hosted-execution"
            or not KEY_ALIAS_PATTERN.fullmatch(key_alias)
            or not KEY_VERSION_PATTERN.fullmatch(key_resource)
            or not re.fullmatch(r"[A-Za-z]:\\[^\r\n]{3,240}", terminal_path)
            or _normalise_server(approved_server) != INTERSTELLAR_DEMO_SERVER_ID
            or not 5 <= heartbeat <= 30
            or not _CONNECTOR_RE.fullmatch(connector_version)
            or connector_version != CONNECTOR_VERSION
            or not symbols
            or any(symbol not in SUPPORTED_MARKETS for symbol in symbols)
        ):
            raise WorkerFailure("CONFIG_ASSIGNMENT_INVALID")
        return WorkerConfig(
            cell_id=cell_id,
            control_plane_url=origin,
            control_plane_audience=audience,
            hosted_account_id=account_id,
            key_alias=key_alias,
            key_version_resource=key_resource,
            allowed_demo_symbols=symbols,
            mt5_terminal_path=terminal_path,
            approved_demo_server=approved_server,
            heartbeat_seconds=heartbeat,
            connector_version=connector_version,
            execution_enabled=True,
        )


class MetaTraderConnection:
    """Connection/telemetry adapter with no order placement capability."""

    def __init__(self, mt5_module: Any):
        self._mt5 = mt5_module
        self._identity_digest = ""
        self._allowed_symbols: tuple[str, ...] = ()
        self._connector_version = CONNECTOR_VERSION
        self._execution_enabled = False

    def connect(self, config: WorkerConfig, credential: Mt5Credential) -> None:
        login, password, server = credential.text()
        if _normalise_server(server) != _normalise_server(config.approved_demo_server):
            login = password = server = ""
            raise WorkerFailure("MT5_SERVER_NOT_APPROVED")
        try:
            connected = self._mt5.initialize(
                config.mt5_terminal_path,
                login=int(login),
                password=password,
                server=server,
                timeout=30_000,
                portable=False,
            )
        except Exception as exc:
            raise WorkerFailure("MT5_INITIALIZE_FAILED") from exc
        finally:
            password = ""
        if connected is not True:
            login = server = ""
            raise WorkerFailure("MT5_INITIALIZE_FAILED")
        self._identity_digest = hashlib.sha256(
            f"{login}\n{_normalise_server(server)}".encode("utf-8")
        ).hexdigest()
        login = server = ""
        self._allowed_symbols = config.allowed_demo_symbols
        self._connector_version = config.connector_version
        self._execution_enabled = config.execution_enabled
        self.snapshot()

    def _account_terminal(self) -> tuple[Any, Any]:
        try:
            account = self._mt5.account_info()
            terminal = self._mt5.terminal_info()
        except Exception as exc:
            raise WorkerFailure("MT5_STATUS_FAILED") from exc
        if account is None or terminal is None:
            raise WorkerFailure("MT5_STATUS_FAILED")
        identity = hashlib.sha256(
            f"{getattr(account, 'login', '')}\n{_normalise_server(getattr(account, 'server', ''))}".encode("utf-8")
        ).hexdigest()
        if identity != self._identity_digest:
            raise WorkerFailure("MT5_ACCOUNT_CHANGED")
        demo_mode = getattr(self._mt5, "ACCOUNT_TRADE_MODE_DEMO", 0)
        if getattr(account, "trade_mode", None) != demo_mode:
            raise WorkerFailure("MT5_REAL_ACCOUNT_BLOCKED")
        return account, terminal

    def _symbol_specs(self) -> list[dict[str, Any]]:
        specs: list[dict[str, Any]] = []
        for symbol in self._allowed_symbols:
            try:
                info = self._mt5.symbol_info(symbol)
                if info is None and hasattr(self._mt5, "symbol_select"):
                    self._mt5.symbol_select(symbol, True)
                    info = self._mt5.symbol_info(symbol)
            except Exception as exc:
                raise WorkerFailure("MT5_SYMBOL_DISCOVERY_FAILED") from exc
            if info is None or str(getattr(info, "name", symbol)).upper() != symbol:
                raise WorkerFailure("MT5_SYMBOL_MAPPING_REQUIRED")
            tick_value = max(
                float(getattr(info, "trade_tick_value", 0) or 0),
                float(getattr(info, "trade_tick_value_profit", 0) or 0),
                float(getattr(info, "trade_tick_value_loss", 0) or 0),
            )
            values = {
                "symbol": symbol,
                "tickSize": float(getattr(info, "trade_tick_size", 0) or 0),
                "tickValue": tick_value,
                "volumeMin": float(getattr(info, "volume_min", 0) or 0),
                "volumeMax": float(getattr(info, "volume_max", 0) or 0),
                "volumeStep": float(getattr(info, "volume_step", 0) or 0),
            }
            if any(values[key] <= 0 for key in (
                "tickSize", "tickValue", "volumeMin", "volumeMax", "volumeStep"
            )):
                raise WorkerFailure("MT5_SYMBOL_SPEC_INVALID")
            specs.append(values)
        return specs

    def _positions(self) -> list[dict[str, Any]]:
        try:
            rows = self._mt5.positions_get()
        except Exception as exc:
            raise WorkerFailure("MT5_POSITION_READ_FAILED") from exc
        if rows is None:
            raise WorkerFailure("MT5_POSITION_READ_FAILED")
        result: list[dict[str, Any]] = []
        buy_type = int(getattr(self._mt5, "POSITION_TYPE_BUY", 0))
        for position in rows:
            if int(getattr(position, "magic", 0) or 0) != MAGIC:
                continue
            symbol = str(getattr(position, "symbol", "")).upper()
            if symbol not in self._allowed_symbols:
                raise WorkerFailure("UNEXPECTED_ZENCORE_POSITION")
            result.append({
                "ticket": str(getattr(position, "ticket", "") or ""),
                "symbol": symbol,
                "side": "BUY" if int(getattr(position, "type", -1)) == buy_type else "SELL",
                "volume": float(getattr(position, "volume", 0) or 0),
                "layers": 1,
                "entry": float(getattr(position, "price_open", 0) or 0),
                "currentPrice": float(getattr(position, "price_current", 0) or 0),
                "initialSl": float(getattr(position, "sl", 0) or 0) or None,
                "activeSl": float(getattr(position, "sl", 0) or 0) or None,
                "tp1": float(getattr(position, "tp", 0) or 0) or None,
                "tp2": None,
                "tp3": None,
                "profitUsd": float(getattr(position, "profit", 0) or 0),
                "openedAt": int(getattr(position, "time_msc", 0) or int(getattr(position, "time", 0) or 0) * 1000),
                "exitStage": "HOLD",
                "slLock": "ACTIVE" if float(getattr(position, "sl", 0) or 0) else "INITIAL",
            })
        return result

    def snapshot(self) -> dict[str, Any]:
        account, terminal = self._account_terminal()
        try:
            version = self._mt5.version() or ()
        except Exception as exc:
            raise WorkerFailure("MT5_VERSION_FAILED") from exc
        build = str(version[1]) if isinstance(version, (tuple, list)) and len(version) > 1 else "UNKNOWN"
        return {
            "accountMask": _mask(getattr(account, "login", ""), 6, "MT5"),
            "serverMask": _mask(getattr(account, "server", ""), 12, "Demo"),
            "brokerMask": _mask(getattr(account, "company", ""), 16, "MT5"),
            "tradeMode": "DEMO",
            "connectionStatus": "CONNECTED",
            "terminalTradeAllowed": bool(getattr(terminal, "trade_allowed", False)),
            "accountTradeAllowed": bool(getattr(account, "trade_allowed", False)),
            "expertTradeAllowed": bool(getattr(account, "trade_expert", False)),
            "demoExecutionUnlocked": self._execution_enabled,
            "connectorVersion": self._connector_version,
            "terminalBuild": re.sub(r"[^A-Za-z0-9._-]", "", build)[:24] or "UNKNOWN",
            "symbolSpecs": self._symbol_specs(),
            "positions": self._positions(),
        }

    def shutdown(self) -> None:
        try:
            self._mt5.shutdown()
        except Exception:
            pass


def _validate_lease(result: Any, config: WorkerConfig) -> dict[str, Any]:
    if not isinstance(result, dict) or result.get("ok") is not True:
        raise WorkerFailure("LEASE_RESPONSE_INVALID")
    lease = result.get("lease")
    server_time = result.get("serverTime")
    allowed = {
        "id", "accountId", "keyId", "credentialEnvelope", "expiresAt",
        "demoOnly", "executionEnabled", "accountMask", "serverMask", "brokerMask",
    }
    if not isinstance(lease, dict) or set(lease) != allowed:
        raise WorkerFailure("LEASE_RESPONSE_INVALID")
    if (
        not _UUID_RE.fullmatch(str(lease.get("id") or ""))
        or lease.get("accountId") != config.hosted_account_id
        or lease.get("keyId") != config.key_alias
        or lease.get("demoOnly") is not True
        or lease.get("executionEnabled") is not True
        or not isinstance(server_time, int)
        or not isinstance(lease.get("expiresAt"), int)
        or not server_time < lease["expiresAt"] <= server_time + 5 * 60 * 1000
        or not re.fullmatch(r"\*{4}[A-Za-z0-9]{2,6}", str(lease.get("accountMask") or ""))
        or not re.fullmatch(r"\*{4}[A-Za-z0-9._-]{2,12}", str(lease.get("serverMask") or ""))
        or not re.fullmatch(r"\*{4}[A-Za-z0-9 ._-]{2,16}", str(lease.get("brokerMask") or ""))
    ):
        raise WorkerFailure("LEASE_ASSIGNMENT_INVALID")
    return lease


class HostedConnectionWorker:
    def __init__(
        self,
        config: WorkerConfig,
        control_plane: GcpControlPlaneClient,
        unwrapper: GcpKmsUnwrapper,
        terminal: MetaTraderConnection,
        executor: DemoExecutor,
        *,
        execution_gate_path: Path,
        sleeper: Callable[[float], None] = time.sleep,
        clock_ms: Callable[[], int] = lambda: int(time.time() * 1000),
    ) -> None:
        self.config = config
        self.control_plane = control_plane
        self.unwrapper = unwrapper
        self.terminal = terminal
        self.executor = executor
        self.execution_gate_path = execution_gate_path
        self.sleeper = sleeper
        self.clock_ms = clock_ms
        self.lease: dict[str, Any] | None = None
        self.entries_enabled = False

    def _assert_execution_gate(self) -> None:
        if not self.config.execution_enabled or not HOSTED_DEMO_ORDER_EXECUTION_BUILD_UNLOCKED:
            raise WorkerFailure("DEMO_EXECUTION_BUILD_LOCKED")
        if not self.execution_gate_path.is_file():
            raise WorkerFailure("DEMO_EXECUTION_GATE_MISSING")

    def connect_once(self) -> dict[str, Any]:
        self._assert_execution_gate()
        assert_clean_worker_environment()
        try:
            result = self.control_plane.lease(
                self.config.hosted_account_id, self.config.cell_id
            )
        except ControlPlaneError as exc:
            raise WorkerFailure("CONTROL_PLANE_LEASE_FAILED") from exc
        lease = _validate_lease(result, self.config)
        self.lease = lease
        credential: Mt5Credential | None = None
        try:
            credential = decrypt_credential_envelope(
                lease["credentialEnvelope"], self.config.key_alias, self.unwrapper
            )
            self.terminal.connect(self.config, credential)
        except WorkerFailure:
            raise
        except Exception as exc:
            raise WorkerFailure("CREDENTIAL_OR_MT5_CONNECT_FAILED") from exc
        finally:
            if credential is not None:
                credential.wipe()
        return self.heartbeat_once()

    def _error_heartbeat(self, code: str) -> None:
        if not self.lease:
            return
        payload = {
            "accountId": self.config.hosted_account_id,
            "leaseId": self.lease["id"],
            "accountMask": self.lease["accountMask"],
            "serverMask": self.lease["serverMask"],
            "brokerMask": self.lease["brokerMask"],
            "tradeMode": "DEMO",
            "connectionStatus": "ERROR",
            "lastError": WorkerFailure(code).code,
            "terminalTradeAllowed": False,
            "accountTradeAllowed": False,
            "expertTradeAllowed": False,
            "demoExecutionUnlocked": False,
            "connectorVersion": self.config.connector_version,
            "terminalBuild": "UNKNOWN",
            "symbolSpecs": [],
            "positions": [],
        }
        try:
            self.control_plane.heartbeat(payload)
        except Exception:
            pass

    def heartbeat_once(self) -> dict[str, Any]:
        self._assert_execution_gate()
        if not self.lease:
            raise WorkerFailure("LEASE_NOT_READY")
        if self.clock_ms() >= int(self.lease["expiresAt"]):
            raise WorkerFailure("LEASE_EXPIRED")
        try:
            telemetry = self.terminal.snapshot()
            telemetry.update({
                "accountId": self.config.hosted_account_id,
                "leaseId": self.lease["id"],
            })
            return self.control_plane.heartbeat(telemetry)
        except WorkerFailure:
            raise
        except ControlPlaneError as exc:
            raise WorkerFailure("CONTROL_PLANE_HEARTBEAT_FAILED") from exc

    def _ack_command(self, command: dict[str, Any], status: str, code: str, message: str = "", broker_ids: tuple[str, ...] = ()) -> None:
        if not self.lease:
            raise WorkerFailure("LEASE_NOT_READY")
        try:
            self.control_plane.acknowledge_command(
                self.config.hosted_account_id,
                self.lease["id"],
                str(command.get("id") or ""),
                status=status,
                code=code,
                message=message,
                broker_order_id=",".join(broker_ids),
            )
        except ControlPlaneError as exc:
            raise WorkerFailure("CONTROL_PLANE_ACK_FAILED") from exc

    def command_once(self) -> None:
        self._assert_execution_gate()
        if not self.lease:
            raise WorkerFailure("LEASE_NOT_READY")
        try:
            result = self.control_plane.next_command(
                self.config.hosted_account_id, self.lease["id"]
            )
        except ControlPlaneError as exc:
            raise WorkerFailure("CONTROL_PLANE_COMMAND_FAILED") from exc
        command = result.get("command") if isinstance(result, dict) else None
        if command is None:
            return
        if not isinstance(command, dict):
            raise WorkerFailure("COMMAND_RESPONSE_INVALID")
        command_id = str(command.get("id") or "")
        command_type = str(command.get("type") or "").upper()
        payload = command.get("payload")
        expires_at = int(command.get("expiresAt") or 0)
        if not _UUID_RE.fullmatch(command_id) or not isinstance(payload, dict) or expires_at <= self.clock_ms():
            raise WorkerFailure("COMMAND_RESPONSE_INVALID")
        try:
            if command_type == "SYSTEM_ON":
                self.entries_enabled = True
                self._ack_command(command, "EXECUTED", "HOSTED_DEMO_ARMED")
                return
            if command_type == "SYSTEM_STOP":
                self.entries_enabled = False
                self._ack_command(command, "EXECUTED", "HOSTED_DEMO_STOPPED")
                return
            if command_type == "PLACE_SETUP":
                if not self.entries_enabled:
                    self._ack_command(command, "REJECTED", "SYSTEM_STOPPED", "New entries are disabled.")
                    return
                executed = self.executor.execute_place_setup(payload)
                self._ack_command(
                    command, "EXECUTED", executed.code,
                    broker_ids=executed.broker_order_ids,
                )
                return
            if command_type == "MANAGE_POSITION":
                managed = self.executor.execute_management(payload)
                self._ack_command(
                    command, "EXECUTED", managed.code,
                    broker_ids=managed.broker_order_ids,
                )
                return
            if command_type == "EMERGENCY_CLOSE_ALL":
                self.entries_enabled = False
                closed = self.executor.emergency_close_all()
                self._ack_command(
                    command, "EXECUTED", closed.code,
                    broker_ids=closed.broker_order_ids,
                )
                return
            self._ack_command(command, "REJECTED", "COMMAND_TYPE_INVALID")
        except DemoExecutionError as exc:
            self._ack_command(command, "REJECTED", str(exc)[:40], "DEMO execution guard rejected command.")

    def run_forever(self) -> None:
        while True:
            failure = "WORKER_RECONNECT"
            try:
                self.connect_once()
                while True:
                    self.sleeper(self.config.heartbeat_seconds)
                    self.heartbeat_once()
                    self.command_once()
            except WorkerFailure as exc:
                failure = exc.code
                self._error_heartbeat(exc.code)
            except Exception:
                failure = "WORKER_UNEXPECTED_FAILURE"
                self._error_heartbeat(failure)
            finally:
                self.terminal.shutdown()
                self.lease = None
            print(f"ZenCore hosted worker state: {failure}", file=sys.stderr, flush=True)
            self.sleeper(max(10.0, self.config.heartbeat_seconds))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="ZenCore Google hosted MT5 worker")
    parser.add_argument(
        "--config",
        default=r"C:\ProgramData\ZenCore\HostedWorker\worker-config.json",
    )
    parser.add_argument(
        "--execution-gate",
        default=r"C:\ProgramData\ZenCore\HostedWorker\DEMO_EXECUTION_ENABLED",
    )
    args = parser.parse_args(argv)
    try:
        config = WorkerConfig.load(Path(args.config))
        assert_clean_worker_environment()
        if not Path(args.execution_gate).is_file():
            raise WorkerFailure("DEMO_EXECUTION_GATE_MISSING")
        try:
            import MetaTrader5 as mt5  # type: ignore
        except ImportError as exc:
            raise WorkerFailure("MT5_PYTHON_MODULE_MISSING") from exc
        terminal = MetaTraderConnection(mt5)
        worker = HostedConnectionWorker(
            config,
            GcpControlPlaneClient(config.control_plane_url),
            GcpKmsUnwrapper(config.key_alias, config.key_version_resource),
            terminal,
            DemoExecutor(
                mt5,
                approved_server=config.approved_demo_server,
                allowed_symbols=config.allowed_demo_symbols,
                execution_enabled=config.execution_enabled,
            ),
            execution_gate_path=Path(args.execution_gate),
        )
        worker.run_forever()
    except KeyboardInterrupt:
        return 0
    except WorkerFailure as exc:
        print(f"ZenCore hosted worker state: {exc.code}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
