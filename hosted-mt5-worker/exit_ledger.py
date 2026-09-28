"""Durable, fail-closed position management progress for one isolated MT5 slot."""

import json
import os
from pathlib import Path


class ExitLedger:
    def __init__(self, path: Path | None = None):
        self.path = Path(path) if path is not None else None
        self.state = self._read()

    def _read(self):
        if self.path is None or not self.path.exists():
            return {}
        data = json.loads(self.path.read_text(encoding="utf-8"))
        if not isinstance(data, dict) or data.get("version") != 1 or not isinstance(data.get("symbols"), dict):
            raise RuntimeError("EXIT_LEDGER_INVALID")
        return data["symbols"]

    def save(self):
        if self.path is None:
            return
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.path.with_suffix(".tmp")
        with temporary.open("w", encoding="utf-8") as stream:
            json.dump({"version": 1, "symbols": self.state}, stream, separators=(",", ":"))
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, self.path)

    def campaign(self, symbol, tickets):
        current = {str(ticket) for ticket in tickets}
        record = self.state.get(symbol)
        if not current:
            if record is not None:
                self.state.pop(symbol)
                self.save()
            return None
        if record is None or not current.intersection(set(record.get("tickets", []))):
            record = {"tickets": sorted(current), "partial": "NONE"}
            self.state[symbol] = record
            self.save()
        else:
            record["tickets"] = sorted(current.union(record["tickets"]))
            self.save()
        return record

    def partial_state(self, symbol, value):
        self.state[symbol]["partial"] = value
        self.save()
