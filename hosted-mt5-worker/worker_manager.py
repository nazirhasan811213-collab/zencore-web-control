"""ZenCore multi-client Windows worker manager.

The manager never receives broker credentials. It discovers masked slot/account
assignments from the attested ZenCore control plane, materializes one isolated
MT5 terminal directory per slot, and supervises one ZenCoreHostedWorker child
process per assignment. The child worker alone leases the encrypted credential
envelope and unwraps it through Cloud KMS/HSM.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

from gcp_control_plane import ControlPlaneError, GcpControlPlaneClient


CONNECTOR_VERSION = "2.2.0-gcp-multiuser-multipair"
INTERSTELLAR_DEMO_SERVER = "InterStellarFinancial-Demo"
SUPPORTED_MARKETS = (
    "XAUUSD", "EURUSD", "GBPUSD", "USDJPY", "US30", "USDCAD",
    "USDCHF", "EURJPY", "GBPJPY", "EURGBP", "BTCUSD",
)
_UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
    re.IGNORECASE,
)
_SLOT_RE = re.compile(r"^[a-z]([-a-z0-9]{0,61}[a-z0-9])?$")
_KEY_ALIAS_RE = re.compile(r"^[A-Za-z0-9._:-]{3,80}$")
_KEY_RESOURCE_RE = re.compile(
    r"^projects/[a-z][a-z0-9-]{4,61}[a-z0-9]/locations/[A-Za-z0-9_-]+/"
    r"keyRings/[A-Za-z0-9_-]+/cryptoKeys/[A-Za-z0-9_-]+/cryptoKeyVersions/[0-9]+$"
)
_FORBIDDEN_CONFIG_KEYS = re.compile(
    r"(password|credentialEnvelope|wrappedKey|ciphertext|privateKeyPem|"
    r"privateKeyMaterial|brokerLogin)",
    re.IGNORECASE,
)


class ManagerFailure(RuntimeError):
    def __init__(self, code: str):
        safe = re.sub(r"[^A-Z0-9_.-]", "", str(code).upper())[:64]
        super().__init__(safe or "MANAGER_FAILED")
        self.code = safe or "MANAGER_FAILED"


def _windows_absolute(value: Any) -> str:
    text = str(value or "")
    if not re.fullmatch(r"[A-Za-z]:\\[^\r\n]{3,240}", text):
        raise ManagerFailure("MANAGER_WINDOWS_PATH_INVALID")
    return text


def _exact_https_origin(value: Any) -> str:
    from urllib.parse import urlsplit

    try:
        parsed = urlsplit(str(value or ""))
        port = parsed.port
    except (TypeError, ValueError) as exc:
        raise ManagerFailure("MANAGER_CONTROL_PLANE_INVALID") from exc
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
        raise ManagerFailure("MANAGER_CONTROL_PLANE_INVALID")
    suffix = "" if port in (None, 443) else f":{port}"
    return f"https://{parsed.hostname.lower()}{suffix}"


@dataclass(frozen=True)
class ManagerConfig:
    control_plane_url: str
    key_alias: str
    key_version_resource: str
    child_worker_path: str
    terminal_template_root: str
    terminal_executable_name: str
    slots_root: str
    execution_gate_path: str
    approved_demo_server: str
    allowed_demo_symbols: tuple[str, ...]
    heartbeat_seconds: float
    poll_seconds: float
    connector_version: str
    max_slots: int

    @staticmethod
    def load(path: Path) -> "ManagerConfig":
        try:
            raw = json.loads(path.read_text(encoding="utf-8-sig"))
        except (OSError, UnicodeError, json.JSONDecodeError) as exc:
            raise ManagerFailure("MANAGER_CONFIG_READ_FAILED") from exc
        if not isinstance(raw, dict):
            raise ManagerFailure("MANAGER_CONFIG_INVALID")
        allowed = {
            "schemaVersion", "provider", "controlPlaneUrl", "keyAlias",
            "keyVersionResource", "childWorkerPath", "terminalTemplateRoot",
            "terminalExecutableName", "slotsRoot", "executionGatePath",
            "approvedDemoServer", "allowedDemoSymbols", "heartbeatIntervalSeconds",
            "pollIntervalSeconds", "connectorVersion", "demoOnly",
            "credentialStorage", "privateKeyAvailable", "maxSlots",
        }
        if set(raw) != allowed:
            raise ManagerFailure("MANAGER_CONFIG_FIELDS_INVALID")
        if (
            raw.get("schemaVersion") != 1
            or raw.get("provider") != "GOOGLE_CLOUD"
            or raw.get("demoOnly") is not True
            or raw.get("credentialStorage") != "CHILD_WORKER_MEMORY_ONLY"
            or raw.get("privateKeyAvailable") is not False
        ):
            raise ManagerFailure("MANAGER_SECURITY_BOUNDARY_INVALID")

        origin = _exact_https_origin(raw.get("controlPlaneUrl"))
        key_alias = str(raw.get("keyAlias") or "")
        key_resource = str(raw.get("keyVersionResource") or "")
        child_worker = _windows_absolute(raw.get("childWorkerPath"))
        terminal_root = _windows_absolute(raw.get("terminalTemplateRoot"))
        slots_root = _windows_absolute(raw.get("slotsRoot"))
        gate_path = _windows_absolute(raw.get("executionGatePath"))
        terminal_name = str(raw.get("terminalExecutableName") or "")
        approved_server = str(raw.get("approvedDemoServer") or "")
        connector_version = str(raw.get("connectorVersion") or "")
        symbols_raw = raw.get("allowedDemoSymbols")
        symbols = tuple(dict.fromkeys(
            str(symbol or "").upper() for symbol in symbols_raw
        )) if isinstance(symbols_raw, list) else ()
        try:
            heartbeat = float(raw.get("heartbeatIntervalSeconds"))
            poll = float(raw.get("pollIntervalSeconds"))
            max_slots = int(raw.get("maxSlots"))
        except (TypeError, ValueError) as exc:
            raise ManagerFailure("MANAGER_CONFIG_NUMBER_INVALID") from exc

        if (
            not _KEY_ALIAS_RE.fullmatch(key_alias)
            or not _KEY_RESOURCE_RE.fullmatch(key_resource)
            or not re.fullmatch(r"[A-Za-z0-9._-]{3,80}", terminal_name)
            or approved_server != INTERSTELLAR_DEMO_SERVER
            or connector_version != CONNECTOR_VERSION
            or not symbols
            or any(symbol not in SUPPORTED_MARKETS for symbol in symbols)
            or not 5 <= heartbeat <= 30
            or not 5 <= poll <= 60
            or not 1 <= max_slots <= 50
        ):
            raise ManagerFailure("MANAGER_ASSIGNMENT_INVALID")
        return ManagerConfig(
            control_plane_url=origin,
            key_alias=key_alias,
            key_version_resource=key_resource,
            child_worker_path=child_worker,
            terminal_template_root=terminal_root,
            terminal_executable_name=terminal_name,
            slots_root=slots_root,
            execution_gate_path=gate_path,
            approved_demo_server=approved_server,
            allowed_demo_symbols=symbols,
            heartbeat_seconds=heartbeat,
            poll_seconds=poll,
            connector_version=connector_version,
            max_slots=max_slots,
        )


@dataclass(frozen=True)
class Assignment:
    slot_id: str
    slot_code: str
    slot_number: int
    slot_status: str
    account_id: str
    account_status: str
    trade_mode: str
    account_mask: str
    server_mask: str
    broker_mask: str


def validate_assignments(result: Any, max_slots: int) -> list[Assignment]:
    if not isinstance(result, dict) or result.get("ok") is not True:
        raise ManagerFailure("ASSIGNMENTS_RESPONSE_INVALID")
    raw = result.get("assignments")
    if not isinstance(raw, list) or len(raw) > max_slots:
        raise ManagerFailure("ASSIGNMENTS_RESPONSE_INVALID")
    assignments: list[Assignment] = []
    seen_slots: set[str] = set()
    seen_accounts: set[str] = set()
    allowed_fields = {
        "slotId", "slotCode", "slotNumber", "slotStatus", "accountId",
        "accountStatus", "tradeMode", "accountMask", "serverMask", "brokerMask",
    }
    for item in raw:
        if not isinstance(item, dict) or set(item) != allowed_fields:
            raise ManagerFailure("ASSIGNMENT_FIELDS_INVALID")
        slot_id = str(item.get("slotId") or "")
        slot_code = str(item.get("slotCode") or "")
        account_id = str(item.get("accountId") or "")
        try:
            slot_number = int(item.get("slotNumber"))
        except (TypeError, ValueError) as exc:
            raise ManagerFailure("ASSIGNMENT_SLOT_INVALID") from exc
        if (
            not _UUID_RE.fullmatch(slot_id)
            or not _UUID_RE.fullmatch(account_id)
            or not _SLOT_RE.fullmatch(slot_code)
            or not 1 <= slot_number <= max_slots
            or str(item.get("tradeMode") or "").upper() != "DEMO"
            or not re.fullmatch(r"\*{4}[A-Za-z0-9]{2,6}", str(item.get("accountMask") or ""))
            or not re.fullmatch(r"\*{4}[A-Za-z0-9._-]{2,12}", str(item.get("serverMask") or ""))
            or not re.fullmatch(r"\*{4}[A-Za-z0-9 ._-]{2,16}", str(item.get("brokerMask") or ""))
        ):
            raise ManagerFailure("ASSIGNMENT_INVALID")
        if slot_code in seen_slots or account_id in seen_accounts:
            raise ManagerFailure("ASSIGNMENT_DUPLICATE")
        seen_slots.add(slot_code)
        seen_accounts.add(account_id)
        assignments.append(Assignment(
            slot_id=slot_id,
            slot_code=slot_code,
            slot_number=slot_number,
            slot_status=str(item.get("slotStatus") or "")[:24],
            account_id=account_id,
            account_status=str(item.get("accountStatus") or "")[:32],
            trade_mode="DEMO",
            account_mask=str(item["accountMask"]),
            server_mask=str(item["serverMask"]),
            broker_mask=str(item["brokerMask"]),
        ))
    return assignments


@dataclass
class ChildState:
    assignment: Assignment
    process: Any
    slot_root: Path


class WorkerManager:
    def __init__(
        self,
        config: ManagerConfig,
        control_plane: GcpControlPlaneClient,
        *,
        process_factory: Callable[[list[str], Path], Any] | None = None,
        sleeper: Callable[[float], None] = time.sleep,
    ) -> None:
        self.config = config
        self.control_plane = control_plane
        self.sleeper = sleeper
        self.children: dict[str, ChildState] = {}
        self._process_factory = process_factory or self._start_process

    @staticmethod
    def _start_process(command: list[str], working_directory: Path) -> subprocess.Popen:
        flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        return subprocess.Popen(
            command,
            cwd=str(working_directory),
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            close_fds=True,
            creationflags=flags,
        )

    def _slot_root(self, slot_code: str) -> Path:
        if not _SLOT_RE.fullmatch(slot_code):
            raise ManagerFailure("ASSIGNMENT_SLOT_INVALID")
        return Path(self.config.slots_root) / slot_code

    def _materialize_slot(self, assignment: Assignment) -> tuple[Path, Path]:
        slot_root = self._slot_root(assignment.slot_code)
        terminal_root = slot_root / "mt5"
        terminal_path = terminal_root / self.config.terminal_executable_name
        config_root = slot_root / "worker"
        config_path = config_root / "worker-config.json"

        if not terminal_path.is_file():
            if terminal_root.exists():
                shutil.rmtree(terminal_root)
            template = Path(self.config.terminal_template_root)
            source_terminal = template / self.config.terminal_executable_name
            if not source_terminal.is_file():
                raise ManagerFailure("MT5_TEMPLATE_NOT_READY")
            slot_root.mkdir(parents=True, exist_ok=True)
            shutil.copytree(template, terminal_root)

        config_root.mkdir(parents=True, exist_ok=True)
        child_config = {
            "schemaVersion": 1,
            "cellId": assignment.slot_code,
            "provider": "GOOGLE_CLOUD",
            "controlPlaneUrl": self.config.control_plane_url,
            "controlPlaneAudience": f"{self.config.control_plane_url}/api/hosted-execution",
            "hostedAccountId": assignment.account_id,
            "keyAlias": self.config.key_alias,
            "keyVersionResource": self.config.key_version_resource,
            "demoOnly": True,
            "executionEnabled": True,
            "allowedDemoSymbols": list(self.config.allowed_demo_symbols),
            "credentialStorage": "MEMORY_ONLY",
            "privateKeyAvailable": False,
            "mt5TerminalPath": str(terminal_path),
            "approvedDemoServer": self.config.approved_demo_server,
            "heartbeatIntervalSeconds": self.config.heartbeat_seconds,
            "connectorVersion": self.config.connector_version,
        }
        encoded = json.dumps(child_config, indent=2, sort_keys=True)
        if _FORBIDDEN_CONFIG_KEYS.search(encoded):
            raise ManagerFailure("CHILD_CONFIG_SECRET_FIELD_REJECTED")
        temporary = config_path.with_suffix(".json.tmp")
        temporary.write_text(encoded, encoding="utf-8")
        os.replace(temporary, config_path)
        return slot_root, config_path

    @staticmethod
    def _stop_process(process: Any) -> None:
        if process is None or process.poll() is not None:
            return
        try:
            process.terminate()
            process.wait(timeout=15)
        except Exception:
            try:
                process.kill()
                process.wait(timeout=5)
            except Exception:
                pass

    def _retire_slot(self, slot_code: str, *, clean: bool = True) -> None:
        state = self.children.pop(slot_code, None)
        if state:
            self._stop_process(state.process)
            if clean and state.slot_root.exists():
                shutil.rmtree(state.slot_root, ignore_errors=True)

    def _launch(self, assignment: Assignment) -> None:
        gate = Path(self.config.execution_gate_path)
        child = Path(self.config.child_worker_path)
        if not gate.is_file():
            raise ManagerFailure("DEMO_EXECUTION_GATE_MISSING")
        if not child.is_file():
            raise ManagerFailure("CHILD_WORKER_NOT_FOUND")
        slot_root, config_path = self._materialize_slot(assignment)
        command = [
            str(child),
            "--config", str(config_path),
            "--execution-gate", str(gate),
        ]
        process = self._process_factory(command, child.parent)
        self.children[assignment.slot_code] = ChildState(
            assignment=assignment,
            process=process,
            slot_root=slot_root,
        )

    def reconcile_once(self) -> dict[str, int]:
        try:
            response = self.control_plane.assignments()
        except ControlPlaneError as exc:
            raise ManagerFailure("ASSIGNMENT_DISCOVERY_FAILED") from exc
        assignments = validate_assignments(response, self.config.max_slots)
        desired = {item.slot_code: item for item in assignments}

        for slot_code in list(self.children):
            state = self.children[slot_code]
            next_assignment = desired.get(slot_code)
            if next_assignment is None or next_assignment.account_id != state.assignment.account_id:
                self._retire_slot(slot_code, clean=True)

        started = 0
        restarted = 0
        for assignment in assignments:
            state = self.children.get(assignment.slot_code)
            if state is not None and state.process.poll() is None:
                continue
            if state is not None:
                self._retire_slot(assignment.slot_code, clean=False)
                restarted += 1
            self._launch(assignment)
            started += 1

        return {
            "assigned": len(assignments),
            "running": sum(
                1 for state in self.children.values() if state.process.poll() is None
            ),
            "started": started,
            "restarted": restarted,
        }

    def shutdown(self) -> None:
        for slot_code in list(self.children):
            self._retire_slot(slot_code, clean=False)

    def run_forever(self) -> None:
        while True:
            try:
                summary = self.reconcile_once()
                print(
                    "ZenCore worker manager: "
                    f"assigned={summary['assigned']} running={summary['running']}",
                    flush=True,
                )
            except ManagerFailure as exc:
                print(f"ZenCore worker manager state: {exc.code}", file=sys.stderr, flush=True)
            self.sleeper(self.config.poll_seconds)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="ZenCore multi-client MT5 worker manager")
    parser.add_argument(
        "--config",
        default=r"C:\ProgramData\ZenCore\HostedWorker\manager-config.json",
    )
    args = parser.parse_args(argv)
    manager: WorkerManager | None = None
    try:
        config = ManagerConfig.load(Path(args.config))
        manager = WorkerManager(
            config,
            GcpControlPlaneClient(config.control_plane_url),
        )
        manager.run_forever()
    except KeyboardInterrupt:
        if manager is not None:
            manager.shutdown()
        return 0
    except ManagerFailure as exc:
        if manager is not None:
            manager.shutdown()
        print(f"ZenCore worker manager state: {exc.code}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
