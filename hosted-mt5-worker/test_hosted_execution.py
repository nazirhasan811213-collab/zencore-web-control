import base64
import hashlib
import hmac
import json
import tempfile
import time
import unittest
from pathlib import Path
from types import SimpleNamespace

import hosted_execution as execution
import security_boundary as boundary


class FakeMt5:
    ACCOUNT_TRADE_MODE_DEMO = 0
    POSITION_TYPE_BUY = 0
    POSITION_TYPE_SELL = 1
    TRADE_RETCODE_DONE = 10009
    TRADE_RETCODE_DONE_PARTIAL = 10010
    ORDER_FILLING_FOK = 0
    ORDER_FILLING_IOC = 1
    ORDER_FILLING_RETURN = 2
    SYMBOL_TRADE_EXECUTION_MARKET = 2

    def __init__(self, trade_mode=0):
        self.trade_mode = trade_mode

    def account_info(self):
        return SimpleNamespace(
            trade_mode=self.trade_mode,
            server="InterStellarFinancial-Demo",
            trade_allowed=True,
            trade_expert=True,
        )

    def terminal_info(self):
        return SimpleNamespace(trade_allowed=True, tradeapi_disabled=False)

    def positions_get(self):
        return ()


class FakeControl:
    def __init__(self):
        self.acks = []

    def acknowledge(self, account_id, lease_id, command_id, status, result):
        self.acks.append((account_id, lease_id, command_id, status, result))
        return {"ok": True}


def setup_payload(symbol="XAUUSD"):
    now = int(time.time() * 1000)
    snapshot = {
        "contractVersion": boundary.CONTRACT_VERSION,
        "decision": "ENTRY_AUTHORIZED",
        "decisionOwner": "ZENCORE_ANALYSIS",
        "strategy": boundary.STRATEGY,
        "schemaVersion": boundary.SCHEMA_VERSION,
        "symbol": symbol,
        "side": "BUY",
        "entry": 2500.0,
        "sl": 2495.0,
        "tp1": 2505.0,
        "tp2": 2510.0,
        "tp3": 2515.0,
        "sourceReceivedAt": now,
    }
    return {
        "analysisContractVersion": boundary.CONTRACT_VERSION,
        "analysisSnapshot": snapshot,
        "strategy": boundary.STRATEGY,
        "schemaVersion": boundary.SCHEMA_VERSION,
        "symbol": symbol,
        "side": "BUY",
        "layers": 3,
        "lotPerLayer": 0.01,
        "totalLot": 0.03,
        "entry": 2500.0,
        "sl": 2495.0,
        "tp1": 2505.0,
        "tp2": 2510.0,
        "tp3": 2515.0,
        "signalReceivedAt": now,
    }


class HostedExecutionTests(unittest.TestCase):
    def engine(self, folder, *, enabled=True, trade_mode=0):
        config = SimpleNamespace(
            execution_enabled=enabled,
            allowed_demo_symbols=("XAUUSD",),
        )
        return execution.HostedExecutionEngine(
            FakeMt5(trade_mode=trade_mode),
            config,
            Path(folder) / "execution-ledger.db",
        )

    def test_demo_execution_build_is_xauusd_only_and_real_accounts_fail_closed(self):
        self.assertTrue(boundary.HOSTED_DEMO_ORDER_EXECUTION_BUILD_UNLOCKED)
        with tempfile.TemporaryDirectory() as folder:
            engine = self.engine(folder)
            engine.assert_demo_terminal(require_execution=True)
            engine.validate_setup_payload(setup_payload())
            with self.assertRaisesRegex(RuntimeError, "XAUUSD"):
                engine.validate_setup_payload(setup_payload("EURUSD"))
        with tempfile.TemporaryDirectory() as folder:
            real = self.engine(folder, trade_mode=1)
            with self.assertRaisesRegex(RuntimeError, "DEMO"):
                real.assert_demo_terminal(require_execution=True)

    def test_config_gate_blocks_execution_even_in_execution_capable_build(self):
        with tempfile.TemporaryDirectory() as folder:
            engine = self.engine(folder, enabled=False)
            with self.assertRaisesRegex(RuntimeError, "gate is locked"):
                engine.assert_demo_terminal(require_execution=True)

    def test_signed_command_is_bound_to_hidden_command_target(self):
        with tempfile.TemporaryDirectory() as folder:
            engine = self.engine(folder)
            pod_id = "22222222-3333-4444-8555-666666666666"
            key = "k" * 64
            engine.set_command_identity(pod_id, key)
            command = {
                "id": "77777777-8888-4999-8aaa-bbbbbbbbbbbb",
                "userId": "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
                "podId": pod_id,
                "type": "SYSTEM_ON",
                "payload": {
                    "mode": "DEMO",
                    "strategy": boundary.STRATEGY,
                    "exitSchema": boundary.SCHEMA_VERSION,
                    "settings": {"symbols": ["XAUUSD"]},
                },
                "createdAt": int(time.time() * 1000),
                "expiresAt": int(time.time() * 1000) + 60_000,
            }
            raw = json.dumps(command, separators=(",", ":")).encode("utf-8")
            wire = {
                key_name: command[key_name]
                for key_name in ("id", "type", "payload", "createdAt", "expiresAt")
            }
            wire["signedEnvelope"] = base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")
            wire["signature"] = hmac.new(key.encode("utf-8"), raw, hashlib.sha256).hexdigest()
            verified = engine.verify_command(wire)
            self.assertEqual(verified["podId"], pod_id)
            tampered = dict(wire)
            tampered["signature"] = "0" * 64
            with self.assertRaisesRegex(RuntimeError, "signature"):
                engine.verify_command(tampered)

    def test_replay_ledger_blocks_duplicate_command_processing(self):
        with tempfile.TemporaryDirectory() as folder:
            engine = self.engine(folder)
            pod_id = "22222222-3333-4444-8555-666666666666"
            key = "k" * 64
            engine.set_command_identity(pod_id, key)
            command_id = "77777777-8888-4999-8aaa-bbbbbbbbbbbb"
            envelope = {
                "id": command_id,
                "userId": "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
                "podId": pod_id,
                "type": "SYSTEM_ON",
                "payload": {
                    "mode": "DEMO",
                    "strategy": boundary.STRATEGY,
                    "exitSchema": boundary.SCHEMA_VERSION,
                    "settings": {"symbols": ["XAUUSD"]},
                },
                "createdAt": int(time.time() * 1000),
                "expiresAt": int(time.time() * 1000) + 60_000,
            }
            raw = json.dumps(envelope, separators=(",", ":")).encode("utf-8")
            command = {
                key_name: envelope[key_name]
                for key_name in ("id", "type", "payload", "createdAt", "expiresAt")
            }
            command["signedEnvelope"] = base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")
            command["signature"] = hmac.new(key.encode("utf-8"), raw, hashlib.sha256).hexdigest()
            control = FakeControl()
            engine.process_command(command, control, "account", "lease")
            engine.process_command(command, control, "account", "lease")
            self.assertEqual(control.acks[0][3], "EXECUTED")
            self.assertEqual(control.acks[1][3], "EXECUTED")
            self.assertTrue(engine.ledger.armed())


if __name__ == "__main__":
    unittest.main()
