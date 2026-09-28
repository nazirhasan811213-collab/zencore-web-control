import unittest
import tempfile
from pathlib import Path
from types import SimpleNamespace

from demo_executor import DemoExecutionError, DemoExecutor, MAGIC
import security_boundary as boundary


def payload(now=1_790_000_000_000):
    snapshot = {
        "contractVersion": boundary.CONTRACT_VERSION,
        "decision": "ENTRY_AUTHORIZED",
        "decisionOwner": "ZENCORE_ANALYSIS",
        "strategy": boundary.STRATEGY,
        "schemaVersion": boundary.SCHEMA_VERSION,
        "symbol": "XAUUSD",
        "side": "BUY",
        "entry": 3000.0,
        "sl": 2990.0,
        "tp1": 3010.0,
        "tp2": 3020.0,
        "tp3": 3030.0,
        "sourceReceivedAt": now,
    }
    return {
        "analysisContractVersion": boundary.CONTRACT_VERSION,
        "analysisSnapshot": snapshot,
        "strategy": boundary.STRATEGY,
        "schemaVersion": boundary.SCHEMA_VERSION,
        "symbol": "XAUUSD",
        "side": "BUY",
        "entry": 3000.0,
        "sl": 2990.0,
        "tp1": 3010.0,
        "tp2": 3020.0,
        "tp3": 3030.0,
        "lotPerLayer": 0.01,
        "layers": 3,
        "totalLot": 0.03,
        "signalReceivedAt": now,
    }


class FakeMt5:
    ACCOUNT_TRADE_MODE_DEMO = 0
    ORDER_TYPE_BUY = 0
    ORDER_TYPE_SELL = 1
    TRADE_ACTION_DEAL = 1
    TRADE_ACTION_SLTP = 6
    POSITION_TYPE_BUY = 0
    POSITION_TYPE_SELL = 1
    ORDER_TIME_GTC = 0
    ORDER_FILLING_IOC = 1
    TRADE_RETCODE_DONE = 10009
    TRADE_RETCODE_DONE_PARTIAL = 10010

    def __init__(self):
        self.sent = []
        self.trade_mode = 0
        self.server = "InterStellarFinancial-Demo"
        self.positions = []

    def account_info(self):
        return SimpleNamespace(
            trade_mode=self.trade_mode, server=self.server,
            trade_allowed=True, trade_expert=True,
        )

    def terminal_info(self):
        return SimpleNamespace(trade_allowed=True)

    def symbol_info(self, symbol):
        return SimpleNamespace(name=symbol, volume_min=0.01, volume_max=100.0, volume_step=0.01)

    def symbol_info_tick(self, symbol):
        if symbol == "EURUSD":
            return SimpleNamespace(ask=1.1001, bid=1.1)
        return SimpleNamespace(ask=3001.0, bid=3000.5)

    def positions_get(self, **_kwargs):
        return self.positions

    def order_check(self, request):
        return SimpleNamespace(retcode=0, request=request)

    def order_send(self, request):
        self.sent.append(request.copy())
        if "position" in request:
            position = next(p for p in self.positions if p.ticket == request["position"])
            if request["action"] == self.TRADE_ACTION_SLTP:
                position.sl = request["sl"]
            else:
                position.volume = round(position.volume - request["volume"], 8)
                if position.volume < 1e-8:
                    self.positions.remove(position)
        return SimpleNamespace(retcode=10009, order=100000 + len(self.sent), deal=0)


