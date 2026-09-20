"""DEMO-only MT5 execution engine for the Google hosted ZenCore worker.

The engine is deliberately narrow: XAUUSD only, MT5 DEMO only, the approved
InterStellar demo server only, and only signed commands issued by the ZenCore
control plane.  It keeps a local replay ledger and position-management plan so
restarts cannot blindly repeat broker actions.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import math
import sqlite3
import time
from pathlib import Path
from typing import Any

from security_boundary import (
    HOSTED_DEMO_ORDER_EXECUTION_BUILD_UNLOCKED,
    SCHEMA_VERSION,
    STRATEGY,
    validate_entry_command,
)

MAGIC = 3233001
DEMO_EXECUTION_MARKETS = ("XAUUSD",)
INTERSTELLAR_DEMO_SERVER_ID = "INTERSTELLARFINANCIALDEMO"


class ExecutionLedger:
    def __init__(self, path: Path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(path)
        self.db.execute(
            "CREATE TABLE IF NOT EXISTS commands ("
            "id TEXT PRIMARY KEY, status TEXT NOT NULL, result_json TEXT NOT NULL, processed_at INTEGER NOT NULL)"
        )
        self.db.execute(
            "CREATE TABLE IF NOT EXISTS runtime_state (key TEXT PRIMARY KEY, value TEXT NOT NULL)"
        )
        self.db.execute(
            "CREATE TABLE IF NOT EXISTS position_plans (symbol TEXT PRIMARY KEY, data_json TEXT NOT NULL)"
        )
        self.db.commit()

    def previous_result(self, command_id: str) -> tuple[str, dict[str, Any]] | None:
        row = self.db.execute(
            "SELECT status, result_json FROM commands WHERE id = ?", (command_id,)
        ).fetchone()
        return (row[0], json.loads(row[1])) if row else None

    def claim_command(self, command_id: str) -> bool:
        cursor = self.db.execute(
            "INSERT OR IGNORE INTO commands (id, status, result_json, processed_at) "
            "VALUES (?, 'IN_PROGRESS', '{}', ?)",
            (command_id, int(time.time() * 1000)),
        )
        self.db.commit()
        return cursor.rowcount == 1

    def save_result(self, command_id: str, status: str, result: dict[str, Any]) -> None:
        self.db.execute(
            "INSERT OR REPLACE INTO commands (id, status, result_json, processed_at) VALUES (?, ?, ?, ?)",
            (command_id, status, json.dumps(result, separators=(",", ":")), int(time.time() * 1000)),
        )
        self.db.commit()

    def armed(self) -> bool:
        row = self.db.execute("SELECT value FROM runtime_state WHERE key = 'armed'").fetchone()
        return bool(row and row[0] == "1")

    def set_armed(self, armed: bool) -> None:
        self.db.execute(
            "INSERT OR REPLACE INTO runtime_state (key, value) VALUES ('armed', ?)",
            ("1" if armed else "0",),
        )
        self.db.commit()

    def save_plan(self, symbol: str, plan: dict[str, Any]) -> None:
        self.db.execute(
            "INSERT OR REPLACE INTO position_plans (symbol, data_json) VALUES (?, ?)",
            (symbol, json.dumps(plan, separators=(",", ":"))),
        )
        self.db.commit()

    def plans(self) -> list[dict[str, Any]]:
        return [json.loads(row[0]) for row in self.db.execute("SELECT data_json FROM position_plans")]

    def plan(self, symbol: str) -> dict[str, Any] | None:
        row = self.db.execute(
            "SELECT data_json FROM position_plans WHERE symbol = ?", (symbol,)
        ).fetchone()
        return json.loads(row[0]) if row else None

    def delete_plan(self, symbol: str) -> None:
        self.db.execute("DELETE FROM position_plans WHERE symbol = ?", (symbol,))
        self.db.commit()


class HostedExecutionEngine:
    def __init__(self, mt5_module: Any, config: Any, ledger_path: Path):
        self.mt5 = mt5_module
        self.config = config
        self.ledger = ExecutionLedger(ledger_path)
        self.command_pod_id = ""
        self.signing_key = b""

    @staticmethod
    def server_id(value: Any) -> str:
        import re
        return re.sub(r"[^A-Z0-9]", "", str(value or "").upper())

    def set_command_identity(self, pod_id: str, signing_key_text: str) -> None:
        if not isinstance(pod_id, str) or len(pod_id) != 36:
            raise RuntimeError("Hosted command target is invalid")
        key = str(signing_key_text or "").encode("utf-8")
        if len(key) < 32:
            raise RuntimeError("Hosted command signing key is invalid")
        self.command_pod_id = pod_id
        self.signing_key = key

    def assert_demo_terminal(self, require_execution: bool = False) -> tuple[Any, Any]:
        account = self.mt5.account_info()
        terminal = self.mt5.terminal_info()
        if account is None or terminal is None:
            raise RuntimeError("MT5 account or terminal state unavailable")
        if getattr(account, "trade_mode", None) != self.mt5.ACCOUNT_TRADE_MODE_DEMO:
            raise RuntimeError("Hosted execution only permits an MT5 DEMO account")
        if self.server_id(getattr(account, "server", "")) != INTERSTELLAR_DEMO_SERVER_ID:
            raise RuntimeError("Hosted execution only permits InterStellarFinancial-Demo")
        if require_execution:
            if not HOSTED_DEMO_ORDER_EXECUTION_BUILD_UNLOCKED or not self.config.execution_enabled:
                raise RuntimeError("DEMO execution build/config gate is locked")
            if not bool(getattr(account, "trade_allowed", False)) or not bool(getattr(account, "trade_expert", False)):
                raise RuntimeError("MT5 DEMO account does not allow expert trading")
            if not bool(getattr(terminal, "trade_allowed", False)) or bool(getattr(terminal, "tradeapi_disabled", False)):
                raise RuntimeError("Enable Algo Trading and Python API trading in MT5")
        return account, terminal

    def canonical_symbol(self, broker_symbol: str) -> str | None:
        upper = str(broker_symbol or "").upper()
        return next((symbol for symbol in self.config.allowed_demo_symbols if symbol in upper), None)

    def broker_symbol(self, canonical: str) -> str:
        if canonical not in DEMO_EXECUTION_MARKETS or canonical not in self.config.allowed_demo_symbols:
            raise RuntimeError("This hosted DEMO rollout only permits XAUUSD")
        if self.mt5.symbol_info(canonical) is not None:
            return canonical
        candidates = self.mt5.symbols_get(group=f"*{canonical}*") or ()
        if not candidates:
            raise RuntimeError(f"Broker symbol not found for {canonical}")
        return candidates[0].name

    def zencore_positions(self) -> list[Any]:
        return [
            position for position in (self.mt5.positions_get() or ())
            if int(getattr(position, "magic", 0) or 0) == MAGIC
        ]

    def positions_payload(self) -> list[dict[str, Any]]:
        payload: list[dict[str, Any]] = []
        positions = self.zencore_positions()
        counts: dict[str, int] = {}
        for item in positions:
            canonical = self.canonical_symbol(item.symbol)
            if canonical:
                counts[canonical] = counts.get(canonical, 0) + 1
        for position in positions:
            canonical = self.canonical_symbol(position.symbol)
            if not canonical:
                continue
            plan = self.ledger.plan(canonical) or {}
            stage = int(plan.get("lockStage", 0))
            lock_label = (
                "TP2_LOCKED" if stage >= 3 else
                "TP1_LOCKED" if stage == 2 else
                "BREAK_EVEN" if stage == 1 else "INITIAL"
            )
            payload.append({
                "ticket": str(position.ticket),
                "symbol": canonical,
                "side": "BUY" if position.type == self.mt5.POSITION_TYPE_BUY else "SELL",
                "volume": float(position.volume),
                "layers": counts.get(canonical, 1),
                "entry": float(position.price_open),
                "currentPrice": float(position.price_current),
                "initialSl": plan.get("initialSl", float(position.sl or 0)),
                "activeSl": float(position.sl or 0),
                "tp1": plan.get("tp1"),
                "tp2": plan.get("tp2"),
                "tp3": plan.get("tp3"),
                "profitUsd": float(position.profit),
                "openedAt": int(getattr(position, "time_msc", 0) or 0),
                "exitStage": "HOLD",
                "slLock": lock_label,
            })
        return payload

    def verify_command(self, command: dict[str, Any]) -> dict[str, Any]:
        if not self.command_pod_id or len(self.signing_key) < 32:
            raise RuntimeError("Hosted command identity is not ready")
        raw = str(command.get("signedEnvelope") or "")
        padding = "=" * (-len(raw) % 4)
        try:
            envelope_bytes = base64.urlsafe_b64decode(raw + padding)
            envelope = json.loads(envelope_bytes.decode("utf-8"))
        except Exception as exc:
            raise RuntimeError("Signed command envelope is invalid") from exc
        expected = hmac.new(self.signing_key, envelope_bytes, hashlib.sha256).hexdigest()
        if not hmac.compare_digest(expected, str(command.get("signature") or "")):
            raise RuntimeError("Command signature is invalid")
        if envelope.get("podId") != self.command_pod_id:
            raise RuntimeError("Command target does not match hosted cell")
        for key in ("id", "type", "payload", "createdAt", "expiresAt"):
            if envelope.get(key) != command.get(key):
                raise RuntimeError(f"Signed command mismatch: {key}")
        if int(envelope["expiresAt"]) <= int(time.time() * 1000):
            raise RuntimeError("Command expired")
        return envelope

    @staticmethod
    def volume_digits(step: float) -> int:
        text = f"{float(step):.10f}".rstrip("0")
        return len(text.split(".", 1)[1]) if "." in text else 0

    @staticmethod
    def normalise_volume(info: Any, volume: float, rounding: str = "nearest") -> float:
        step = float(info.volume_step)
        ratio = max(0.0, float(volume)) / step
        if rounding == "up":
            steps = math.ceil(ratio - 1e-9)
        elif rounding == "down":
            steps = math.floor(ratio + 1e-9)
        else:
            steps = math.floor(ratio + 0.5 + 1e-9)
        normalised = max(float(info.volume_min), min(float(info.volume_max), steps * step))
        return round(normalised, HostedExecutionEngine.volume_digits(step))

    def success_retcodes(self) -> set[int]:
        return {
            int(self.mt5.TRADE_RETCODE_DONE),
            int(getattr(self.mt5, "TRADE_RETCODE_DONE_PARTIAL", self.mt5.TRADE_RETCODE_DONE)),
        }

    def filling_modes(self, info: Any) -> list[int]:
        modes: list[int] = []
        flags = int(getattr(info, "filling_mode", 0) or 0)
        if flags & 1:
            modes.append(self.mt5.ORDER_FILLING_FOK)
        if flags & 2:
            modes.append(self.mt5.ORDER_FILLING_IOC)
        market_execution = getattr(self.mt5, "SYMBOL_TRADE_EXECUTION_MARKET", 2)
        if int(getattr(info, "trade_exemode", -1)) != int(market_execution):
            modes.append(self.mt5.ORDER_FILLING_RETURN)
        if not modes:
            modes.extend([self.mt5.ORDER_FILLING_FOK, self.mt5.ORDER_FILLING_IOC])
        return list(dict.fromkeys(modes))

    def checked_deal_request(self, info: Any, request: dict[str, Any]) -> dict[str, Any]:
        errors: list[str] = []
        for filling_mode in self.filling_modes(info):
            candidate = {**request, "type_filling": filling_mode}
            checked = self.mt5.order_check(candidate)
            retcode = getattr(checked, "retcode", None)
            if checked is not None and retcode in (0, self.mt5.TRADE_RETCODE_DONE):
                return candidate
            errors.append(str(getattr(checked, "comment", retcode if retcode is not None else self.mt5.last_error())))
        raise RuntimeError(f"OrderCheck failed: {'; '.join(errors)[:120]}")

    def send_checked_deal(self, info: Any, request: dict[str, Any]) -> Any:
        checked_request = self.checked_deal_request(info, request)
        result = self.mt5.order_send(checked_request)
        if result is None or int(result.retcode) not in self.success_retcodes():
            raise RuntimeError(f"OrderSend failed: {getattr(result, 'comment', self.mt5.last_error())}")
        return result

    def send_market_layer(self, payload: dict[str, Any], layer: int) -> str:
        self.assert_demo_terminal(require_execution=True)
        canonical = payload["symbol"]
        symbol = self.broker_symbol(canonical)
        if not self.mt5.symbol_select(symbol, True):
            raise RuntimeError(f"Unable to select {canonical}")
        info = self.mt5.symbol_info(symbol)
        tick = self.mt5.symbol_info_tick(symbol)
        if info is None or tick is None:
            raise RuntimeError(f"No live tick for {canonical}")
        side = payload["side"]
        order_type = self.mt5.ORDER_TYPE_BUY if side == "BUY" else self.mt5.ORDER_TYPE_SELL
        request = {
            "action": self.mt5.TRADE_ACTION_DEAL,
            "symbol": symbol,
            "volume": self.normalise_volume(info, float(payload["lotPerLayer"])),
            "type": order_type,
            "price": round(tick.ask if side == "BUY" else tick.bid, int(info.digits)),
            "sl": round(float(payload["sl"]), int(info.digits)),
            "tp": 0.0,
            "deviation": 30,
            "magic": MAGIC,
            "comment": f"ZenCore:{str(payload.get('signalReceivedAt', ''))[-8:]}:L{layer}",
            "type_time": self.mt5.ORDER_TIME_GTC,
        }
        result = self.send_checked_deal(info, request)
        return str(result.order or result.deal)

    def validate_setup_payload(self, payload: dict[str, Any]) -> None:
        validate_entry_command(payload)
        if payload.get("strategy") != STRATEGY or payload.get("schemaVersion") != SCHEMA_VERSION:
            raise RuntimeError("Unknown strategy or exit schema")
        symbol = str(payload.get("symbol", "")).upper()
        side = str(payload.get("side", "")).upper()
        if symbol not in DEMO_EXECUTION_MARKETS:
            raise RuntimeError("This hosted DEMO execution release only permits XAUUSD")
        if side not in {"BUY", "SELL"}:
            raise RuntimeError("Setup side must be BUY or SELL")
        try:
            layers = int(payload.get("layers"))
            lot = float(payload.get("lotPerLayer"))
            total_lot = float(payload.get("totalLot"))
            values = [float(payload.get(key)) for key in ("entry", "sl", "tp1", "tp2", "tp3")]
        except (TypeError, ValueError) as exc:
            raise RuntimeError("Setup price, lot or layer value is invalid") from exc
        if (
            not 1 <= layers <= 10
            or lot <= 0
            or abs(total_lot - lot * layers) > 1e-8
            or not all(math.isfinite(value) and value > 0 for value in values)
        ):
            raise RuntimeError("Setup price, lot or layer range is invalid")
        entry, sl, tp1, tp2, tp3 = values
        levels_valid = sl < entry < tp1 < tp2 < tp3 if side == "BUY" else sl > entry > tp1 > tp2 > tp3
        if not levels_valid:
            raise RuntimeError("Setup SL/TP levels do not match the trade side")
        signal_time = int(payload.get("signalReceivedAt") or 0)
        age = int(time.time() * 1000) - signal_time
        if signal_time <= 0 or age < -60_000 or age > 10 * 60 * 1000:
            raise RuntimeError("Setup signal is outside the DEMO execution freshness window")

    def place_setup(self, payload: dict[str, Any], command_id: str) -> list[str]:
        if not self.config.execution_enabled:
            raise RuntimeError("DEMO execution lock is active")
        if not self.ledger.armed():
            raise RuntimeError("Auto Trade is not armed")
        self.assert_demo_terminal(require_execution=True)
        self.validate_setup_payload(payload)
        canonical = payload["symbol"]
        if any(self.canonical_symbol(position.symbol) == canonical for position in self.zencore_positions()):
            raise RuntimeError("An open ZenCore position already exists for this symbol")
        info = self.mt5.symbol_info(self.broker_symbol(canonical))
        if info is None:
            raise RuntimeError(f"Broker symbol not found for {canonical}")
        requested_lot = float(payload["lotPerLayer"])
        broker_lot = self.normalise_volume(info, requested_lot)
        if abs(broker_lot - requested_lot) > 1e-9:
            raise RuntimeError("Lot per layer does not match the broker volume step")
        self.ledger.save_plan(canonical, {
            "symbol": canonical,
            "side": payload["side"],
            "entry": float(payload["entry"]),
            "initialSl": float(payload["sl"]),
            "tp1": float(payload["tp1"]),
            "tp2": float(payload["tp2"]),
            "tp3": float(payload["tp3"]),
            "lockStage": 0,
            "partialCloseDone": False,
            "commandId": command_id,
        })
        orders: list[str] = []
        try:
            for index in range(int(payload["layers"])):
                orders.append(self.send_market_layer(payload, index + 1))
        except Exception as exc:
            raise RuntimeError(
                f"Layer execution stopped after {len(orders)}; any filled layer keeps its broker SL: {exc}"
            ) from exc
        positions = [
            position for position in self.zencore_positions()
            if self.canonical_symbol(position.symbol) == canonical
        ]
        if positions:
            total_volume = sum(float(position.volume) for position in positions)
            plan = self.ledger.plan(canonical) or {}
            plan["entry"] = sum(
                float(position.price_open) * float(position.volume) for position in positions
            ) / total_volume
            self.ledger.save_plan(canonical, plan)
        return orders

    def modify_sl(self, canonical: str, active_sl: float | None, use_position_entry: bool = False) -> int:
        self.assert_demo_terminal(require_execution=True)
        changed = 0
        for position in self.zencore_positions():
            if self.canonical_symbol(position.symbol) != canonical:
                continue
            info = self.mt5.symbol_info(position.symbol)
            if info is None:
                raise RuntimeError(f"Broker symbol unavailable for {canonical}")
            target_sl = float(position.price_open) if use_position_entry else float(active_sl)
            target_sl = round(target_sl, int(info.digits))
            if position.type == self.mt5.POSITION_TYPE_BUY and position.sl and position.sl >= target_sl:
                continue
            if position.type == self.mt5.POSITION_TYPE_SELL and position.sl and position.sl <= target_sl:
                continue
            result = self.mt5.order_send({
                "action": self.mt5.TRADE_ACTION_SLTP,
                "position": position.ticket,
                "symbol": position.symbol,
                "sl": target_sl,
                "tp": position.tp,
                "magic": MAGIC,
            })
            if result is None or int(result.retcode) not in self.success_retcodes():
                raise RuntimeError(f"SL modification failed for {position.ticket}")
            changed += 1
        return changed

    def close_position(self, position: Any, volume: float) -> str:
        self.assert_demo_terminal(require_execution=True)
        info = self.mt5.symbol_info(position.symbol)
        tick = self.mt5.symbol_info_tick(position.symbol)
        if info is None or tick is None:
            raise RuntimeError(f"No live tick for {position.symbol}")
        close_volume = min(float(position.volume), float(volume))
        close_volume = round(close_volume, self.volume_digits(float(info.volume_step)))
        if close_volume < float(info.volume_min) - 1e-9:
            raise RuntimeError(f"Close volume is below broker minimum for {position.symbol}")
        order_type = self.mt5.ORDER_TYPE_SELL if position.type == self.mt5.POSITION_TYPE_BUY else self.mt5.ORDER_TYPE_BUY
        request = {
            "action": self.mt5.TRADE_ACTION_DEAL,
            "position": position.ticket,
            "symbol": position.symbol,
            "volume": close_volume,
            "type": order_type,
            "price": round(
                tick.bid if order_type == self.mt5.ORDER_TYPE_SELL else tick.ask,
                int(info.digits),
            ),
            "deviation": 40,
            "magic": MAGIC,
            "comment": "ZenCore:managed-exit",
            "type_time": self.mt5.ORDER_TIME_GTC,
        }
        result = self.send_checked_deal(info, request)
        return str(result.order or result.deal)

    def close_symbol_percent(self, canonical: str, percent: float) -> list[str]:
        positions = sorted(
            [p for p in self.zencore_positions() if self.canonical_symbol(p.symbol) == canonical],
            key=lambda position: int(position.ticket),
        )
        if not positions:
            return []
        if percent >= 100:
            return [self.close_position(position, float(position.volume)) for position in positions]
        info = self.mt5.symbol_info(positions[0].symbol)
        if info is None:
            raise RuntimeError(f"Broker symbol unavailable for {canonical}")
        total_volume = sum(float(position.volume) for position in positions)
        minimum = float(info.volume_min)
        maximum_partial = total_volume - minimum
        if maximum_partial < minimum - 1e-9:
            raise RuntimeError("Broker minimum lot does not permit a partial close")
        step = float(info.volume_step)
        target = math.ceil((total_volume * percent / 100.0) / step - 1e-9) * step
        target = min(target, maximum_partial)
        target = round(target, self.volume_digits(step))
        closed: list[str] = []
        remaining = target
        for position in positions:
            if remaining <= 1e-9:
                break
            position_volume = float(position.volume)
            if remaining >= position_volume - 1e-9:
                close_volume = position_volume
            else:
                max_from_position = position_volume - minimum
                if max_from_position < minimum - 1e-9:
                    continue
                close_volume = min(self.normalise_volume(info, remaining, "nearest"), max_from_position)
            if close_volume < minimum - 1e-9:
                continue
            closed.append(self.close_position(position, close_volume))
            remaining = round(remaining - close_volume, self.volume_digits(step))
        if remaining > 1e-9:
            raise RuntimeError("Unable to complete broker-rounded partial close")
        return closed

    def manage_position(self, payload: dict[str, Any]) -> dict[str, Any]:
        if payload.get("strategy") != STRATEGY or payload.get("schemaVersion") != SCHEMA_VERSION:
            raise RuntimeError("Unknown management strategy or exit schema")
        self.assert_demo_terminal(require_execution=True)
        canonical = str(payload.get("symbol") or "").upper()
        if canonical not in DEMO_EXECUTION_MARKETS:
            raise RuntimeError("This hosted DEMO execution release only permits XAUUSD")
        changed_sl = 0
        closed: list[str] = []
        for action in payload.get("actions", []):
            kind = str(action.get("type") or "")
            if kind.startswith("MOVE_SL_"):
                use_entry = kind == "MOVE_SL_ENTRY"
                changed_sl += self.modify_sl(
                    canonical,
                    None if use_entry else float(action["activeSl"]),
                    use_position_entry=use_entry,
                )
                plan = self.ledger.plan(canonical)
                if plan:
                    plan["lockStage"] = max(int(plan.get("lockStage", 0)), {
                        "MOVE_SL_ENTRY": 1, "MOVE_SL_TP1": 2, "MOVE_SL_TP2": 3,
                    }.get(kind, 0))
                    self.ledger.save_plan(canonical, plan)
            elif kind == "CLOSE_PERCENT":
                percent = float(action["percent"])
                if percent <= 0 or percent > 100:
                    raise RuntimeError("Close percent is invalid")
                plan = self.ledger.plan(canonical)
                if percent < 100 and not plan:
                    raise RuntimeError("Position plan is missing; refusing repeated partial close")
                if percent < 100 and plan and plan.get("partialCloseDone"):
                    continue
                closed.extend(self.close_symbol_percent(canonical, percent))
                if percent < 100 and plan:
                    plan["partialCloseDone"] = True
                    self.ledger.save_plan(canonical, plan)
            else:
                raise RuntimeError("Unsupported management action")
        if not any(self.canonical_symbol(item.symbol) == canonical for item in self.zencore_positions()):
            self.ledger.delete_plan(canonical)
        return {"changedSl": changed_sl, "closedOrders": closed}

    def emergency_close_all(self) -> list[str]:
        closed = [
            self.close_position(position, float(position.volume))
            for position in list(self.zencore_positions())
        ]
        for plan in self.ledger.plans():
            self.ledger.delete_plan(plan["symbol"])
        return closed

    def local_step_lock(self) -> None:
        for plan in self.ledger.plans():
            canonical = plan["symbol"]
            positions = [p for p in self.zencore_positions() if self.canonical_symbol(p.symbol) == canonical]
            if not positions:
                self.ledger.delete_plan(canonical)
                continue
            tick = self.mt5.symbol_info_tick(positions[0].symbol)
            if tick is None:
                continue
            current = tick.bid if plan["side"] == "BUY" else tick.ask
            reached = (lambda level: current >= level) if plan["side"] == "BUY" else (lambda level: current <= level)
            stage = int(plan.get("lockStage", 0))
            target_stage = stage
            target_sl = None
            if reached(float(plan["tp3"])):
                target_stage, target_sl = 3, float(plan["tp2"])
            elif reached(float(plan["tp2"])):
                target_stage, target_sl = 2, float(plan["tp1"])
            elif reached(float(plan["tp1"])):
                target_stage, target_sl = 1, None
            if target_stage > stage:
                self.modify_sl(canonical, target_sl, use_position_entry=target_stage == 1)
                plan["lockStage"] = target_stage
                self.ledger.save_plan(canonical, plan)

    def execute(self, envelope: dict[str, Any]) -> tuple[str, dict[str, Any]]:
        command_type = envelope["type"]
        payload = envelope.get("payload", {})
        try:
            if command_type == "SYSTEM_ON":
                if not self.config.execution_enabled:
                    raise RuntimeError("DEMO execution lock is active")
                if (
                    payload.get("mode") != "DEMO"
                    or payload.get("strategy") != STRATEGY
                    or payload.get("exitSchema") != SCHEMA_VERSION
                ):
                    raise RuntimeError("SYSTEM_ON policy does not match this DEMO release")
                settings = payload.get("settings", {})
                if any(symbol not in DEMO_EXECUTION_MARKETS for symbol in settings.get("symbols", [])):
                    raise RuntimeError("SYSTEM_ON includes a symbol outside the XAUUSD DEMO rollout")
                self.assert_demo_terminal(require_execution=True)
                self.ledger.set_armed(True)
                return "EXECUTED", {"code": "ARMED", "message": "Hosted DEMO Auto Trade armed"}
            if command_type == "SYSTEM_STOP":
                self.ledger.set_armed(False)
                return "EXECUTED", {"code": "STOPPED", "message": "New entries stopped; exit management remains active"}
            if command_type == "EMERGENCY_CLOSE_ALL":
                self.ledger.set_armed(False)
                closed = self.emergency_close_all()
                return "EXECUTED", {"code": "CLOSED_ALL", "message": f"Closed {len(closed)} positions"}
            if command_type == "PLACE_SETUP":
                orders = self.place_setup(payload, str(envelope["id"]))
                return "EXECUTED", {
                    "code": "ORDERS_PLACED",
                    "message": f"Placed {len(orders)} layers",
                    "brokerOrderId": orders[-1] if orders else "",
                }
            if command_type == "MANAGE_POSITION":
                result = self.manage_position(payload)
                return "EXECUTED", {
                    "code": "POSITION_MANAGED",
                    "message": json.dumps(result, separators=(",", ":"))[:180],
                }
            return "REJECTED", {"code": "UNKNOWN_COMMAND", "message": "Command type is not supported"}
        except Exception as exc:
            return "FAILED", {"code": "EXECUTION_FAILED", "message": str(exc)[:180]}

    def process_command(self, command: dict[str, Any], control: Any, account_id: str, lease_id: str) -> None:
        command_id = str(command.get("id") or "")
        previous = self.ledger.previous_result(command_id)
        if previous:
            if previous[0] == "IN_PROGRESS":
                recovery = {
                    "code": "REPLAY_BLOCKED",
                    "message": "A prior execution was interrupted; duplicate broker action was blocked",
                }
                self.ledger.save_result(command_id, "FAILED", recovery)
                control.acknowledge(account_id, lease_id, command_id, "FAILED", recovery)
                return
            control.acknowledge(account_id, lease_id, command_id, previous[0], previous[1])
            return
        try:
            envelope = self.verify_command(command)
            if not self.ledger.claim_command(command_id):
                raise RuntimeError("Command replay was blocked by the local ledger")
            status, result = self.execute(envelope)
        except Exception as exc:
            status, result = "REJECTED", {"code": "SECURITY_REJECTED", "message": str(exc)[:180]}
        self.ledger.save_result(command_id, status, result)
        control.acknowledge(account_id, lease_id, command_id, status, result)
