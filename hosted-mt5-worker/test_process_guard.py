import os
import threading
import time
import unittest

from process_guard import (
    PROCESS_GUARD_EXIT_CODE,
    ProcessGuardError,
    ProcessLifetimeGuard,
    _validated_pid,
)


class FakeProbe:
    def __init__(self, alive=True, failure=None):
        self.alive = alive
        self.failure = failure
        self.closed = False

    def is_alive(self):
        if self.failure:
            raise self.failure
        return self.alive

    def close(self):
        self.closed = True


class ProcessLifetimeGuardTests(unittest.TestCase):
    def test_pid_validation_rejects_current_and_invalid_processes(self):
        for value in (0, -1, 0x100000000, os.getpid(), "invalid"):
            with self.subTest(value=value):
                with self.assertRaises(ProcessGuardError):
                    _validated_pid(value)

    def test_supervisor_probe_failure_is_fail_closed(self):
        guard = ProcessLifetimeGuard((FakeProbe(failure=OSError("denied")),))
        self.assertFalse(guard.supervisors_alive())

    def test_watcher_requests_process_exit_when_supervisor_dies(self):
        probe = FakeProbe()
        exited = threading.Event()
        codes = []

        def request_exit(code):
            codes.append(code)
            exited.set()

        guard = ProcessLifetimeGuard(
            (probe,), exit_process=request_exit, poll_seconds=0.05
        ).start()
        try:
            probe.alive = False
            self.assertTrue(exited.wait(1.0))
            self.assertEqual(codes, [PROCESS_GUARD_EXIT_CODE])
        finally:
            guard.close()
        self.assertTrue(probe.closed)

    def test_close_stops_watcher_without_requesting_exit(self):
        probe = FakeProbe()
        codes = []
        guard = ProcessLifetimeGuard(
            (probe,), exit_process=codes.append, poll_seconds=0.05
        ).start()
        guard.close()
        probe.alive = False
        time.sleep(0.1)
        self.assertEqual(codes, [])
        self.assertTrue(probe.closed)


if __name__ == "__main__":
    unittest.main()
