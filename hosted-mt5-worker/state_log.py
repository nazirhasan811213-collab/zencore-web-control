"""Bounded diagnostics accepting only codes, slot names and numeric PIDs."""
import logging
from logging.handlers import RotatingFileHandler
from pathlib import Path
import re


def make_state_logger(path: Path):
    path.parent.mkdir(parents=True, exist_ok=True)
    logger = logging.getLogger(str(path))
    logger.setLevel(logging.INFO)
    logger.propagate = False
    if not logger.handlers:
        handler = RotatingFileHandler(path, maxBytes=524288, backupCount=3, encoding="utf-8")
        handler.setFormatter(logging.Formatter("%(asctime)s %(message)s"))
        logger.addHandler(handler)
    def report(slot, code, pid=None):
        safe_slot = slot if re.fullmatch(r"[a-z][-a-z0-9]{0,63}", slot) else "manager"
        safe_code = code if re.fullmatch(r"[A-Z0-9_.-]{1,80}", code) else "REDACTED_FAILURE"
        logger.info("slot=%s code=%s pid=%s", safe_slot, safe_code,
                    pid if type(pid) is int else "-")
    return report


def make_worker_reporter(directory: Path, slot: str, version: str):
    import json
    import os
    import time
    report = make_state_logger(directory / "worker-state.log")
    previous = [None]
    def update(code):
        safe = code if re.fullmatch(r"[A-Z0-9_.-]{1,80}", code) else "REDACTED_FAILURE"
        if safe != previous[0]:
            report(slot, safe, os.getpid())
            previous[0] = safe
        data = {"state": safe, "updatedAt": int(time.time() * 1000),
                "pid": os.getpid(), "connectorVersion": version}
        target = directory / "worker-health.json"
        tmp = target.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(data), encoding="utf-8")
        os.replace(tmp, target)
    return update
