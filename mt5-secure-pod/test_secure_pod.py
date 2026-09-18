import importlib.util
import sys
import tempfile
import types
import unittest
from pathlib import Path
from types import SimpleNamespace
import time


fake_mt5 = types.ModuleType("MetaTrader5")
fake_mt5.TRADE_RETCODE_DONE = 10009
fake_mt5.TRADE_RETCODE_DONE_PARTIAL = 10010
fake_mt5.ORDER_FILLING_FOK = 0
fake_mt5.ORDER_FILLING_IOC = 1
fake_mt5.ORDER_FILLING_RETURN = 2
fake_mt5.SYMBOL_TRADE_EXECUTION_MARKET = 2
fake_mt5.ACCOUNT_TRADE_MODE_DEMO = 0
fake_mt5.POSITION_TYPE_BUY = 0
fake_mt5.POSITION_TYPE_SELL = 1
fake_mt5.symbol_info = lambda _symbol: SimpleNamespace(
    volume_min=0.01,
    volume_max=100.0,
    volume_step=0.01,
    filling_mode=3,
    trade_exemode=2,
    digits=2,
)
sys.modules["MetaTrader5"] = fake_mt5

module_path = Path(__file__).with_name("ZenCoreSecurePod.py")
spec = importlib.util.spec_from_file_location("zencore_secure_pod_test_module", module_path)
worker = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = worker
spec.loader.exec_module(worker)


class SecurePodPureTests(unittest.TestCase):
    def setUp(self):
        self.pod = object.__new__(worker.SecurePod)

    def test_server_allowlist_normalisation_is_exact(self):
        self.assertEqual(
            self.pod.server_id("InterStellarFinancial-Demo"),
            worker.INTERSTELLAR_DEMO_SERVER_ID,
        )
        self.assertNotEqual(
            self.pod.server_id("DifferentBroker-Demo"),
            worker.INTERSTELLAR_DEMO_SERVER_ID,
        )

    def test_broker_volume_rounding_closes_two_of_three_micro_layers(self):
        info = fake_mt5.symbol_info("XAUUSD")
        self.assertEqual(self.pod.normalise_volume(info, 0.015, "up"), 0.02)
        positions = [
            SimpleNamespace(ticket=index, symbol="XAUUSD", volume=0.01)
            for index in (101, 102, 103)
        ]
        self.pod.zencore_positions = lambda: positions
        self.pod.canonical_symbol = lambda _symbol: "XAUUSD"
        closed = []
        self.pod.close_position = lambda position, volume: closed.append(
            (position.ticket, volume)
        ) or str(position.ticket)
        order_ids = self.pod.close_symbol_percent("XAUUSD", 50)
        self.assertEqual(order_ids, ["101", "102"])
        self.assertEqual(closed, [(101, 0.01), (102, 0.01)])

    def test_setup_validator_is_xauusd_only_and_checks_level_direction(self):
        valid = {
            "strategy": "NORMAL_3M_SOP_V32",
            "schemaVersion": "32.3-EXIT-STEPLOCK",
            "symbol": "XAUUSD",
            "side": "BUY",
            "layers": 3,
            "lotPerLayer": 0.01,
            "entry": 2500,
            "sl": 2495,
            "tp1": 2505,
            "tp2": 2510,
            "tp3": 2515,
            "signalReceivedAt": int(time.time() * 1000),
        }
        self.pod.validate_setup_payload(valid)
        with self.assertRaisesRegex(RuntimeError, "only permits XAUUSD"):
            self.pod.validate_setup_payload({**valid, "symbol": "EURUSD"})
        with self.assertRaisesRegex(RuntimeError, "do not match"):
            self.pod.validate_setup_payload({**valid, "sl": 2501})

    def test_market_execution_uses_only_broker_supported_fill_modes(self):
        info = SimpleNamespace(filling_mode=3, trade_exemode=2)
        self.assertEqual(
            self.pod.filling_modes(info),
            [fake_mt5.ORDER_FILLING_FOK, fake_mt5.ORDER_FILLING_IOC],
        )

    def test_tp1_step_lock_uses_each_position_actual_entry(self):
        position = SimpleNamespace(symbol="XAUUSD", type=fake_mt5.POSITION_TYPE_BUY)
        fake_mt5.symbol_info_tick = lambda _symbol: SimpleNamespace(bid=2505.0, ask=2505.2)
        with tempfile.TemporaryDirectory() as directory:
            self.pod.ledger = worker.Ledger(Path(directory) / "ledger.db")
            self.pod.ledger.save_plan("XAUUSD", {
                "symbol": "XAUUSD", "side": "BUY", "entry": 2500.0,
                "initialSl": 2495.0, "tp1": 2505.0, "tp2": 2510.0,
                "tp3": 2515.0, "lockStage": 0,
            })
            self.pod.zencore_positions = lambda: [position]
            self.pod.canonical_symbol = lambda _symbol: "XAUUSD"
            calls = []
            self.pod.modify_sl = lambda symbol, level, use_position_entry=False: calls.append(
                (symbol, level, use_position_entry)
            ) or 1
            self.pod.local_step_lock()
            self.assertEqual(calls, [("XAUUSD", None, True)])
            self.assertEqual(self.pod.ledger.plan("XAUUSD")["lockStage"], 1)

    def test_close_separuh_is_semantically_idempotent(self):
        position = SimpleNamespace(symbol="XAUUSD")
        with tempfile.TemporaryDirectory() as directory:
            self.pod.ledger = worker.Ledger(Path(directory) / "ledger.db")
            self.pod.ledger.save_plan("XAUUSD", {
                "symbol": "XAUUSD", "partialCloseDone": False, "lockStage": 0,
            })
            self.pod.assert_demo_terminal = lambda require_execution=False: (None, None)
            self.pod.zencore_positions = lambda: [position]
            self.pod.canonical_symbol = lambda _symbol: "XAUUSD"
            calls = []
            self.pod.close_symbol_percent = lambda symbol, percent: calls.append(
                (symbol, percent)
            ) or ["close-1"]
            payload = {
                "strategy": "NORMAL_3M_SOP_V32",
                "schemaVersion": "32.3-EXIT-STEPLOCK",
                "symbol": "XAUUSD",
                "actions": [{"type": "CLOSE_PERCENT", "percent": 50}],
            }
            first = self.pod.manage_position(payload)
            second = self.pod.manage_position(payload)
            self.assertEqual(first["closedOrders"], ["close-1"])
            self.assertEqual(second["closedOrders"], [])
            self.assertEqual(calls, [("XAUUSD", 50.0)])


class LedgerReplayTests(unittest.TestCase):
    def test_command_claim_is_atomic_and_blocks_replay(self):
        with tempfile.TemporaryDirectory() as directory:
            ledger = worker.Ledger(Path(directory) / "ledger.db")
            self.assertTrue(ledger.claim_command("command-1"))
            self.assertFalse(ledger.claim_command("command-1"))
            self.assertEqual(ledger.previous_result("command-1")[0], "IN_PROGRESS")


if __name__ == "__main__":
    unittest.main()
