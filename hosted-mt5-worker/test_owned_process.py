"""Native Windows integration tests: real processes, descendants and abrupt death."""
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest
from owned_process import OwnedWindowsProcess
from process_guard import _WindowsProcessHandle


def wait_until(predicate, timeout=12):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return
        time.sleep(.05)
    raise AssertionError("process lifecycle condition timed out")


@unittest.skipUnless(os.name == "nt", "requires native Windows Job Objects")
class OwnedProcessTests(unittest.TestCase):
    def fixture(self, folder):
        script = Path(folder) / "child with spaces.py"
        ids = Path(folder) / "grandchild.pid"
        script.write_text(
            "import subprocess,sys,time\nfrom pathlib import Path\n"
            "p=subprocess.Popen([sys.executable,'-c','import time; time.sleep(120)'])\n"
            "Path(sys.argv[1]).write_text(str(p.pid))\ntime.sleep(120)\n")
        return script, ids

    def test_terminate_kills_descendants_but_not_unrelated_process(self):
        unrelated = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(120)'])
        child = None; probe = None
        try:
            with tempfile.TemporaryDirectory() as folder:
                script, ids = self.fixture(folder)
                child = OwnedWindowsProcess([sys.executable, str(script), str(ids)], Path(folder))
                wait_until(ids.exists)
                probe = _WindowsProcessHandle(int(ids.read_text()))
                child.terminate()
                child.wait(timeout=5)
                wait_until(lambda: not probe.is_alive())
                self.assertIsNone(unrelated.poll())
                child.close()
        finally:
            if child: child.close()
            if probe: probe.close()
            unrelated.terminate(); unrelated.wait(timeout=5)

    def test_abrupt_owner_death_kills_child_and_grandchild(self):
        with tempfile.TemporaryDirectory() as folder:
            script, ids = self.fixture(folder)
            owner = Path(folder) / 'owner.py'
            root_pid = Path(folder) / 'child.pid'
            owner.write_text(
                "import sys,time\nfrom pathlib import Path\n"
                f"sys.path.insert(0,{str(Path(__file__).parent)!r})\n"
                "from owned_process import OwnedWindowsProcess\n"
                f"p=OwnedWindowsProcess([sys.executable,{str(script)!r},{str(ids)!r}],Path({folder!r}))\n"
                f"Path({str(root_pid)!r}).write_text(str(p.pid))\n"
                "time.sleep(120)\n")
            proc = subprocess.Popen([sys.executable, str(owner)])
            probes = []
            try:
                wait_until(lambda: ids.exists() and root_pid.exists())
                probes = [_WindowsProcessHandle(int(p.read_text())) for p in (ids, root_pid)]
                proc.kill(); proc.wait(timeout=5)
                wait_until(lambda: all(not p.is_alive() for p in probes))
            finally:
                if proc.poll() is None: proc.kill(); proc.wait(timeout=5)
                for p in probes: p.close()

    def test_close_kills_live_process_and_failed_launch_is_bounded(self):
        child = OwnedWindowsProcess([sys.executable, '-c', 'import time; time.sleep(120)'], Path.cwd())
        probe = _WindowsProcessHandle(child.pid)
        try:
            child.close()
            wait_until(lambda: not probe.is_alive())
            with self.assertRaisesRegex(RuntimeError, 'PROCESS_CREATE_FAILED'):
                OwnedWindowsProcess([r'C:\nonexistent-zencore-test\missing.exe'], Path.cwd())
        finally:
            child.close(); probe.close()
