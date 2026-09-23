import json
from pathlib import Path
import tempfile
import unittest
from state_log import make_worker_reporter

class StateLogTests(unittest.TestCase):
    def test_health_and_logs_exclude_untrusted_error_text(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            report = make_worker_reporter(root, 'zencore-mt5-demo-01-s03', 'test')
            report('CONNECTED')
            first = json.loads((root/'worker-health.json').read_text())
            self.assertEqual(first['state'], 'CONNECTED')
            report('password=do-not-store-this')
            current = json.loads((root/'worker-health.json').read_text())
            self.assertEqual(current['state'], 'REDACTED_FAILURE')
            log = (root/'worker-state.log').read_text()
            self.assertNotIn('do-not-store-this', log)
            self.assertGreaterEqual(current['updatedAt'], first['updatedAt'])
            # Close the Windows log handle before temporary directory removal.
            import logging
            logger = logging.getLogger(str(root/'worker-state.log'))
            for handler in logger.handlers[:]: handler.close(); logger.removeHandler(handler)
