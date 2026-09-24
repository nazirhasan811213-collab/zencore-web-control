"""Fail-closed MT5 DEMO order executor for the staged ZenCore hosted worker.

This module contains broker order capability, but it is inert unless the caller
explicitly constructs DemoExecutor with execution_enabled=True. It never accepts
credentials and it never derives a trade: the Analysis payload must already pass
security_boundary.validate_entry_command().
"""

from __future__ import annotations

import math
import time
from dataclasses import dataclass
from typing import Any, Callable

from security_boundary import validate_entry_command, validate_management_command

MAGIC = 3233001
MAX_DEMO_TOTAL_LOT = 1.0
MAX_SIGNAL_AGE_MS = 5 * 60 * 1000


class DemoExecutionError(RuntimeError):
    pass


def _finite(value: Any, label: str) -> float:
    try:
        result = float(value)
    except (TypeError, ValueError) as exc:
        raise DemoExecutionError(f"{label}_INVALID") from exc
    if not math.isfinite(result):
        raise DemoExecutionError(f"{label}_INVALID")
    return result


def _volume_step_ok(value: float, step: float) -> bool:
    if step <= 0:
        return False
    units = value / step
    return abs(units - round(units)) <= 1e-8


@dataclass(frozen=True)
class ExecutionResult:
    code: str
    broker_order_ids: tuple[str, ...]
    layers: int
    total_lot: float


