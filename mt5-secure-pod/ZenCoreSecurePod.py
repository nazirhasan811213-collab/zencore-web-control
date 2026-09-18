"""ZenCore MT5 Secure Pod agent (DEMO-only first rollout).

This process runs inside an isolated Windows confidential VM beside MetaTrader 5.
It never accepts broker login, password, or full server values from ZenCore's
control-plane API. The terminal must already have an enrolled DEMO session.
"""

from __future__ import annotations

import base64
import ctypes
import hashlib
import hmac
import json
import os
import re
import sqlite3
import sys
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any

try:
    import MetaTrader5 as mt5
except ImportError as exc:  # pragma: no cover - only available on Windows worker
    raise SystemExit("MetaTrader5 Python package is required inside the Secure Pod") from exc


SUPPORTED_MARKETS = (
    "XAUUSD", "EURUSD", "GBPUSD", "USDJPY", "US30", "USDCAD",
    "USDCHF", "EURJPY", "GBPJPY", "EURGBP", "BTCUSD",
)
MAGIC = 3233001
CONNECTOR_VERSION = "1.1.0-demo"
PAIRING_OWNERSHIP_MODE = "TRADER_OWNED_AZURE"


class _DataBlob(ctypes.Structure):
    _fields_ = [("cbData", ctypes.c_ulong), ("pbData", ctypes.POINTER(ctypes.c_ubyte))]


class MachineCredentialStore:
    """DPAPI-protected machine credential storage for the trader-owned Windows pod."""

    def __init__(self, path: Path):
        self.path = path

    @staticmethod
    def _blob(data: bytes) -> tuple[_DataBlob, Any]:
        buffer = ctypes.create_string_buffer(data)
        blob = _DataBlob(len(data), ctypes.cast(buffer, ctypes.POINTER(ctypes.c_ubyte)))
        return blob, buffer

    @staticmethod
    def _protect(data: bytes) -> bytes:
        if os.name != "nt":
            raise RuntimeError("Secure Pod machine credentials require Windows DPAPI")
        source, source_buffer = MachineCredentialStore._blob(data)
        output = _DataBlob()
        description = "ZenCore Secure Pod machine credentials"
        flags = 0x1  # no UI; default DPAPI scope binds to this Windows user profile
        if not ctypes.windll.crypt32.CryptProtectData(
            ctypes.byref(source), description, None, None, None, flags, ctypes.byref(output)
        ):
            raise ctypes.WinError()
        try:
            return ctypes.string_at(output.pbData, output.cbData)
        finally:
            ctypes.windll.kernel32.LocalFree(output.pbData)
            ctypes.memset(source_buffer, 0, len(data))

    @staticmethod
    def _unprotect(data: bytes) -> bytes:
        if os.name != "nt":
            raise RuntimeError("Secure Pod machine credentials require Windows DPAPI")
        source, source_buffer = MachineCredentialStore._blob(data)
        output = _DataBlob()
        flags = 0x1
        if not ctypes.windll.crypt32.CryptUnprotectData(
            ctypes.byref(source), None, None, None, None, flags, ctypes.byref(output)
        ):
            raise ctypes.WinError()
        try:
            return ctypes.string_at(output.pbData, output.cbData)
        finally:
            ctypes.windll.kernel32.LocalFree(output.pbData)
            ctypes.memset(source_buffer, 0, len(data))

    def load(self) -> dict[str, str] | None:
        if not self.path.exists():
            return None
        raw = self._unprotect(self.path.read_bytes())
        try:
            parsed = json.loads(raw.decode("utf-8"))
        finally:
            raw = b""
        token = str(parsed.get("podToken", ""))
        signing_key = str(parsed.get("commandSigningKey", ""))
        if not token.startswith("zcpod_") or len(signing_key.encode("utf-8")) < 32:
            raise RuntimeError("Protected Secure Pod machine credentials are invalid")
        return {"podToken": token, "commandSigningKey": signing_key}

    def save(self, credentials: dict[str, str]) -> None:
        encoded = json.dumps(credentials, separators=(",", ":")).encode("utf-8")
        protected = self._protect(encoded)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.path.with_suffix(self.path.suffix + ".tmp")
        temporary.write_bytes(protected)
        os.replace(temporary, self.path)


