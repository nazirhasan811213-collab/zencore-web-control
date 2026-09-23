"""Windows process trees owned by one non-inheritable kill-on-close Job handle.

The child is created suspended and assigned before any user code runs. Closing
or losing the owner handle kills the entire tree, including frozen bootloaders
and MT5 children. No name-based process killing or breakaway is permitted.
"""
from __future__ import annotations
import ctypes
import os
import subprocess
from pathlib import Path
from ctypes import wintypes as w


class OwnedProcessError(RuntimeError):
    pass


class _BasicLimits(ctypes.Structure):
    _fields_ = [("PerProcessUserTimeLimit", ctypes.c_longlong),
                ("PerJobUserTimeLimit", ctypes.c_longlong), ("LimitFlags", w.DWORD),
                ("MinimumWorkingSetSize", ctypes.c_size_t),
                ("MaximumWorkingSetSize", ctypes.c_size_t), ("ActiveProcessLimit", w.DWORD),
                ("Affinity", ctypes.c_size_t), ("PriorityClass", w.DWORD),
                ("SchedulingClass", w.DWORD)]


class _IoCounters(ctypes.Structure):
    _fields_ = [(n, ctypes.c_ulonglong) for n in (
        "ReadOperationCount", "WriteOperationCount", "OtherOperationCount",
        "ReadTransferCount", "WriteTransferCount", "OtherTransferCount")]


class _ExtendedLimits(ctypes.Structure):
    _fields_ = [("BasicLimitInformation", _BasicLimits), ("IoInfo", _IoCounters),
                ("ProcessMemoryLimit", ctypes.c_size_t), ("JobMemoryLimit", ctypes.c_size_t),
                ("PeakProcessMemoryUsed", ctypes.c_size_t), ("PeakJobMemoryUsed", ctypes.c_size_t)]


class _StartupInfo(ctypes.Structure):
    _fields_ = [("cb", w.DWORD), ("lpReserved", w.LPWSTR), ("lpDesktop", w.LPWSTR),
                ("lpTitle", w.LPWSTR), ("dwX", w.DWORD), ("dwY", w.DWORD),
                ("dwXSize", w.DWORD), ("dwYSize", w.DWORD), ("dwXCountChars", w.DWORD),
                ("dwYCountChars", w.DWORD), ("dwFillAttribute", w.DWORD),
                ("dwFlags", w.DWORD), ("wShowWindow", w.WORD), ("cbReserved2", w.WORD),
                ("lpReserved2", ctypes.POINTER(w.BYTE)), ("hStdInput", w.HANDLE),
                ("hStdOutput", w.HANDLE), ("hStdError", w.HANDLE)]


class _ProcessInfo(ctypes.Structure):
    _fields_ = [("hProcess", w.HANDLE), ("hThread", w.HANDLE),
                ("dwProcessId", w.DWORD), ("dwThreadId", w.DWORD)]


def _kernel():
    k = ctypes.WinDLL("kernel32", use_last_error=True)
    signatures = {
        "CreateJobObjectW": ([ctypes.c_void_p, w.LPCWSTR], w.HANDLE),
        "SetInformationJobObject": ([w.HANDLE, ctypes.c_int, ctypes.c_void_p, w.DWORD], w.BOOL),
        "CreateProcessW": ([w.LPCWSTR, w.LPWSTR, ctypes.c_void_p, ctypes.c_void_p,
                            w.BOOL, w.DWORD, ctypes.c_void_p, w.LPCWSTR,
                            ctypes.POINTER(_StartupInfo), ctypes.POINTER(_ProcessInfo)], w.BOOL),
        "AssignProcessToJobObject": ([w.HANDLE, w.HANDLE], w.BOOL),
        "ResumeThread": ([w.HANDLE], w.DWORD),
        "TerminateJobObject": ([w.HANDLE, w.UINT], w.BOOL),
        "TerminateProcess": ([w.HANDLE, w.UINT], w.BOOL),
        "WaitForSingleObject": ([w.HANDLE, w.DWORD], w.DWORD),
        "GetExitCodeProcess": ([w.HANDLE, ctypes.POINTER(w.DWORD)], w.BOOL),
        "CloseHandle": ([w.HANDLE], w.BOOL),
    }
    for name, (args, result) in signatures.items():
        fn = getattr(k, name); fn.argtypes = args; fn.restype = result
    return k


