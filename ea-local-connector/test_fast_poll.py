import tempfile,unittest,json
from pathlib import Path
from unittest.mock import patch
from connector import Runner
from protocol import atomic_write,encode_fields,read_fields
from test_protocol import IDENTITY,NOW,local_heartbeat

class FastPollTests(unittest.TestCase):
 def test_fast_command_poll_does_not_renew_lease_without_server_heartbeat(self):
  with tempfile.TemporaryDirectory() as folder:
   channel=Path(folder);atomic_write(channel/'heartbeat.tsv',encode_fields(local_heartbeat()))
   runner=Runner({**IDENTITY,'channel':folder,'podToken':'hidden'},lambda _:None);calls=[]
   class Api:
    def request(self,url,data=None,token=None):
     calls.append(url)
     return {'desiredState':'ON'} if url.endswith('/heartbeat') else {'command':None}
   runner.api=Api()
   with patch('connector.time.monotonic',return_value=100),patch('protocol.time.time',return_value=NOW/1000):runner.cycle()
   original=read_fields(channel/'lease.tsv')
   with patch('connector.time.monotonic',return_value=100.5),patch('protocol.time.time',return_value=(NOW+500)/1000):runner.cycle()
   self.assertEqual(read_fields(channel/'lease.tsv'),original)
   self.assertEqual(calls.count('/api/execution/heartbeat'),1)
   self.assertEqual(calls.count('/api/execution/commands/next'),2)
   with patch('connector.time.monotonic',return_value=102.1),patch('protocol.time.time',return_value=(NOW+2100)/1000):runner.cycle()
   self.assertEqual(calls.count('/api/execution/heartbeat'),2)
 def test_stale_ea_blocks_fast_poll_even_between_cloud_heartbeats(self):
  with tempfile.TemporaryDirectory() as folder:
   channel=Path(folder);atomic_write(channel/'heartbeat.tsv',encode_fields(local_heartbeat()))
   runner=Runner({**IDENTITY,'channel':folder,'podToken':'hidden'},lambda _:None)
   runner.next_heartbeat=999999
   class Api:
    def request(self,*args,**kwargs):raise AssertionError('stale EA must not fetch commands')
   runner.api=Api()
   with patch('protocol.time.time',return_value=(NOW+16000)/1000):
    with self.assertRaisesRegex(ValueError,'EA_OFFLINE'):runner.cycle()
 def test_timing_log_has_only_numeric_metrics_and_no_credentials(self):
  with tempfile.TemporaryDirectory() as folder:
   runner=Runner({'channel':folder},lambda _:None)
   runner.timing('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','DELIVERED',commandFetchMs=12,serverQueueAgeMs=250,password=1234,account=12345678)
   row=json.loads((Path(folder)/'execution-timing.jsonl').read_text())
   self.assertEqual(set(row),{'commandId','stage','recordedAtMs','commandFetchMs','serverQueueAgeMs'})
