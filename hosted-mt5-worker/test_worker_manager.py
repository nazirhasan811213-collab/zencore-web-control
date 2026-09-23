import json
import os
import tempfile
import unittest
from pathlib import Path

from worker_manager import (
    Assignment,
    CONNECTOR_VERSION,
    ManagerConfig,
    ManagerFailure,
    WorkerManager,
    validate_assignments,
)


class FakeProcess:
    def __init__(self):
        self.returncode = None
        self.terminated = False
        self.killed = False

    def poll(self):
        return self.returncode

    def terminate(self):
        self.terminated = True
        self.returncode = 0

    def wait(self, timeout=None):
        return self.returncode

    def kill(self):
        self.killed = True
        self.returncode = -9


class FakeControlPlane:
    def __init__(self, assignments):
        self.current = assignments

    def assignments(self):
        return {"ok": True, "assignments": list(self.current)}


def assignment(slot_no, account_id, account_tail):
    return {
        "slotId": f"{slot_no:08d}-1111-4111-8111-{slot_no:012d}",
        "slotCode": f"zencore-mt5-demo-01-s{slot_no:02d}",
        "slotNumber": slot_no,
        "slotStatus": "RESERVED",
        "accountId": account_id,
        "accountStatus": "QUEUED_FOR_WORKER",
        "tradeMode": "DEMO",
        "accountMask": f"****{account_tail}",
        "serverMask": "****ncial-Demo",
        "brokerMask": "****ellarFinancial",
    }