class OwnedWindowsProcess:
    def __init__(self, command: list[str], cwd: Path):
        if os.name != "nt":
            raise OwnedProcessError("PROCESS_JOB_WINDOWS_REQUIRED")
        self._k = _kernel()
        self._job = None
        self._process = None
        self.returncode = None
        self.pid = 0
        info = _ProcessInfo()
        try:
            # NULL security attributes produce a non-inheritable handle.
            self._job = self._k.CreateJobObjectW(None, None)
            if not self._job:
                raise OwnedProcessError("PROCESS_JOB_CREATE_FAILED")
            limits = _ExtendedLimits()
            limits.BasicLimitInformation.LimitFlags = 0x2000  # KILL_ON_JOB_CLOSE
            if not self._k.SetInformationJobObject(self._job, 9, ctypes.byref(limits), ctypes.sizeof(limits)):
                raise OwnedProcessError("PROCESS_JOB_LIMIT_FAILED")
            startup = _StartupInfo(); startup.cb = ctypes.sizeof(startup)
            command_line = ctypes.create_unicode_buffer(subprocess.list2cmdline(command))
            if not self._k.CreateProcessW(command[0], command_line, None, None, False,
                                         0x4 | 0x08000000, None, str(cwd),
                                         ctypes.byref(startup), ctypes.byref(info)):
                raise OwnedProcessError("PROCESS_CREATE_FAILED")
            self._process = info.hProcess
            self.pid = int(info.dwProcessId)
            if not self._k.AssignProcessToJobObject(self._job, self._process):
                raise OwnedProcessError("PROCESS_JOB_ASSIGN_FAILED")
            if self._k.ResumeThread(info.hThread) == 0xFFFFFFFF:
                raise OwnedProcessError("PROCESS_RESUME_FAILED")
        except BaseException:
            # Also terminate the suspended process if assignment itself failed.
            if self._process:
                self._k.TerminateProcess(self._process, 70)
                self._k.WaitForSingleObject(self._process, 5000)
            self.close()
            raise
        finally:
            if info.hThread:
                self._k.CloseHandle(info.hThread)

    def poll(self):
        if self.returncode is not None:
            return self.returncode
        if not self._process:
            return self.returncode
        result = self._k.WaitForSingleObject(self._process, 0)
        if result == 258:
            return None
        if result != 0:
            raise OwnedProcessError("PROCESS_WAIT_FAILED")
        code = w.DWORD()
        if not self._k.GetExitCodeProcess(self._process, ctypes.byref(code)):
            raise OwnedProcessError("PROCESS_EXIT_CODE_FAILED")
        self.returncode = int(code.value)
        return self.returncode

    def wait(self, timeout=None):
        if self.poll() is not None:
            return self.returncode
        result = self._k.WaitForSingleObject(
            self._process, 0xFFFFFFFF if timeout is None else max(0, int(timeout * 1000)))
        if result == 258:
            raise subprocess.TimeoutExpired("managed process", timeout)
        return self.poll()

    def terminate(self):
        # Kill descendants even if the original launcher has already exited.
        if self._job and not self._k.TerminateJobObject(self._job, 70):
            raise OwnedProcessError("PROCESS_JOB_TERMINATE_FAILED")

    kill = terminate

    def close(self):
        if self._job:
            self._k.CloseHandle(self._job)
            self._job = None
        if self._process:
            self._k.CloseHandle(self._process)
            self._process = None

    def __del__(self):
        self.close()
