import unittest
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

    def symbol_info_tick(self, _symbol):
        return SimpleNamespace(ask=3001.0, bid=3000.5)

    def positions_get(self, **_kwargs):
        return self.positions

    def order_check(self, request):
        return SimpleNamespace(retcode=0, request=request)

    def order_send(self, request):
        self.sent.append(request.copy())
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
        with self.assertRaisesRegex(DemoExecutionError, "VOLUME_LIMIT"):
            self.executor.execute_place_setup(large)


if __name__ == "__main__":
    unittest.main()