class WorkerManagerTests(unittest.TestCase):
    def _config(self, root: Path, *, execution_enabled: bool = True) -> ManagerConfig:
        template = root / "template"
        template.mkdir()
        (template / "terminal64.exe").write_bytes(b"fake-terminal")
        child = root / "ZenCoreHostedWorker.exe"
        child.write_bytes(b"fake-worker")
        gate = root / "DEMO_EXECUTION_ENABLED"
        if execution_enabled:
            gate.write_text("enabled", encoding="ascii")
        slots = root / "slots"
        return ManagerConfig(
            control_plane_url="https://zencore-precision-entry.onrender.com",
            key_alias="zencore-gcp-hsm-demo-v1",
            key_version_resource=(
                "projects/zencore-total-trade-system/locations/asia-southeast1/"
                "keyRings/zencore/cryptoKeys/mt5/cryptoKeyVersions/1"
            ),
            child_worker_path=str(child),
            terminal_template_root=str(template),
            terminal_executable_name="terminal64.exe",
            slots_root=str(slots),
            execution_gate_path=str(gate),
            approved_demo_server="InterStellarFinancial-Demo",
            allowed_demo_symbols=("XAUUSD", "EURUSD"),
            heartbeat_seconds=10,
            poll_seconds=10,
            connector_version=CONNECTOR_VERSION,
            execution_enabled=execution_enabled,
            max_slots=10,
        )

    def test_manager_config_requires_explicit_boolean_execution_mode(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            config = self._config(root, execution_enabled=False)
            raw = {
                "schemaVersion": 1,
                "provider": "GOOGLE_CLOUD",
                "controlPlaneUrl": config.control_plane_url,
                "keyAlias": config.key_alias,
                "keyVersionResource": config.key_version_resource,
                "childWorkerPath": r"C:\Program Files\ZenCore\HostedWorker\2.2.2\ZenCoreHostedWorker.exe",
                "terminalTemplateRoot": r"C:\ProgramData\ZenCore\MT5Template",
                "terminalExecutableName": config.terminal_executable_name,
                "slotsRoot": r"C:\ProgramData\ZenCore\HostedWorker\slots",
                "executionGatePath": r"C:\ProgramData\ZenCore\HostedWorker\DEMO_EXECUTION_ENABLED",
                "approvedDemoServer": config.approved_demo_server,
                "allowedDemoSymbols": list(config.allowed_demo_symbols),
                "heartbeatIntervalSeconds": config.heartbeat_seconds,
                "pollIntervalSeconds": config.poll_seconds,
                "connectorVersion": config.connector_version,
                "demoOnly": True,
                "credentialStorage": "CHILD_WORKER_MEMORY_ONLY",
                "privateKeyAvailable": False,
                "executionEnabled": False,
                "maxSlots": config.max_slots,
            }
            path = root / "manager-config.json"
            path.write_text(json.dumps(raw), encoding="utf-8")
            loaded = ManagerConfig.load(path)
            self.assertFalse(loaded.execution_enabled)

            raw["executionEnabled"] = "false"
            path.write_text(json.dumps(raw), encoding="utf-8")
            with self.assertRaisesRegex(ManagerFailure, "MANAGER_SECURITY_BOUNDARY_INVALID"):
                ManagerConfig.load(path)

    def test_assignment_schema_rejects_secret_fields(self):
        item = assignment(
            1,
            "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
            "123456",
        )
        item["credentialEnvelope"] = {"ciphertext": "must-not-reach-manager"}
        with self.assertRaises(ManagerFailure):
            validate_assignments({"ok": True, "assignments": [item]}, 10)

    def test_manager_materializes_unique_slot_configs_and_starts_one_child_per_account(self):
        items = [
            assignment(1, "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", "123456"),
            assignment(2, "11111111-2222-4333-8444-555555555555", "654321"),
        ]
        launched = []

        def start(command, cwd):
            process = FakeProcess()
            launched.append((command, cwd, process))
            return process

        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            config = self._config(root)
            manager = WorkerManager(
                config,
                FakeControlPlane(items),
                process_factory=start,
                terminal_factory=lambda *_: FakeProcess(), sleeper=lambda _: None,
            )
            result = manager.reconcile_once()
            self.assertEqual(result["assigned"], 2)
            self.assertEqual(result["running"], 2)
            self.assertEqual(len(launched), 2)
            for command, _cwd, _process in launched:
                manager_pid_index = command.index("--manager-pid") + 1
                self.assertEqual(command[manager_pid_index], str(os.getpid()))

            configs = []
            for item in items:
                slot_root = Path(config.slots_root) / item["slotCode"]
                worker_config = slot_root / "worker" / "worker-config.json"
                terminal = slot_root / "mt5" / "terminal64.exe"
                self.assertTrue(worker_config.is_file())
                self.assertTrue(terminal.is_file())
                data = json.loads(worker_config.read_text(encoding="utf-8"))
                configs.append(data)
                self.assertEqual(data["cellId"], item["slotCode"])
                self.assertEqual(data["hostedAccountId"], item["accountId"])
                self.assertEqual(data["mt5TerminalPath"], str(terminal))
                self.assertEqual(data["allowedDemoSymbols"], ["XAUUSD", "EURUSD"])
                self.assertTrue(data["executionEnabled"])
                serialized = json.dumps(data).lower()
                self.assertNotIn("password", serialized)
                self.assertNotIn("credentialenvelope", serialized)
                self.assertNotIn("ciphertext", serialized)

            self.assertNotEqual(
                configs[0]["mt5TerminalPath"],
                configs[1]["mt5TerminalPath"],
            )

    def test_manager_retires_removed_assignment_and_wipes_isolated_slot(self):
        item = assignment(
            1,
            "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
            "123456",
        )
        control = FakeControlPlane([item])
        processes = []

        def start(_command, _cwd):
            process = FakeProcess()
            processes.append(process)
            return process

        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            config = self._config(root)
            manager = WorkerManager(config, control, process_factory=start,
                                    terminal_factory=lambda *_: FakeProcess(), sleeper=lambda _: None)
            manager.reconcile_once()
            slot_root = Path(config.slots_root) / item["slotCode"]
            self.assertTrue(slot_root.exists())

            control.current = []
            result = manager.reconcile_once()
            self.assertEqual(result["running"], 0)
            self.assertTrue(processes[0].terminated)
            self.assertFalse(slot_root.exists())

    def test_manager_restarts_crashed_child_without_crossing_accounts(self):
        item = assignment(
            1,
            "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
            "123456",
        )
        launched = []

        def start(_command, _cwd):
            process = FakeProcess()
            launched.append(process)
            return process

        with tempfile.TemporaryDirectory() as folder:
            config = self._config(Path(folder))
            manager = WorkerManager(
                config,
                FakeControlPlane([item]),
                process_factory=start,
                terminal_factory=lambda *_: FakeProcess(), sleeper=lambda _: None,
            )
            manager.reconcile_once()
            launched[0].returncode = 2
            result = manager.reconcile_once()
            self.assertEqual(result["restarted"], 1)
            self.assertEqual(result["running"], 1)
            self.assertEqual(len(launched), 2)
            self.assertEqual(
                manager.children[item["slotCode"]].assignment.account_id,
                item["accountId"],
            )

    def test_connection_only_preflight_launches_without_gate_and_stops_on_gate_drift(self):
        item = assignment(
            1,
            "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
            "123456",
        )
        launched = []

        def start(_command, _cwd):
            process = FakeProcess()
            launched.append(process)
            return process

        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            config = self._config(root, execution_enabled=False)
            manager = WorkerManager(
                config,
                FakeControlPlane([item]),
                process_factory=start,
                terminal_factory=lambda *_: FakeProcess(), sleeper=lambda _: None,
            )
            result = manager.reconcile_once()
            self.assertEqual(result["running"], 1)
            child_config = json.loads((
                Path(config.slots_root) / item["slotCode"] /
                "worker" / "worker-config.json"
            ).read_text(encoding="utf-8"))
            self.assertFalse(child_config["executionEnabled"])

            Path(config.execution_gate_path).write_text("unexpected", encoding="ascii")
            with self.assertRaisesRegex(ManagerFailure, "PREFLIGHT_EXECUTION_GATE_PRESENT"):
                manager.reconcile_once()
            self.assertTrue(launched[0].terminated)
            self.assertEqual(manager.children, {})

    def test_configured_terminal_precedes_worker_and_contains_no_credentials(self):
        items = [assignment(1, "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", "123456"),
                 assignment(2, "11111111-2222-4333-8444-555555555555", "654321")]
        events = []
        def terminal(command, cwd):
            events.append(("terminal", command))
            startup = Path(command[1].removeprefix("/config:"))
            self.assertEqual(startup.read_text(encoding="utf-16"),
                             "[Experts]\nEnabled=1\nAllowLiveTrading=1\n")
            self.assertEqual(Path(command[0]).parent, cwd)
            return FakeProcess()
        def worker(command, cwd):
            events.append(("worker", command))
            return FakeProcess()
        with tempfile.TemporaryDirectory() as folder:
            config = self._config(Path(folder), execution_enabled=False)
            manager = WorkerManager(config, FakeControlPlane(items), process_factory=worker,
                                    terminal_factory=terminal, sleeper=lambda _: events.append(("wait", [])))
            manager.reconcile_once()
            self.assertEqual([e[0] for e in events], ["terminal", "wait", "worker"] * 2)
            self.assertNotEqual(events[0][1][1], events[3][1][1])
            manager.reconcile_once()
            self.assertEqual(len(events), 6)  # Healthy slots are not launched twice.

    def test_crashed_terminal_retires_worker_and_relaunches_with_config(self):
        item = assignment(1, "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", "123456")
        terminals, workers, commands = [], [], []
        def terminal(command, cwd):
            proc = FakeProcess(); terminals.append(proc); commands.append(command)
            return proc
        def worker(command, cwd):
            proc = FakeProcess(); workers.append(proc)
            return proc
        with tempfile.TemporaryDirectory() as folder:
            manager = WorkerManager(self._config(Path(folder)), FakeControlPlane([item]),
                                    process_factory=worker, terminal_factory=terminal, sleeper=lambda _: None)
            manager.reconcile_once()
            terminals[0].returncode = 1
            result = manager.reconcile_once()
            self.assertTrue(workers[0].terminated)
            self.assertEqual(result["restarted"], 1)
            self.assertEqual(commands[0], commands[1])
            manager.shutdown()
            self.assertTrue(workers[1].terminated)
            self.assertTrue(terminals[1].terminated)

    def test_terminal_launch_exit_never_starts_worker(self):
        item = assignment(1, "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", "123456")
        terminal = FakeProcess(); terminal.returncode = 0
        with tempfile.TemporaryDirectory() as folder:
            manager = WorkerManager(self._config(Path(folder)), FakeControlPlane([item]),
                                    process_factory=lambda *_: self.fail("worker must not launch"),
                                    terminal_factory=lambda *_: terminal, sleeper=lambda _: None)
            self.assertEqual(manager.reconcile_once()["failed"], 1)
            self.assertEqual(manager.failures[item["slotCode"]]["code"], "MT5_CONFIGURED_TERMINAL_EXITED")
            self.assertEqual(manager.children, {})

    def test_worker_launch_failure_cleans_up_terminal_and_redacts_error(self):
        item = assignment(1, "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", "123456")
        terminal = FakeProcess()
        def fail(*_):
            raise OSError("private launch details")
        with tempfile.TemporaryDirectory() as folder:
            manager = WorkerManager(self._config(Path(folder)), FakeControlPlane([item]),
                                    process_factory=fail, terminal_factory=lambda *_: terminal,
                                    sleeper=lambda _: None)
            self.assertEqual(manager.reconcile_once()["failed"], 1)
            self.assertEqual(manager.failures[item["slotCode"]]["code"], "SLOT_PROCESS_START_FAILED")
            self.assertTrue(terminal.terminated)
            self.assertEqual(manager.children, {})

    def test_execution_gate_drift_during_terminal_start_stops_terminal(self):
        item = assignment(1, "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", "123456")
        terminal = FakeProcess()
        with tempfile.TemporaryDirectory() as folder:
            config = self._config(Path(folder), execution_enabled=False)
            manager = WorkerManager(config, FakeControlPlane([item]),
                                    process_factory=lambda *_: self.fail("worker must not launch"),
                                    terminal_factory=lambda *_: terminal,
                                    sleeper=lambda _: Path(config.execution_gate_path).write_text("drift"))
            with self.assertRaisesRegex(ManagerFailure, "PREFLIGHT_EXECUTION_GATE_PRESENT"):
                manager.reconcile_once()
            self.assertTrue(terminal.terminated)

    def test_s02_failure_does_not_block_s03_and_retry_preserves_healthy_slots(self):
        items = [assignment(n, f"{n:08d}-bbbb-4ccc-8ddd-eeeeeeeeeeee", "123456") for n in (1, 2, 3)]
        terminals, workers, events = {}, {}, []
        failing = [True]
        now = [0.0]
        def terminal(command, cwd):
            slot = cwd.parent.name
            proc = FakeProcess()
            if slot.endswith("s02") and failing[0]: proc.returncode = 1
            terminals.setdefault(slot, []).append(proc)
            return proc
        def worker(command, cwd):
            slot = Path(command[command.index("--config") + 1]).parents[1].name
            proc = FakeProcess(); workers.setdefault(slot, []).append(proc)
            return proc
        with tempfile.TemporaryDirectory() as folder:
            manager = WorkerManager(self._config(Path(folder)), FakeControlPlane(items),
                                    process_factory=worker, terminal_factory=terminal,
                                    sleeper=lambda _: None, clock=lambda: now[0],
                                    reporter=lambda *args: events.append(args))
            self.assertEqual(manager.reconcile_once()["running"], 2)
            self.assertIn(items[2]["slotCode"], manager.children)
            manager.reconcile_once()  # Backoff: no tight restart loop.
            self.assertEqual(len(terminals[items[1]["slotCode"]]), 1)
            failing[0] = False; now[0] = 100
            self.assertEqual(manager.reconcile_once()["running"], 3)
            self.assertEqual(len(workers[items[0]["slotCode"]]), 1)
            self.assertEqual(len(workers[items[2]["slotCode"]]), 1)
            self.assertEqual(manager.failures, {})
            self.assertIn((items[1]["slotCode"], "MT5_CONFIGURED_TERMINAL_EXITED"), events)
            manager.shutdown()
            self.assertTrue(all(p.terminated for values in workers.values() for p in values))

    def test_s02_filesystem_error_is_redacted_and_does_not_block_s03(self):
        items = [assignment(n, f"{n:08d}-bbbb-4ccc-8ddd-eeeeeeeeeeee", "123456") for n in (1, 2, 3)]
        events = []
        with tempfile.TemporaryDirectory() as folder:
            manager = WorkerManager(self._config(Path(folder)), FakeControlPlane(items),
                                    process_factory=lambda *_: FakeProcess(),
                                    terminal_factory=lambda *_: FakeProcess(), sleeper=lambda _: None,
                                    reporter=lambda *args: events.append(args))
            original = manager._materialize_slot
            def materialize(item):
                if item.slot_number == 2: raise PermissionError("secret-account-detail")
                return original(item)
            manager._materialize_slot = materialize
            self.assertEqual(manager.reconcile_once()["running"], 2)
            self.assertIn(items[2]["slotCode"], manager.children)
            self.assertNotIn("secret-account-detail", str(events))
            manager.shutdown()


if __name__ == "__main__":
    unittest.main()