def pair_trader_owned_pod(control_url: str, pairing_code: str) -> dict[str, str]:
    if not re.fullmatch(r"zcpair_[A-Za-z0-9_-]{40,}", pairing_code):
        raise RuntimeError("ZENCORE_PAIRING_CODE is invalid")
    body = json.dumps({
        "pairingCode": pairing_code,
        "ownershipMode": PAIRING_OWNERSHIP_MODE,
        "connectorVersion": CONNECTOR_VERSION,
    }, separators=(",", ":")).encode("utf-8")
    request = urllib.request.Request(
        f"{control_url}/api/execution/pair",
        data=body,
        method="POST",
        headers={"Accept": "application/json", "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            result = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        raise RuntimeError(f"Secure Pod pairing rejected (HTTP {exc.code})") from exc
    token = str(result.get("podToken", ""))
    signing_key = str(result.get("commandSigningKey", ""))
    if not token.startswith("zcpod_") or len(signing_key.encode("utf-8")) < 32:
        raise RuntimeError("Secure Pod pairing response is invalid")
    return {"podToken": token, "commandSigningKey": signing_key}


@dataclass(frozen=True)
class Config:
    control_url: str
    pod_token: str
    signing_key: bytes
    terminal_path: str
    ledger_path: Path
    poll_seconds: float
    demo_execution_enabled: bool
    symbol_map: dict[str, str]
    credential_path: Path

    @staticmethod
    def load() -> "Config":
        control_url = os.environ.get("ZENCORE_CONTROL_URL", "").rstrip("/")
        terminal_path = os.environ.get("MT5_TERMINAL_PATH", "")
        if not control_url.startswith("https://") and not control_url.startswith("http://127.0.0.1"):
            raise SystemExit("ZENCORE_CONTROL_URL must use HTTPS")
        if not terminal_path:
            raise SystemExit("MT5_TERMINAL_PATH is required")
        raw_map = os.environ.get("ZENCORE_SYMBOL_MAP_JSON", "{}")
        try:
            parsed_map = json.loads(raw_map)
        except json.JSONDecodeError as exc:
            raise SystemExit("ZENCORE_SYMBOL_MAP_JSON is invalid") from exc
        symbol_map = {
            str(key).upper(): str(value)
            for key, value in parsed_map.items()
            if str(key).upper() in SUPPORTED_MARKETS
        }
        default_root = Path(os.environ.get("PROGRAMDATA", Path.cwd())) / "ZenCoreSecurePod"
        credential_path = Path(os.environ.get(
            "ZENCORE_MACHINE_CREDENTIAL_PATH", default_root / "machine-credentials.dpapi"
        ))
        credential_store = MachineCredentialStore(credential_path)
        pod_token = os.environ.get("ZENCORE_POD_TOKEN", "")
        signing_key_text = os.environ.get("ZENCORE_COMMAND_SIGNING_KEY", "")
        if not pod_token or not signing_key_text:
            try:
                protected_credentials = credential_store.load()
            except (OSError, RuntimeError, ValueError, json.JSONDecodeError) as exc:
                raise SystemExit(f"Unable to unlock Secure Pod machine credentials: {exc}") from exc
            if protected_credentials:
                pod_token = protected_credentials["podToken"]
                signing_key_text = protected_credentials["commandSigningKey"]
        if not pod_token or not signing_key_text:
            pairing_code = os.environ.get("ZENCORE_PAIRING_CODE", "")
            if not pairing_code:
                raise SystemExit("Run one-time Secure Pod pairing before starting the worker")
            try:
                paired = pair_trader_owned_pod(control_url, pairing_code)
                credential_store.save(paired)
            except (OSError, RuntimeError, ValueError, json.JSONDecodeError) as exc:
                raise SystemExit(f"Secure Pod pairing failed: {exc}") from exc
            finally:
                os.environ.pop("ZENCORE_PAIRING_CODE", None)
            pod_token = paired["podToken"]
            signing_key_text = paired["commandSigningKey"]
        signing_key = signing_key_text.encode("utf-8")
        if not pod_token.startswith("zcpod_"):
            raise SystemExit("Secure Pod token is missing or invalid")
        if len(signing_key) < 32:
            raise SystemExit("Secure Pod command signing key is invalid")
        ledger_path = Path(os.environ.get("ZENCORE_LEDGER_PATH", default_root / "command-ledger.db"))
        return Config(
            control_url=control_url,
            pod_token=pod_token,
            signing_key=signing_key,
            terminal_path=terminal_path,
            ledger_path=ledger_path,
            poll_seconds=max(0.5, float(os.environ.get("ZENCORE_POLL_SECONDS", "2"))),
            demo_execution_enabled=os.environ.get("ZENCORE_DEMO_EXECUTION", "false").lower() in {"1", "true", "yes", "on"},
            symbol_map=symbol_map,
            credential_path=credential_path,
        )


class Ledger:
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


class ControlPlane:
    def __init__(self, config: Config):
        self.config = config

    def request(self, method: str, path: str, body: dict[str, Any] | None = None) -> dict[str, Any]:
        encoded = None if body is None else json.dumps(body, separators=(",", ":")).encode("utf-8")
        request = urllib.request.Request(
            f"{self.config.control_url}{path}",
            data=encoded,
            method=method,
            headers={
                "Authorization": f"Bearer {self.config.pod_token}",
                "Accept": "application/json",
                **({"Content-Type": "application/json"} if encoded is not None else {}),
            },
        )
        with urllib.request.urlopen(request, timeout=10) as response:
            return json.loads(response.read().decode("utf-8"))

    def heartbeat(self, payload: dict[str, Any]) -> dict[str, Any]:
        return self.request("POST", "/api/execution/heartbeat", payload)

    def next_command(self) -> dict[str, Any] | None:
        return self.request("GET", "/api/execution/commands/next").get("command")

    def acknowledge(self, command_id: str, status: str, result: dict[str, Any]) -> None:
        self.request("POST", f"/api/execution/commands/{command_id}/ack", {"status": status, **result})


class SecurePod:
    def __init__(self, config: Config):
        self.config = config
        self.control = ControlPlane(config)
        self.ledger = Ledger(config.ledger_path)

    @staticmethod
    def mask(value: Any, visible: int = 4) -> str:
        safe = "".join(character for character in str(value or "") if character.isalnum() or character in "._- ")
        tail = safe[-visible:] if safe else "MT5"
        return f"****{tail}"

    def initialise_terminal(self) -> None:
        if not mt5.initialize(path=self.config.terminal_path):
            raise RuntimeError(f"MT5 initialize failed: {mt5.last_error()}")
        account = mt5.account_info()
        if account is None:
            raise RuntimeError(f"MT5 account unavailable: {mt5.last_error()}")
        if account.trade_mode != mt5.ACCOUNT_TRADE_MODE_DEMO:
            raise RuntimeError("Secure Pod first rollout only permits a DEMO account")

    def canonical_symbol(self, broker_symbol: str) -> str | None:
        upper = broker_symbol.upper()
        for canonical, actual in self.config.symbol_map.items():
            if actual.upper() == upper:
                return canonical
        return next((symbol for symbol in SUPPORTED_MARKETS if symbol in upper), None)

    def broker_symbol(self, canonical: str) -> str:
        mapped = self.config.symbol_map.get(canonical, canonical)
        if mt5.symbol_info(mapped) is not None:
            return mapped
        candidates = mt5.symbols_get(group=f"*{canonical}*") or ()
        if not candidates:
            raise RuntimeError(f"Broker symbol not found for {canonical}")
        return candidates[0].name

    def symbol_specs(self) -> list[dict[str, Any]]:
        specs: list[dict[str, Any]] = []
        for canonical in SUPPORTED_MARKETS:
            try:
                info = mt5.symbol_info(self.broker_symbol(canonical))
                if info is None:
                    continue
                specs.append({
                    "symbol": canonical,
                    "tickSize": info.trade_tick_size or info.point,
                    "tickValue": info.trade_tick_value,
                    "volumeMin": info.volume_min,
                    "volumeMax": info.volume_max,
                    "volumeStep": info.volume_step,
                })
            except RuntimeError:
                continue
        return specs

    def zencore_positions(self) -> list[Any]:
        return [position for position in (mt5.positions_get() or ()) if int(position.magic) == MAGIC]

    def positions_payload(self) -> list[dict[str, Any]]:
        payload = []
        counts: dict[str, int] = {}
        for item in self.zencore_positions():
            canonical = self.canonical_symbol(item.symbol)
            if canonical:
                counts[canonical] = counts.get(canonical, 0) + 1
        for position in self.zencore_positions():
            canonical = self.canonical_symbol(position.symbol)
            if not canonical:
                continue
            plan = self.ledger.plan(canonical) or {}
            stage = int(plan.get("lockStage", 0))
            lock_label = ("TP2_LOCKED" if stage >= 3 else "TP1_LOCKED" if stage == 2 else "BREAK_EVEN" if stage == 1 else "INITIAL")
            payload.append({
                "ticket": str(position.ticket),
                "symbol": canonical,
                "side": "BUY" if position.type == mt5.POSITION_TYPE_BUY else "SELL",
                "volume": position.volume,
                "layers": counts.get(canonical, 1),
                "entry": position.price_open,
                "currentPrice": position.price_current,
                "initialSl": plan.get("initialSl", position.sl),
                "activeSl": position.sl,
                "tp1": plan.get("tp1"),
                "tp2": plan.get("tp2"),
                "tp3": plan.get("tp3"),
                "profitUsd": position.profit,
                "openedAt": int(position.time_msc),
                "exitStage": "HOLD",
                "slLock": lock_label,
            })
        return payload

    def heartbeat_payload(self) -> dict[str, Any]:
        account = mt5.account_info()
        terminal = mt5.terminal_info()
        if account is None or terminal is None:
            raise RuntimeError("MT5 account or terminal state unavailable")
        return {
            "accountMask": self.mask(account.login, 4),
            "serverMask": self.mask(account.server, 8),
            "brokerMask": self.mask(account.company, 12),
            "tradeMode": "DEMO" if account.trade_mode == mt5.ACCOUNT_TRADE_MODE_DEMO else "REAL",
            "terminalTradeAllowed": bool(terminal.trade_allowed),
            "accountTradeAllowed": bool(account.trade_allowed),
            "expertTradeAllowed": bool(terminal.trade_allowed and not terminal.tradeapi_disabled),
            "connectorVersion": CONNECTOR_VERSION,
            "terminalBuild": str(terminal.build),
            "symbolSpecs": self.symbol_specs(),
            "positions": self.positions_payload(),
        }

    def verify_command(self, command: dict[str, Any]) -> dict[str, Any]:
        raw = command.get("signedEnvelope", "")
        padding = "=" * (-len(raw) % 4)
        envelope_bytes = base64.urlsafe_b64decode(raw + padding)
        expected = hmac.new(self.config.signing_key, envelope_bytes, hashlib.sha256).hexdigest()
        if not hmac.compare_digest(expected, str(command.get("signature", ""))):
            raise RuntimeError("Command signature is invalid")
        envelope = json.loads(envelope_bytes.decode("utf-8"))
        for key in ("id", "type", "payload", "createdAt", "expiresAt"):
            if envelope.get(key) != command.get(key):
                raise RuntimeError(f"Signed command mismatch: {key}")
        if int(envelope["expiresAt"]) <= int(time.time() * 1000):
            raise RuntimeError("Command expired")
        return envelope

    @staticmethod
    def normalise_volume(info: Any, volume: float) -> float:
        steps = round(volume / info.volume_step)
        return max(info.volume_min, min(info.volume_max, steps * info.volume_step))

    def send_market_layer(self, payload: dict[str, Any], layer: int) -> str:
        canonical = payload["symbol"]
        symbol = self.broker_symbol(canonical)
        if not mt5.symbol_select(symbol, True):
            raise RuntimeError(f"Unable to select {canonical}")
        info = mt5.symbol_info(symbol)
        tick = mt5.symbol_info_tick(symbol)
        if info is None or tick is None:
            raise RuntimeError(f"No live tick for {canonical}")
        side = payload["side"]
        order_type = mt5.ORDER_TYPE_BUY if side == "BUY" else mt5.ORDER_TYPE_SELL
        request = {
            "action": mt5.TRADE_ACTION_DEAL,
            "symbol": symbol,
            "volume": self.normalise_volume(info, float(payload["lotPerLayer"])),
            "type": order_type,
            "price": tick.ask if side == "BUY" else tick.bid,
            "sl": float(payload["sl"]),
            "tp": 0.0,
            "deviation": 30,
            "magic": MAGIC,
            "comment": f"ZenCore:{str(payload.get('signalReceivedAt', ''))[-8:]}:L{layer}",
            "type_time": mt5.ORDER_TIME_GTC,
            "type_filling": mt5.ORDER_FILLING_IOC,
        }
        checked = mt5.order_check(request)
        if checked is None or checked.retcode not in (0, mt5.TRADE_RETCODE_DONE):
            raise RuntimeError(f"OrderCheck failed for layer {layer}: {getattr(checked, 'comment', mt5.last_error())}")
        result = mt5.order_send(request)
        if result is None or result.retcode != mt5.TRADE_RETCODE_DONE:
            raise RuntimeError(f"OrderSend failed for layer {layer}: {getattr(result, 'comment', mt5.last_error())}")
        return str(result.order or result.deal)

    def place_setup(self, payload: dict[str, Any]) -> list[str]:
        if not self.config.demo_execution_enabled:
            raise RuntimeError("DEMO execution lock is active")
        if not self.ledger.armed():
            raise RuntimeError("Auto Trade is not armed")
        if payload.get("strategy") != "NORMAL_3M_SOP_V32" or payload.get("schemaVersion") != "32.3-EXIT-STEPLOCK":
            raise RuntimeError("Unknown strategy or exit schema")
        orders = []
        for index in range(int(payload["layers"])):
            orders.append(self.send_market_layer(payload, index + 1))
        self.ledger.save_plan(payload["symbol"], {
            "symbol": payload["symbol"],
            "side": payload["side"],
            "entry": float(payload["entry"]),
            "initialSl": float(payload["sl"]),
            "tp1": float(payload["tp1"]),
            "tp2": float(payload["tp2"]),
            "tp3": float(payload["tp3"]),
            "lockStage": 0,
        })
        return orders

    def modify_sl(self, canonical: str, active_sl: float) -> int:
        changed = 0
        for position in self.zencore_positions():
            if self.canonical_symbol(position.symbol) != canonical:
                continue
            if position.type == mt5.POSITION_TYPE_BUY and position.sl and position.sl >= active_sl:
                continue
            if position.type == mt5.POSITION_TYPE_SELL and position.sl and position.sl <= active_sl:
                continue
            result = mt5.order_send({
                "action": mt5.TRADE_ACTION_SLTP,
                "position": position.ticket,
                "symbol": position.symbol,
                "sl": float(active_sl),
                "tp": position.tp,
                "magic": MAGIC,
            })
            if result is None or result.retcode != mt5.TRADE_RETCODE_DONE:
                raise RuntimeError(f"SL modification failed for {position.ticket}")
            changed += 1
        return changed

    def close_position(self, position: Any, percent: float) -> str:
        info = mt5.symbol_info(position.symbol)
        tick = mt5.symbol_info_tick(position.symbol)
        if info is None or tick is None:
            raise RuntimeError(f"No live tick for {position.symbol}")
        requested = position.volume * percent / 100.0
        volume = position.volume if percent >= 100 else self.normalise_volume(info, requested)
        order_type = mt5.ORDER_TYPE_SELL if position.type == mt5.POSITION_TYPE_BUY else mt5.ORDER_TYPE_BUY
        result = mt5.order_send({
            "action": mt5.TRADE_ACTION_DEAL,
            "position": position.ticket,
            "symbol": position.symbol,
            "volume": min(position.volume, volume),
            "type": order_type,
            "price": tick.bid if order_type == mt5.ORDER_TYPE_SELL else tick.ask,
            "deviation": 40,
            "magic": MAGIC,
            "comment": "ZenCore:managed-exit",
            "type_time": mt5.ORDER_TIME_GTC,
            "type_filling": mt5.ORDER_FILLING_IOC,
        })
        if result is None or result.retcode != mt5.TRADE_RETCODE_DONE:
            raise RuntimeError(f"Close failed for {position.ticket}: {getattr(result, 'comment', mt5.last_error())}")
        return str(result.order or result.deal)

    def manage_position(self, payload: dict[str, Any]) -> dict[str, Any]:
        canonical = payload["symbol"]
        changed_sl = 0
        closed: list[str] = []
        for action in payload.get("actions", []):
            if action["type"].startswith("MOVE_SL_"):
                changed_sl += self.modify_sl(canonical, float(action["activeSl"]))
                plan = self.ledger.plan(canonical)
                if plan:
                    plan["lockStage"] = max(int(plan.get("lockStage", 0)), {
                        "MOVE_SL_ENTRY": 1, "MOVE_SL_TP1": 2, "MOVE_SL_TP2": 3,
                    }.get(action["type"], 0))
                    self.ledger.save_plan(canonical, plan)
            elif action["type"] == "CLOSE_PERCENT":
                for position in list(self.zencore_positions()):
                    if self.canonical_symbol(position.symbol) == canonical:
                        closed.append(self.close_position(position, float(action["percent"])))
        if not any(self.canonical_symbol(item.symbol) == canonical for item in self.zencore_positions()):
            self.ledger.delete_plan(canonical)
        return {"changedSl": changed_sl, "closedOrders": closed}

    def emergency_close_all(self) -> list[str]:
        closed = [self.close_position(position, 100) for position in list(self.zencore_positions())]
        for plan in self.ledger.plans():
            self.ledger.delete_plan(plan["symbol"])
        return closed

    def local_step_lock(self) -> None:
        """Keep TP1/TP2/TP3 SL protection alive even during control-plane outages."""
        open_positions = self.zencore_positions()
        for plan in self.ledger.plans():
            canonical = plan["symbol"]
            positions = [item for item in open_positions if self.canonical_symbol(item.symbol) == canonical]
            if not positions:
                self.ledger.delete_plan(canonical)
                continue
            tick = mt5.symbol_info_tick(positions[0].symbol)
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
                target_stage, target_sl = 1, float(plan["entry"])
            if target_stage > stage and target_sl is not None:
                self.modify_sl(canonical, target_sl)
                plan["lockStage"] = target_stage
                self.ledger.save_plan(canonical, plan)

    def execute(self, envelope: dict[str, Any]) -> tuple[str, dict[str, Any]]:
        command_type = envelope["type"]
        payload = envelope.get("payload", {})
        try:
            if command_type == "SYSTEM_ON":
                self.initialise_terminal()
                self.ledger.set_armed(True)
                return "EXECUTED", {"code": "ARMED", "message": "DEMO Auto Trade armed"}
            if command_type == "SYSTEM_STOP":
                self.ledger.set_armed(False)
                return "EXECUTED", {"code": "STOPPED", "message": "New entries stopped; exit management remains active"}
            if command_type == "EMERGENCY_CLOSE_ALL":
                self.ledger.set_armed(False)
                closed = self.emergency_close_all()
                return "EXECUTED", {"code": "CLOSED_ALL", "message": f"Closed {len(closed)} positions"}
            if command_type == "PLACE_SETUP":
                orders = self.place_setup(payload)
                return "EXECUTED", {"code": "ORDERS_PLACED", "message": f"Placed {len(orders)} layers", "brokerOrderId": orders[-1] if orders else ""}
            if command_type == "MANAGE_POSITION":
                result = self.manage_position(payload)
                return "EXECUTED", {"code": "POSITION_MANAGED", "message": json.dumps(result, separators=(",", ":"))[:180]}
            return "REJECTED", {"code": "UNKNOWN_COMMAND", "message": "Command type is not supported"}
        except Exception as exc:  # broker/runtime errors are acknowledged without leaking credentials
            return "FAILED", {"code": "EXECUTION_FAILED", "message": str(exc)[:180]}

    def process_command(self, command: dict[str, Any]) -> None:
        command_id = str(command.get("id", ""))
        previous = self.ledger.previous_result(command_id)
        if previous:
            self.control.acknowledge(command_id, previous[0], previous[1])
            return
        try:
            envelope = self.verify_command(command)
            status, result = self.execute(envelope)
        except Exception as exc:
            status, result = "REJECTED", {"code": "SECURITY_REJECTED", "message": str(exc)[:180]}
        self.ledger.save_result(command_id, status, result)
        self.control.acknowledge(command_id, status, result)

    def run(self) -> None:
        self.initialise_terminal()
        print("ZenCore Secure Pod started in DEMO mode", flush=True)
        while True:
            try:
                self.local_step_lock()
                self.control.heartbeat(self.heartbeat_payload())
                command = self.control.next_command()
                if command:
                    self.process_command(command)
            except (urllib.error.URLError, TimeoutError, RuntimeError) as exc:
                print(f"Secure Pod waiting: {str(exc)[:180]}", file=sys.stderr, flush=True)
            time.sleep(self.config.poll_seconds)


if __name__ == "__main__":
    configuration = Config.load()
    pod = SecurePod(configuration)
    try:
        pod.run()
    finally:
        mt5.shutdown()
