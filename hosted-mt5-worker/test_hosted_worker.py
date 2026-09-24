import base64
import json
import os
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from hosted_worker import (
    CONNECTOR_VERSION,
    HostedConnectionWorker,
    MetaTraderConnection,
    WorkerConfig,
    WorkerFailure,
)
from security_boundary import Mt5Credential


ACCOUNT_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"
LEASE_ID = "11111111-2222-4333-8444-555555555555"
KEY_ALIAS = "zencore-gcp-hsm-demo-v1"
KEY_RESOURCE = (
    "projects/zencore-demo-12345/locations/asia-southeast1/keyRings/"
    "zencore-mt5/cryptoKeys/credential-envelope/cryptoKeyVersions/1"
)


def config_dict(**overrides):
    value = {
        "schemaVersion": 1,
        "cellId": "zencore-mt5-demo-01",
        "provider": "GOOGLE_CLOUD",
        "controlPlaneUrl": "https://zencore-precision-entry.onrender.com",
        "controlPlaneAudience": (
            "https://zencore-precision-entry.onrender.com/api/hosted-execution"
        ),
        "hostedAccountId": ACCOUNT_ID,
        "keyAlias": KEY_ALIAS,
        "keyVersionResource": KEY_RESOURCE,
        "demoOnly": True,
        "executionEnabled": True,
        "allowedDemoSymbols": ["XAUUSD"],
        "credentialStorage": "MEMORY_ONLY",
        "privateKeyAvailable": False,
        "mt5TerminalPath": r"C:\Program Files\InterStellar MT5\terminal64.exe",
        "approvedDemoServer": "InterStellarFinancial-Demo",
        "heartbeatIntervalSeconds": 10,
        "connectorVersion": CONNECTOR_VERSION,
    }
    value.update(overrides)
    return value


def write_config(folder: str, value=None) -> Path:
    path = Path(folder, "worker-config.json")
    path.write_text(json.dumps(value or config_dict()), encoding="utf-8")
    return path