class DemoExecutorTests(unittest.TestCase):
    def setUp(self):
        self.mt5 = FakeMt5()
        self.executor = DemoExecutor(
            self.mt5,
            approved_server="InterStellarFinancial-Demo",
            allowed_symbols=("XAUUSD",),
            execution_enabled=True,
            clock_ms=lambda: 1_790_000_000_000,
        )

    def test_three_layer_demo_setup_uses_analysis_sl_and_three_tps(self):
        result = self.executor.execute_place_setup(payload())
        self.assertEqual(result.total_lot, 0.03)
        self.assertEqual(len(self.mt5.sent), 3)
        self.assertEqual([x["tp"] for x in self.mt5.sent], [3010.0, 3020.0, 3030.0])
        self.assertTrue(all(x["magic"] == MAGIC for x in self.mt5.sent))
        self.assertTrue(all(x["volume"] == 0.01 for x in self.mt5.sent))

    def test_ten_layers_match_user_configuration_and_keep_total_volume_cap(self):
        command = payload()
        command["layers"] = 10
        command["totalLot"] = 0.1
        result = self.executor.execute_place_setup(command)
        self.assertEqual(result.layers, 10)
        self.assertEqual(result.total_lot, 0.1)
        self.assertEqual(len(self.mt5.sent), 10)
        self.assertEqual(
            [item["tp"] for item in self.mt5.sent],
            [3010.0, 3020.0] + [3030.0] * 8,
        )

    def test_second_validated_pair_executes_in_the_same_account_runtime(self):
        executor = DemoExecutor(
            self.mt5,
            approved_server="InterStellarFinancial-Demo",
            allowed_symbols=("XAUUSD", "EURUSD"),
            execution_enabled=True,
            clock_ms=lambda: 1_790_000_000_000,
        )
        command = payload()
        command["analysisSnapshot"].update({
            "symbol": "EURUSD", "side": "SELL", "entry": 1.1,
            "sl": 1.101, "tp1": 1.099, "tp2": 1.098, "tp3": 1.097,
        })
        command.update({
            "symbol": "EURUSD", "side": "SELL", "entry": 1.1,
            "sl": 1.101, "tp1": 1.099, "tp2": 1.098, "tp3": 1.097,
        })
        result = executor.execute_place_setup(command)
        self.assertEqual(result.layers, 3)
        self.assertEqual(len(self.mt5.sent), 3)
        self.assertTrue(all(item["symbol"] == "EURUSD" for item in self.mt5.sent))

    def test_execution_gate_and_real_account_fail_closed(self):
        locked = DemoExecutor(
            self.mt5,
            approved_server="InterStellarFinancial-Demo",
            allowed_symbols=("XAUUSD",),
            execution_enabled=False,
            clock_ms=lambda: 1_790_000_000_000,
        )
        with self.assertRaisesRegex(DemoExecutionError, "DEMO_EXECUTION_GATE_LOCKED"):
            locked.execute_place_setup(payload())
        self.mt5.trade_mode = 1
        with self.assertRaisesRegex(DemoExecutionError, "REAL_ACCOUNT_BLOCKED"):
            self.executor.execute_place_setup(payload())
        self.assertEqual(self.mt5.sent, [])

    def test_wrong_server_symbol_stale_signal_duplicate_and_oversize_are_blocked(self):
        self.mt5.server = "InterStellarFinancial-Live"
        with self.assertRaisesRegex(DemoExecutionError, "SERVER_NOT_APPROVED"):
            self.executor.execute_place_setup(payload())
        self.mt5.server = "InterStellarFinancial-Demo"

        bad_symbol = payload()
        bad_symbol["analysisSnapshot"]["symbol"] = "GBPJPY"
        bad_symbol["symbol"] = "GBPJPY"
        with self.assertRaisesRegex(DemoExecutionError, "SYMBOL_NOT_ALLOWED"):
            self.executor.execute_place_setup(bad_symbol)

        stale = payload(now=1_789_999_000_000)
        with self.assertRaisesRegex(DemoExecutionError, "SIGNAL_STALE"):
            self.executor.execute_place_setup(stale)

        self.mt5.positions = [SimpleNamespace(magic=MAGIC)]
        with self.assertRaisesRegex(DemoExecutionError, "DUPLICATE_ZENCORE_POSITION"):
            self.executor.execute_place_setup(payload())
        self.mt5.positions = []

        large = payload()
        large["lotPerLayer"] = 0.5
        large["totalLot"] = 1.5
        with self.assertRaisesRegex(DemoExecutionError, "ANALYSIS_COMMAND_INVALID"):
            self.executor.execute_place_setup(large)


    def test_management_moves_sl_and_emergency_closes_only_zencore_positions(self):
        now = 1_790_000_000_000
        position = SimpleNamespace(
            magic=MAGIC, ticket=70001, symbol="XAUUSD", type=0, volume=0.02,
            sl=2990.0, tp=3030.0,
        )
        other = SimpleNamespace(
            magic=999, ticket=80001, symbol="XAUUSD", type=0, volume=0.02,
            sl=2990.0, tp=3030.0,
        )
        self.mt5.positions = [position, other]
        snapshot = {
            "contractVersion": boundary.CONTRACT_VERSION,
            "decision": "POSITION_ACTION_AUTHORIZED",
            "decisionOwner": "ZENCORE_ANALYSIS",
            "strategy": boundary.STRATEGY,
            "schemaVersion": boundary.SCHEMA_VERSION,
            "symbol": "XAUUSD",
            "actions": [{"type": "MOVE_SL_ENTRY", "activeSl": 3000.0, "lockLabel": "ENTRY"}],
            "reason": "protect",
            "sourceReceivedAt": now,
        }
        command = {
            "analysisContractVersion": boundary.CONTRACT_VERSION,
            "analysisSnapshot": snapshot,
            "strategy": boundary.STRATEGY,
            "schemaVersion": boundary.SCHEMA_VERSION,
            "symbol": "XAUUSD",
            "positionTickets": ["70001"],
            "actions": snapshot["actions"],
            "reason": snapshot["reason"],
            "signalReceivedAt": now,
        }
        managed = self.executor.execute_management(command)
        self.assertEqual(managed.code, "DEMO_MANAGEMENT_EXECUTED")
        self.assertEqual(self.mt5.sent[0]["action"], self.mt5.TRADE_ACTION_SLTP)
        self.mt5.sent.clear()
        closed = self.executor.emergency_close_all()
        self.assertEqual(closed.code, "DEMO_EMERGENCY_CLOSE_EXECUTED")
        self.assertEqual(len(self.mt5.sent), 1)
        self.assertEqual(self.mt5.sent[0]["position"], 70001)

    def test_three_minimum_lot_layers_close_half_once_across_worker_restart(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "exit-ledger.json"
            self.mt5.positions = [SimpleNamespace(
                magic=MAGIC, ticket=70001 + i, symbol="XAUUSD", type=0,
                volume=0.01, sl=2990.0, tp=3030.0,
            ) for i in range(3)]
            command = self._management([{"type": "CLOSE_PERCENT", "percent": 50}],
                                       ["70001", "70002", "70003"])
            first = DemoExecutor(self.mt5, approved_server=self.mt5.server,
                                 allowed_symbols=("XAUUSD",), execution_enabled=True,
                                 ledger_path=path, clock_ms=lambda: 1_790_000_000_000)
            first.execute_management(command)
            self.assertEqual(sum(p.volume for p in self.mt5.positions), 0.02)
            restarted = DemoExecutor(self.mt5, approved_server=self.mt5.server,
                                     allowed_symbols=("XAUUSD",), execution_enabled=True,
                                     ledger_path=path, clock_ms=lambda: 1_790_000_000_000)
            restarted.execute_management(command)
            self.assertEqual(len(self.mt5.sent), 1)
            self.assertEqual(sum(p.volume for p in self.mt5.positions), 0.02)

    def test_exit_campaigns_are_isolated_by_slot_and_broker_position(self):
        with tempfile.TemporaryDirectory() as folder:
            command = self._management([{"type": "CLOSE_PERCENT", "percent": 50}],
                                       ["90001", "90002"])
            for slot in ("alice", "bob"):
                mt5 = FakeMt5()
                mt5.positions = [SimpleNamespace(magic=MAGIC, ticket=90001+i,
                    symbol="XAUUSD", type=0, volume=0.01, sl=2990.0, tp=3030.0)
                    for i in range(2)]
                worker = DemoExecutor(mt5, approved_server=mt5.server,
                    allowed_symbols=("XAUUSD",), execution_enabled=True,
                    ledger_path=Path(folder) / slot / "exit-ledger.json",
                    clock_ms=lambda: 1_790_000_000_000)
                worker.execute_management(command)
                self.assertEqual(sum(p.volume for p in mt5.positions), 0.01)

    def test_stop_loss_cannot_move_backwards_after_step_lock(self):
        self.mt5.positions = [SimpleNamespace(magic=MAGIC, ticket=70001,
            symbol="XAUUSD", type=0, volume=0.01, sl=3010.0, tp=3030.0)]
        self.executor.execute_management(self._management([
            {"type": "MOVE_SL_ENTRY", "activeSl": 3000.0}]))
        self.assertEqual(self.mt5.sent, [])
        self.executor.execute_management(self._management([
            {"type": "MOVE_SL_TP2", "activeSl": 3020.0}]))
        self.assertEqual(self.mt5.positions[0].sl, 3020.0)

    def test_uncertain_partial_never_retries_against_broker(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "exit-ledger.json"
            self.mt5.positions = [SimpleNamespace(magic=MAGIC, ticket=70001,
                symbol="XAUUSD", type=0, volume=0.02, sl=2990.0, tp=3030.0)]
            worker = DemoExecutor(self.mt5, approved_server=self.mt5.server,
                allowed_symbols=("XAUUSD",), execution_enabled=True,
                ledger_path=path, clock_ms=lambda: 1_790_000_000_000)
            self.mt5.order_send = lambda _request: SimpleNamespace(retcode=10004)
            command = self._management([{"type": "CLOSE_PERCENT", "percent": 50}])
            with self.assertRaisesRegex(DemoExecutionError, "CLOSE_SEND_REJECTED"):
                worker.execute_management(command)
            restarted = DemoExecutor(self.mt5, approved_server=self.mt5.server,
                allowed_symbols=("XAUUSD",), execution_enabled=True,
                ledger_path=path, clock_ms=lambda: 1_790_000_000_000)
            with self.assertRaisesRegex(DemoExecutionError, "PARTIAL_CLOSE_RECONCILIATION_REQUIRED"):
                restarted.execute_management(command)

    def test_stale_exit_cannot_close_new_ticket_in_same_pair(self):
        self.mt5.positions = [SimpleNamespace(magic=MAGIC, ticket=70003,
            symbol="XAUUSD", type=0, volume=0.01, sl=2990.0, tp=3030.0)]
        result = self.executor.execute_management(self._management([
            {"type": "CLOSE_PERCENT", "percent": 100}], ["70001", "70002"]))
        self.assertEqual(result.code, "NO_ZENCORE_POSITION")
        self.assertEqual(self.mt5.sent, [])
        self.assertEqual(self.mt5.positions[0].ticket, 70003)

    @staticmethod
    def _management(actions, tickets=None):
        now = 1_790_000_000_000
        snapshot = {"contractVersion": boundary.CONTRACT_VERSION,
                    "decision": "POSITION_ACTION_AUTHORIZED", "decisionOwner": "ZENCORE_ANALYSIS",
                    "strategy": boundary.STRATEGY, "schemaVersion": boundary.SCHEMA_VERSION,
                    "symbol": "XAUUSD", "actions": actions, "sourceReceivedAt": now}
        return {"analysisContractVersion": boundary.CONTRACT_VERSION,
                "analysisSnapshot": snapshot, "strategy": boundary.STRATEGY,
                "schemaVersion": boundary.SCHEMA_VERSION, "symbol": "XAUUSD",
                "actions": actions, "signalReceivedAt": now,
                "positionTickets": tickets or ["70001"]}


if __name__ == "__main__":
    unittest.main()