class DemoExecutor:
    def __init__(
        self,
        mt5_module: Any,
        *,
        approved_server: str,
        allowed_symbols: tuple[str, ...],
        execution_enabled: bool,
        clock_ms: Callable[[], int] = lambda: int(time.time() * 1000),
    ) -> None:
        self.mt5 = mt5_module
        self.approved_server = str(approved_server)
        self.allowed_symbols = tuple(str(s).upper() for s in allowed_symbols)
        self.execution_enabled = execution_enabled is True
        self.clock_ms = clock_ms

    def _assert_demo_boundary(self) -> tuple[Any, Any]:
        if not self.execution_enabled:
            raise DemoExecutionError("DEMO_EXECUTION_GATE_LOCKED")
        account = self.mt5.account_info()
        terminal = self.mt5.terminal_info()
        if account is None or terminal is None:
            raise DemoExecutionError("MT5_STATUS_UNAVAILABLE")
        demo_mode = getattr(self.mt5, "ACCOUNT_TRADE_MODE_DEMO", 0)
        if getattr(account, "trade_mode", None) != demo_mode:
            raise DemoExecutionError("REAL_ACCOUNT_BLOCKED")
        if str(getattr(account, "server", "")).strip().lower() != self.approved_server.strip().lower():
            raise DemoExecutionError("SERVER_NOT_APPROVED")
        if not bool(getattr(terminal, "trade_allowed", False)):
            raise DemoExecutionError("TERMINAL_TRADING_DISABLED")
        if not bool(getattr(account, "trade_allowed", False)):
            raise DemoExecutionError("ACCOUNT_TRADING_DISABLED")
        if not bool(getattr(account, "trade_expert", False)):
            raise DemoExecutionError("EXPERT_TRADING_DISABLED")
        return account, terminal

    def execute_place_setup(self, payload: dict[str, Any]) -> ExecutionResult:
        try:
            snapshot = validate_entry_command(payload)
        except RuntimeError as exc:
            raise DemoExecutionError("ANALYSIS_COMMAND_INVALID") from exc
        self._assert_demo_boundary()

        symbol = str(snapshot["symbol"]).upper()
        side = str(snapshot["side"]).upper()
        if symbol not in self.allowed_symbols:
            raise DemoExecutionError("SYMBOL_NOT_ALLOWED")
        if self.clock_ms() - int(snapshot.get("sourceReceivedAt") or 0) > MAX_SIGNAL_AGE_MS:
            raise DemoExecutionError("SIGNAL_STALE")

        lot = _finite(payload.get("lotPerLayer"), "LOT")
        layers_raw = payload.get("layers")
        if not isinstance(layers_raw, int) or isinstance(layers_raw, bool):
            raise DemoExecutionError("LAYERS_INVALID")
        layers = int(layers_raw)
        if layers < 1 or layers > 10:
            raise DemoExecutionError("LAYERS_OUT_OF_RANGE")
        total = round(lot * layers, 8)
        declared_total = _finite(payload.get("totalLot"), "TOTAL_LOT")
        if lot <= 0 or total <= 0 or total > MAX_DEMO_TOTAL_LOT or abs(total - declared_total) > 1e-8:
            raise DemoExecutionError("VOLUME_LIMIT")

        info = self.mt5.symbol_info(symbol)
        if info is None:
            if hasattr(self.mt5, "symbol_select"):
                self.mt5.symbol_select(symbol, True)
                info = self.mt5.symbol_info(symbol)
        if info is None:
            raise DemoExecutionError("SYMBOL_UNAVAILABLE")
        volume_min = _finite(getattr(info, "volume_min", 0), "VOLUME_MIN")
        volume_max = _finite(getattr(info, "volume_max", 0), "VOLUME_MAX")
        volume_step = _finite(getattr(info, "volume_step", 0), "VOLUME_STEP")
        if lot < volume_min or lot > volume_max or not _volume_step_ok(lot, volume_step):
            raise DemoExecutionError("BROKER_VOLUME_INVALID")

        tick = self.mt5.symbol_info_tick(symbol)
        if tick is None:
            raise DemoExecutionError("TICK_UNAVAILABLE")
        price = _finite(getattr(tick, "ask" if side == "BUY" else "bid", 0), "PRICE")
        sl = _finite(snapshot["sl"], "SL")
        tps = [_finite(snapshot["tp1"], "TP1"), _finite(snapshot["tp2"], "TP2"), _finite(snapshot["tp3"], "TP3")]
        if side == "BUY":
            if not sl < price or any(tp <= price for tp in tps):
                raise DemoExecutionError("PRICE_GEOMETRY_INVALID")
            order_type = self.mt5.ORDER_TYPE_BUY
        else:
            if not sl > price or any(tp >= price for tp in tps):
                raise DemoExecutionError("PRICE_GEOMETRY_INVALID")
            order_type = self.mt5.ORDER_TYPE_SELL

        existing = self.mt5.positions_get(symbol=symbol)
        if existing is None:
            raise DemoExecutionError("POSITION_READ_FAILED")
        if any(int(getattr(p, "magic", 0) or 0) == MAGIC for p in existing):
            raise DemoExecutionError("DUPLICATE_ZENCORE_POSITION")

        order_ids: list[str] = []
        for index in range(layers):
            tp = tps[min(index, 2)]
            request = {
                "action": self.mt5.TRADE_ACTION_DEAL,
                "symbol": symbol,
                "volume": lot,
                "type": order_type,
                "price": price,
                "sl": sl,
                "tp": tp,
                "deviation": 20,
                "magic": MAGIC,
                "comment": f"ZenCore DEMO L{index + 1}",
                "type_time": self.mt5.ORDER_TIME_GTC,
                "type_filling": self.mt5.ORDER_FILLING_IOC,
            }
            checked = self.mt5.order_check(request)
            if checked is None or int(getattr(checked, "retcode", -1)) != 0:
                raise DemoExecutionError("ORDER_CHECK_REJECTED")
            result = self.mt5.order_send(request)
            good = {
                int(getattr(self.mt5, "TRADE_RETCODE_DONE", 10009)),
                int(getattr(self.mt5, "TRADE_RETCODE_DONE_PARTIAL", 10010)),
            }
            if result is None or int(getattr(result, "retcode", -1)) not in good:
                raise DemoExecutionError("ORDER_SEND_REJECTED")
            order_ids.append(str(getattr(result, "order", "") or getattr(result, "deal", "")))

        return ExecutionResult(
            code="DEMO_SETUP_EXECUTED",
            broker_order_ids=tuple(order_ids),
            layers=layers,
            total_lot=total,
        )

    def _zencore_positions(self, symbol: str | None = None) -> list[Any]:
        positions = self.mt5.positions_get(symbol=symbol) if symbol else self.mt5.positions_get()
        if positions is None:
            raise DemoExecutionError("POSITION_READ_FAILED")
        return [p for p in positions if int(getattr(p, "magic", 0) or 0) == MAGIC]

    def _close_position(self, position: Any, percent: int) -> str:
        symbol = str(getattr(position, "symbol", "")).upper()
        if symbol not in self.allowed_symbols:
            raise DemoExecutionError("POSITION_SYMBOL_NOT_ALLOWED")
        info = self.mt5.symbol_info(symbol)
        tick = self.mt5.symbol_info_tick(symbol)
        if info is None or tick is None:
            raise DemoExecutionError("POSITION_MARKET_UNAVAILABLE")
        volume = _finite(getattr(position, "volume", 0), "POSITION_VOLUME")
        step = _finite(getattr(info, "volume_step", 0), "VOLUME_STEP")
        minimum = _finite(getattr(info, "volume_min", 0), "VOLUME_MIN")
        close_volume = volume if percent == 100 else math.floor((volume * percent / 100.0) / step + 1e-9) * step
        close_volume = round(close_volume, 8)
        if close_volume < minimum:
            if percent == 100:
                close_volume = volume
            else:
                raise DemoExecutionError("PARTIAL_VOLUME_TOO_SMALL")
        position_type = int(getattr(position, "type", -1))
        buy_type = int(getattr(self.mt5, "POSITION_TYPE_BUY", 0))
        if position_type == buy_type:
            order_type = self.mt5.ORDER_TYPE_SELL
            price = _finite(getattr(tick, "bid", 0), "PRICE")
        else:
            order_type = self.mt5.ORDER_TYPE_BUY
            price = _finite(getattr(tick, "ask", 0), "PRICE")
        request = {
            "action": self.mt5.TRADE_ACTION_DEAL,
            "position": int(getattr(position, "ticket", 0)),
            "symbol": symbol,
            "volume": close_volume,
            "type": order_type,
            "price": price,
            "deviation": 20,
            "magic": MAGIC,
            "comment": f"ZenCore DEMO CLOSE {percent}",
            "type_time": self.mt5.ORDER_TIME_GTC,
            "type_filling": self.mt5.ORDER_FILLING_IOC,
        }
        checked = self.mt5.order_check(request)
        if checked is None or int(getattr(checked, "retcode", -1)) != 0:
            raise DemoExecutionError("CLOSE_CHECK_REJECTED")
        result = self.mt5.order_send(request)
        good = {
            int(getattr(self.mt5, "TRADE_RETCODE_DONE", 10009)),
            int(getattr(self.mt5, "TRADE_RETCODE_DONE_PARTIAL", 10010)),
        }
        if result is None or int(getattr(result, "retcode", -1)) not in good:
            raise DemoExecutionError("CLOSE_SEND_REJECTED")
        return str(getattr(result, "order", "") or getattr(result, "deal", ""))

    def execute_management(self, payload: dict[str, Any]) -> ExecutionResult:
        try:
            snapshot = validate_management_command(payload)
        except RuntimeError as exc:
            raise DemoExecutionError("MANAGEMENT_COMMAND_INVALID") from exc
        self._assert_demo_boundary()
        if self.clock_ms() - int(snapshot.get("sourceReceivedAt") or 0) > 10 * 60 * 1000:
            raise DemoExecutionError("MANAGEMENT_SIGNAL_STALE")
        symbol = str(snapshot["symbol"]).upper()
        if symbol not in self.allowed_symbols:
            raise DemoExecutionError("SYMBOL_NOT_ALLOWED")
        positions = self._zencore_positions(symbol)
        if not positions:
            return ExecutionResult("NO_ZENCORE_POSITION", (), 0, 0.0)
        order_ids: list[str] = []
        for action in snapshot["actions"]:
            action_type = str(action["type"]).upper()
            if action_type in {"MOVE_SL_ENTRY", "MOVE_SL_TP1", "MOVE_SL_TP2"}:
                new_sl = _finite(action.get("activeSl"), "ACTIVE_SL")
                for position in self._zencore_positions(symbol):
                    request = {
                        "action": self.mt5.TRADE_ACTION_SLTP,
                        "position": int(getattr(position, "ticket", 0)),
                        "symbol": symbol,
                        "sl": new_sl,
                        "tp": float(getattr(position, "tp", 0) or 0),
                        "magic": MAGIC,
                    }
                    checked = self.mt5.order_check(request)
                    if checked is None or int(getattr(checked, "retcode", -1)) != 0:
                        raise DemoExecutionError("SL_MOVE_CHECK_REJECTED")
                    result = self.mt5.order_send(request)
                    good = {
                        int(getattr(self.mt5, "TRADE_RETCODE_DONE", 10009)),
                        int(getattr(self.mt5, "TRADE_RETCODE_DONE_PARTIAL", 10010)),
                    }
                    if result is None or int(getattr(result, "retcode", -1)) not in good:
                        raise DemoExecutionError("SL_MOVE_SEND_REJECTED")
                    order_ids.append(str(getattr(result, "order", "") or getattr(result, "deal", "")))
            elif action_type == "CLOSE_PERCENT":
                percent = int(action.get("percent") or 0)
                for position in list(self._zencore_positions(symbol)):
                    order_ids.append(self._close_position(position, percent))
        return ExecutionResult(
            code="DEMO_MANAGEMENT_EXECUTED",
            broker_order_ids=tuple(order_ids),
            layers=len(self._zencore_positions(symbol)),
            total_lot=sum(float(getattr(p, "volume", 0) or 0) for p in self._zencore_positions(symbol)),
        )

    def emergency_close_all(self) -> ExecutionResult:
        self._assert_demo_boundary()
        positions = self._zencore_positions()
        order_ids = tuple(self._close_position(position, 100) for position in list(positions))
        return ExecutionResult(
            code="DEMO_EMERGENCY_CLOSE_EXECUTED",
            broker_order_ids=order_ids,
            layers=0,
            total_lot=0.0,
        )
