import json,tempfile,unittest,urllib.error
from pathlib import Path
from unittest.mock import patch
from connector import Runner,Api
from protocol import read_fields,atomic_write,encode_fields
from test_protocol import IDENTITY,NOW,local_heartbeat

class RecoveryTests(unittest.TestCase):
 def test_failed_poll_requires_fresh_lease_before_resuming_commands(self):
  with tempfile.TemporaryDirectory() as folder:
   channel=Path(folder);atomic_write(channel/'heartbeat.tsv',encode_fields(local_heartbeat()))
   runner=Runner({**IDENTITY,'channel':folder,'podToken':'secret'},lambda _:None)
   runner.next_heartbeat=102;calls=[]
   class Remote:
    def request(self,url,data=None,token=None):
     calls.append(url)
     if len(calls)==1:raise RuntimeError('NETWORK_UNAVAILABLE')
     if url.endswith('heartbeat'):return {'desiredState':'ON'}
     runner.stop.set();return {'command':None}
   runner.api=Remote()
   with patch('connector.time.monotonic',return_value=100),patch('protocol.time.time',return_value=NOW/1000),patch.object(runner.stop,'wait',return_value=False):runner.run()
   self.assertEqual(calls,['/api/execution/commands/next','/api/execution/heartbeat','/api/execution/commands/next'])
   self.assertEqual(read_fields(channel/'lease.tsv')['desiredState'],'STOPPED')
 def test_health_file_replaces_previous_record_without_secrets(self):
  with tempfile.TemporaryDirectory() as folder:
   runner=Runner({'channel':folder,'podToken':'never-publish-me','account':'123456'},lambda _:None)
   runner.connection_health('raw exception never-publish-me')
   file=Path(folder)/'connector-health.json';raw=file.read_text()
   self.assertNotIn('never-publish-me',raw);self.assertNotIn('123456',raw)
   self.assertEqual(json.loads(raw)['code'],'CONNECTION_PENDING')
   runner.connection_health('NETWORK_UNAVAILABLE')
   self.assertEqual(json.loads(file.read_text())['code'],'NETWORK_UNAVAILABLE')
 def test_network_errors_are_safe_and_actionable(self):
  api=Api()
  with patch.object(api.opener,'open',side_effect=urllib.error.URLError('sensitive detail')):
   with self.assertRaisesRegex(RuntimeError,'^NETWORK_UNAVAILABLE$'):api.request('/api/execution/heartbeat',token='secret')
 def test_retry_is_bounded_and_does_not_renew_permission_offline(self):
  with tempfile.TemporaryDirectory() as folder:
   runner=Runner({'channel':folder},lambda _:None);waits=[]
   def wait(delay):
    waits.append(delay)
    if len(waits)==5:runner.stop.set()
   with patch.object(runner,'cycle',side_effect=RuntimeError('HTTP_503')),patch.object(runner.stop,'wait',side_effect=wait):runner.run()
   self.assertEqual(waits,[2,4,8,10,10])
   self.assertEqual(read_fields(Path(folder)/'lease.tsv')['expiresAt'],'0')
   self.assertEqual(json.loads((Path(folder)/'connector-health.json').read_text())['consecutiveFailures'],5)