def b64url(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode("ascii").rstrip("=")


class FakeUnwrapper:
    def __init__(self, key):
        self.key = key

    def unwrap_rsa_oaep_sha256(self, key_id, wrapped_key):
        if key_id != KEY_ALIAS or len(wrapped_key) != 384:
            raise RuntimeError("invalid test envelope")
        return self.key


def envelope():
    key = os.urandom(32)
    iv = os.urandom(12)
    plaintext = json.dumps({
        "login": "123456",
        "password": "DemoPasswordOnly!",
        "server": "InterStellarFinancial-Demo",
        "tradeMode": "DEMO",
        "createdAt": 1_790_000_000_000,
    }, separators=(",", ":")).encode("utf-8")
    ciphertext = AESGCM(key).encrypt(iv, plaintext, None)
    return {
        "version": 1,
        "algorithm": "RSA-OAEP-256+A256GCM",
        "keyId": KEY_ALIAS,
        "wrappedKey": b64url(os.urandom(384)),
        "iv": b64url(iv),
        "ciphertext": b64url(ciphertext),
    }, FakeUnwrapper(key)


class FakeControlPlane:
    def __init__(self, credential_envelope, execution_enabled=True):
        self.credential_envelope = credential_envelope
        self.execution_enabled = execution_enabled
        self.heartbeats = []

    def lease(self, account_id, cell_id):
        return {
            "ok": True,
            "lease": {
                "id": LEASE_ID,
                "accountId": account_id,
                "keyId": KEY_ALIAS,
                "credentialEnvelope": self.credential_envelope,
                "expiresAt": 1_790_000_120_000,
                "demoOnly": True,
                "executionEnabled": self.execution_enabled,
                "accountMask": "****123456",
                "serverMask": "****ncial-Demo",
                "brokerMask": "****ellarFinancial",
            },
            "serverTime": 1_790_000_000_000,
        }

    def heartbeat(self, payload):
        self.heartbeats.append(json.loads(json.dumps(payload)))
        return {"ok": True, "connectionState": "CONNECTED_LOCKED", "executionEnabled": False}


class CapturingTerminal:
    def __init__(self):
        self.credential = None
        self.connect_count = 0

    def connect(self, _config, credential):
        self.connect_count += 1
        self.credential = credential
        self.assert_plaintext_available_during_connect()

    def assert_plaintext_available_during_connect(self):
        login, password, server = self.credential.text()
        assert login == "123456"
        assert password == "DemoPasswordOnly!"
        assert server == "InterStellarFinancial-Demo"

    def snapshot(self):
        return {
            "accountMask": "****123456",
            "serverMask": "****ncial-Demo",
            "brokerMask": "****ellarFinancial",
            "tradeMode": "DEMO",
            "connectionStatus": "CONNECTED",
            "terminalTradeAllowed": True,
            "accountTradeAllowed": True,
            "expertTradeAllowed": True,
            "demoExecutionUnlocked": True,
            "connectorVersion": CONNECTOR_VERSION,
            "terminalBuild": "5000",
            "symbolSpecs": [{
                "symbol": "XAUUSD", "tickSize": 0.01, "tickValue": 1.0,
                "volumeMin": 0.01, "volumeMax": 100.0, "volumeStep": 0.01,
            }],
            "positions": [],
        }

    def shutdown(self):
        pass


class FakeExecutor:
    def execute_place_setup(self, _payload):
        return SimpleNamespace(
            code="DEMO_SETUP_EXECUTED",
            broker_order_ids=("100001",),
            layers=1,
            total_lot=0.01,
        )



class FakeMt5:
    ACCOUNT_TRADE_MODE_DEMO = 0
    POSITION_TYPE_BUY = 0

    def __init__(self, positions=()):
        self.initialize_args = None
        self.positions = positions
        self.shutdown_count = 0

    def initialize(self, path, **kwargs):
        self.initialize_args = (path, kwargs)
        return True

    def account_info(self):
        return SimpleNamespace(
            login=123456,
            server="InterStellarFinancial-Demo",
            company="InterStellar Financial",
            trade_mode=0,
            trade_allowed=True,
            trade_expert=True,
        )

    def terminal_info(self):
        return SimpleNamespace(trade_allowed=True)

    def positions_get(self):
        return self.positions

    def version(self):
        return (500, 5000, "18 Sep 2026")

    def symbol_info(self, symbol):
        return SimpleNamespace(
            name=symbol,
            trade_tick_size=0.01,
            trade_tick_value=1.0,
            trade_tick_value_profit=1.0,
            trade_tick_value_loss=1.0,
            volume_min=0.01,
            volume_max=100.0,
            volume_step=0.01,
        )

    def shutdown(self):
        self.shutdown_count += 1


class HostedWorkerTests(unittest.TestCase):
    def test_strict_config_loads_only_locked_single_cell_assignment(self):
        with tempfile.TemporaryDirectory() as folder:
            config = WorkerConfig.load(write_config(folder))
            self.assertEqual(config.hosted_account_id, ACCOUNT_ID)
            self.assertEqual(config.allowed_demo_symbols, ("XAUUSD",))
            for changed in (
                {"executionEnabled": False},
                {"hostedAccountId": ""},
                {"controlPlaneAudience": "https://different.invalid/audience"},
                {"unknownField": "rejected"},
            ):
                with self.subTest(changed=changed):
                    with self.assertRaises(WorkerFailure):
                        WorkerConfig.load(write_config(folder, config_dict(**changed)))

    def test_runtime_leases_decrypts_connects_wipes_and_heartbeats_demo_execution(self):
        credential_envelope, unwrapper = envelope()
        control = FakeControlPlane(credential_envelope)
        terminal = CapturingTerminal()
        with tempfile.TemporaryDirectory() as folder:
            config = WorkerConfig.load(write_config(folder))
            lock = Path(folder, "EXECUTION_LOCKED")
            lock.write_text("locked", encoding="ascii")
            worker = HostedConnectionWorker(
                config, control, unwrapper, terminal, FakeExecutor(),
                execution_gate_path=lock,
                clock_ms=lambda: 1_790_000_001_000,
            )
            result = worker.connect_once()
        self.assertEqual(result["connectionState"], "CONNECTED_LOCKED")
        self.assertEqual(terminal.connect_count, 1)
        self.assertTrue(all(value == 0 for value in terminal.credential.login))
        self.assertTrue(all(value == 0 for value in terminal.credential.password))
        self.assertTrue(all(value == 0 for value in terminal.credential.server))
        self.assertEqual(len(control.heartbeats), 1)
        heartbeat = control.heartbeats[0]
        self.assertTrue(heartbeat["demoExecutionUnlocked"])
        self.assertEqual(heartbeat["accountId"], ACCOUNT_ID)
        self.assertEqual(heartbeat["leaseId"], LEASE_ID)
        self.assertNotIn("password", json.dumps(heartbeat).lower())

    def test_missing_execution_gate_or_locked_lease_fails_before_mt5(self):
        credential_envelope, unwrapper = envelope()
        terminal = CapturingTerminal()
        with tempfile.TemporaryDirectory() as folder:
            config = WorkerConfig.load(write_config(folder))
            missing = Path(folder, "EXECUTION_LOCKED")
            worker = HostedConnectionWorker(
                config, FakeControlPlane(credential_envelope), unwrapper, terminal, FakeExecutor(),
                execution_gate_path=missing,
            )
            with self.assertRaisesRegex(WorkerFailure, "DEMO_EXECUTION_GATE_MISSING"):
                worker.connect_once()
            missing.write_text("locked", encoding="ascii")
            worker = HostedConnectionWorker(
                config, FakeControlPlane(credential_envelope, execution_enabled=False),
                unwrapper, terminal, FakeExecutor(), execution_gate_path=missing,
            )
            with self.assertRaisesRegex(WorkerFailure, "LEASE_ASSIGNMENT_INVALID"):
                worker.connect_once()
        self.assertEqual(terminal.connect_count, 0)

    def test_expired_lease_stops_heartbeat_and_forces_reconnect(self):
        credential_envelope, unwrapper = envelope()
        control = FakeControlPlane(credential_envelope)
        terminal = CapturingTerminal()
        clock = [1_790_000_000_000]
        with tempfile.TemporaryDirectory() as folder:
            config = WorkerConfig.load(write_config(folder))
            lock = Path(folder, "EXECUTION_LOCKED")
            lock.write_text("locked", encoding="ascii")
            worker = HostedConnectionWorker(
                config, control, unwrapper, terminal, FakeExecutor(), execution_gate_path=lock,
                clock_ms=lambda: clock[0],
            )
            worker.connect_once()
            clock[0] = 1_790_000_120_000
            with self.assertRaisesRegex(WorkerFailure, "LEASE_EXPIRED"):
                worker.heartbeat_once()
        self.assertEqual(len(control.heartbeats), 1)

    def test_metatrader_adapter_reports_demo_specs_without_order_capability(self):
        with tempfile.TemporaryDirectory() as folder:
            config = WorkerConfig.load(write_config(folder))
        module = FakeMt5()
        adapter = MetaTraderConnection(module)
        credential = Mt5Credential(
            login=bytearray(b"123456"),
            password=bytearray(b"DemoPasswordOnly!"),
            server=bytearray(b"InterStellarFinancial-Demo"),
            trade_mode="DEMO",
            created_at=1_790_000_000_000,
        )
        adapter.connect(config, credential)
        telemetry = adapter.snapshot()
        self.assertEqual(telemetry["tradeMode"], "DEMO")
        self.assertEqual(telemetry["symbolSpecs"][0]["symbol"], "XAUUSD")
        self.assertTrue(telemetry["demoExecutionUnlocked"])
        self.assertFalse(hasattr(adapter, "order_send"))
        self.assertEqual(module.initialize_args[1]["server"], "InterStellarFinancial-Demo")

    def test_metatrader_adapter_reports_zencore_positions_and_rejects_real_account(self):
        with tempfile.TemporaryDirectory() as folder:
            config = WorkerConfig.load(write_config(folder))
        credential = Mt5Credential(
            login=bytearray(b"123456"), password=bytearray(b"DemoPasswordOnly!"),
            server=bytearray(b"InterStellarFinancial-Demo"), trade_mode="DEMO",
            created_at=1_790_000_000_000,
        )
        position = SimpleNamespace(
            magic=3233001, ticket=90001, symbol="XAUUSD", type=0, volume=0.01,
            price_open=3000.0, price_current=3005.0, sl=2990.0, tp=3010.0,
            profit=5.0, time=1_790_000_000, time_msc=1_790_000_000_000,
        )
        positioned = FakeMt5((position,))
        adapter = MetaTraderConnection(positioned)
        adapter.connect(config, credential)
        telemetry = adapter.snapshot()
        self.assertEqual(telemetry["positions"][0]["ticket"], "90001")
        self.assertEqual(telemetry["positions"][0]["symbol"], "XAUUSD")
        real = FakeMt5()
        real.account_info = lambda: SimpleNamespace(
            login=123456, server="InterStellarFinancial-Demo", company="InterStellar",
            trade_mode=1, trade_allowed=True, trade_expert=True,
        )
        with self.assertRaisesRegex(WorkerFailure, "MT5_REAL_ACCOUNT_BLOCKED"):
            MetaTraderConnection(real).connect(config, credential)


if __name__ == "__main__":
    unittest.main()
