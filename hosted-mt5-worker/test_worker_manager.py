import json
import tempfile
import unittest
from pathlib import Path

from worker_manager import (
    Assignment,
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
    def _config(self, root: Path) -> ManagerConfig:
        template = root / "template"
        template.mkdir()
        (template / "terminal64.exe").write_bytes(b"fake-terminal")
        child = root / "ZenCoreHostedWorker.exe"
        child.write_bytes(b"fake-worker")
        gate = root / "DEMO_EXECUTION_ENABLED"
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
            allowed_demo_symbols=("XAUUSD",),
            heartbeat_seconds=10,
            poll_seconds=10,
            connector_version="2.1.0-gcp-demo-execution",
            max_slots=10,
        )

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
            )
            result = manager.reconcile_once()
            self.assertEqual(result["assigned"], 2)
            self.assertEqual(result["running"], 2)
            self.assertEqual(len(launched), 2)

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
            manager = WorkerManager(config, control, process_factory=start)
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


if __name__ == "__main__":
    unittest.main()
