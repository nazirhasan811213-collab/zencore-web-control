"""Fail-closed process lifetime supervision for frozen Windows workers.

PyInstaller one-file applications run the Python payload in a child process.
Windows Task Scheduler can terminate the outer bootloader without terminating
that payload.  This module holds handles to the exact supervisor processes and
terminates the payload if any supervisor exits, preventing an old manager or
worker from surviving an upgrade.
"""

from __future__ import annotations

import os
import sys
import threading
from typing import Any, Callable, Iterable


PROCESS_GUARD_EXIT_CODE = 70
_SYNCHRONIZE = 0x00100000
_WAIT_OBJECT_0 = 0x00000000
_WAIT_TIMEOUT = 0x00000102


class ProcessGuardError(RuntimeError):
    """Raised when the exact supervisor lifetime cannot be monitored."""


class _WindowsProcessHandle:
    def __init__(self, pid: int) -> None:
        import ctypes
        from ctypes import wintypes

        self.pid = _validated_pid(pid)
        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel32.OpenProcess.argtypes = [
            wintypes.DWORD,
            wintypes.BOOL,
            wintypes.DWORD,
        ]
        kernel32.OpenProcess.restype = wintypes.HANDLE
        kernel32.WaitForSingleObject.argtypes = [wintypes.HANDLE, wintypes.DWORD]
        kernel32.WaitForSingleObject.restype = wintypes.DWORD
        kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
        kernel32.CloseHandle.restype = wintypes.BOOL

        handle = kernel32.OpenProcess(_SYNCHRONIZE, False, self.pid)
        if not handle:
            raise ProcessGuardError("SUPERVISOR_OPEN_FAILED")
        self._kernel32 = kernel32
        self._handle = handle

    def is_alive(self) -> bool:
        if self._handle is None:
            return False
        result = int(self._kernel32.WaitForSingleObject(self._handle, 0))
        if result == _WAIT_TIMEOUT:
            return True
        if result == _WAIT_OBJECT_0:
            return False
        raise ProcessGuardError("SUPERVISOR_WAIT_FAILED")

    def close(self) -> None:
        handle = self._handle
        self._handle = None
        if handle is not None:
            self._kernel32.CloseHandle(handle)


def _validated_pid(value: Any) -> int:
    try:
        pid = int(value)
    except (TypeError, ValueError) as exc:
        raise ProcessGuardError("SUPERVISOR_PID_INVALID") from exc
    if pid <= 0 or pid > 0xFFFFFFFF or pid == os.getpid():
        raise ProcessGuardError("SUPERVISOR_PID_INVALID")
    return pid


class ProcessLifetimeGuard:
    """Watch exact process handles and fail closed when one becomes signalled."""

    def __init__(
        self,
        probes: Iterable[Any],
        *,
        exit_process: Callable[[int], Any] = os._exit,
        poll_seconds: float = 0.25,
    ) -> None:
        self._probes = tuple(probes)
        self._exit_process = exit_process
        self._poll_seconds = max(0.05, min(float(poll_seconds), 1.0))
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    def supervisors_alive(self) -> bool:
        try:
            return all(probe.is_alive() for probe in self._probes)
        except Exception:
            return False

    def start(self) -> "ProcessLifetimeGuard":
        if not self._probes or self._thread is not None:
            return self
        self._thread = threading.Thread(
            target=self._watch,
            name="ZenCoreProcessGuard",
            daemon=True,
        )
        self._thread.start()
        return self

    def _watch(self) -> None:
        while not self._stop.wait(self._poll_seconds):
            if not self.supervisors_alive():
                self._exit_process(PROCESS_GUARD_EXIT_CODE)
                return

    def close(self) -> None:
        self._stop.set()
        thread = self._thread
        if thread is not None and thread is not threading.current_thread():
            thread.join(timeout=2.0)
        for probe in self._probes:
            try:
                probe.close()
            except Exception:
                pass


def install_process_lifetime_guard(
    additional_supervisor_pids: Iterable[int] = (),
) -> ProcessLifetimeGuard:
    """Install Windows guards for the PyInstaller parent and named supervisors.

    Source/test runs outside frozen Windows binaries return an inert guard.
    A frozen Windows binary fails closed if its bootloader or an explicitly
    supplied manager process cannot be monitored.
    """

    requested = list(additional_supervisor_pids)
    if os.name != "nt":
        if requested:
            raise ProcessGuardError("SUPERVISOR_PLATFORM_INVALID")
        return ProcessLifetimeGuard(())

    pids: list[int] = []
    if bool(getattr(sys, "frozen", False)):
        pids.append(_validated_pid(os.getppid()))
    pids.extend(_validated_pid(pid) for pid in requested)
    unique_pids = tuple(dict.fromkeys(pids))
    if bool(getattr(sys, "frozen", False)) and not unique_pids:
        raise ProcessGuardError("SUPERVISOR_PID_MISSING")

    probes: list[_WindowsProcessHandle] = []
    try:
        probes = [_WindowsProcessHandle(pid) for pid in unique_pids]
        return ProcessLifetimeGuard(probes).start()
    except Exception:
        for probe in probes:
            probe.close()
        raise
