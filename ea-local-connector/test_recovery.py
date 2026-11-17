import io,json,socket,ssl,tempfile,unittest,urllib.error
from pathlib import Path
from unittest.mock import patch
from connector import Runner,Api,ConnectionRequestError,reconnect_delay
from protocol import read_fields,atomic_write,encode_fields
from test_protocol import IDENTITY,NOW,local_heartbeat

class RecoveryTests(unittest.TestCase):
 def test_failed_poll_requires_fresh_lease_before_resuming_commands(self):
  with tempfile.TemporaryDirectory() as folder:
   channel=Path(folder);atomic_write(channel/'heartbeat.tsv',encode_fields(local_heartbeat()))
   runner=Runner({**IDENTITY,'channel':folder,'podToken':'secret'},lambda _:None,background_lease=False)
   runner.next_heartbeat=102;calls=[]
   class Remote:
    def request(self,url,data=None,token=None):
     calls.append(url)
     if len(calls)==1:raise RuntimeError('NETWORK_UNAVAILABLE')
     if url.endswith('heartbeat'):return {'desiredState':'ON'}
     runner.stop.set();return {'command':None}
   runner.api=Remote()
   with patch('connector.time.monotonic',return_value=100),patch('protocol.time.time',return_value=NOW/1000),patch.object(runner.stop,'wait',return_value=False):runner.run()
   self.assertEqual(calls,['/api/execution/commands/next?wait=1','/api/execution/heartbeat','/api/execution/commands/next?wait=1'])
   self.assertEqual(read_fields(channel/'lease.tsv')['desiredState'],'STOPPED')
 def test_health_file_replaces_previous_record_without_secrets(self):
  with tempfile.TemporaryDirectory() as folder:
   runner=Runner({'channel':folder,'podToken':'never-publish-me','account':'123456'},lambda _:None,background_lease=False)
   runner.connection_health('raw exception never-publish-me')
   file=Path(folder)/'connector-health.json';raw=file.read_text()
   self.assertNotIn('never-publish-me',raw);self.assertNotIn('123456',raw)
   self.assertEqual(json.loads(raw)['code'],'CONNECTION_PENDING')
   runner.connection_health('NETWORK_UNAVAILABLE')
   self.assertEqual(json.loads(file.read_text())['code'],'NETWORK_UNAVAILABLE')
 def test_network_errors_are_safe_and_actionable(self):
  with tempfile.TemporaryDirectory() as folder:
   runner=Runner({'channel':folder},lambda _:None)
   for path,reason,cause,stage in (
    ('/api/execution/heartbeat',socket.gaierror('private'),'DNS','CLOUD_HEARTBEAT'),
    ('/api/execution/commands/next?wait=1',ssl.SSLError('private'),'TLS','COMMAND_FETCH'),
    ('/api/execution/commands/example/ack',TimeoutError('private'),'TIMEOUT','COMMAND_ACK'),
    ('/api/execution/commands/example/ack',ConnectionResetError('private'),'CONNECTION_INTERRUPTED','COMMAND_ACK'),
   ):
    with self.subTest(stage=stage,cause=cause):
     with patch.object(runner.api.opener,'open',side_effect=urllib.error.URLError(reason)) as request:
      with self.assertRaisesRegex(ConnectionRequestError,'^NETWORK_UNAVAILABLE$') as caught:
       runner.api.request(path,token='secret')
      self.assertEqual(request.call_args.kwargs['timeout'],4)
     runner.connection_health('NETWORK_UNAVAILABLE',caught.exception)
     raw=(Path(folder)/'connector-health.json').read_text()
     self.assertNotIn('private',raw);self.assertNotIn('secret',raw)
     health=json.loads(raw)
     self.assertEqual((health['stage'],health['networkCause']),(stage,cause))
 def test_heartbeat_times_out_early_and_gateway_codes_survive_json_error_bodies(self):
  api=Api()
  for status in (408, 429, 500, 502, 503, 504):
   error=urllib.error.HTTPError('https://example.invalid',status,'temporary',{},io.BytesIO(b'{"code":"INTERNAL_ERROR"}'))
   with patch.object(api.opener,'open',side_effect=error) as request:
    with self.assertRaisesRegex(RuntimeError,f'^HTTP_{status}$'):
     api.request('/api/execution/heartbeat',token='secret')
    self.assertEqual(request.call_args.kwargs['timeout'],4)

 def test_lost_ack_keeps_same_result_for_retry(self):
  with tempfile.TemporaryDirectory() as folder:
   runner=Runner({'channel':folder,'podToken':'secret'},lambda _:None,background_lease=False)
   result=Path(folder)/(IDENTITY['account']+'.result')
   atomic_write(result,encode_fields({'id':'same-command','status':'EXECUTED','code':'SETUP_OPENED'}))
   with patch.object(runner.api,'request',side_effect=[RuntimeError('NETWORK_UNAVAILABLE'),{'ok':True}]) as request:
    with self.assertRaisesRegex(RuntimeError,'NETWORK_UNAVAILABLE'):
     runner.flush_results()
    self.assertTrue(result.exists())
    runner.flush_results()
    self.assertEqual(request.call_args_list[0],request.call_args_list[1])
    self.assertFalse(result.exists())

 def test_retry_is_bounded_and_does_not_renew_permission_offline(self):
  with tempfile.TemporaryDirectory() as folder:
   runner=Runner({'channel':folder},lambda _:None,background_lease=False);waits=[]
   def wait(delay):
    waits.append(delay)
    if len(waits)==5:runner.stop.set()
   with patch.object(runner,'cycle',side_effect=RuntimeError('HTTP_503')),patch.object(runner.stop,'wait',side_effect=wait):runner.run()
   self.assertEqual(len(waits),5)
   for delay,cap in zip(waits,[1,2,2,2,2]):self.assertTrue(.8*cap<=delay<=cap)
   self.assertEqual(read_fields(Path(folder)/'lease.tsv')['expiresAt'],'0')
   self.assertEqual(json.loads((Path(folder)/'connector-health.json').read_text())['consecutiveFailures'],5)

 def test_rate_limited_connector_retains_longer_backoff(self):
  with patch('connector.random.uniform',return_value=1):
   self.assertEqual([reconnect_delay(n,'HTTP_429') for n in range(1,6)],[2,4,8,10,10])

 def test_revoked_token_stops_runner_and_releases_account(self):
  with tempfile.TemporaryDirectory() as folder:
   released=[];runner=Runner({'channel':folder},lambda _:None,lambda:released.append(True))
   with patch.object(runner,'cycle',side_effect=RuntimeError('INVALID_POD_TOKEN')):runner.run()
   self.assertTrue(runner.stop.is_set());self.assertEqual(released,[True])
   self.assertEqual(read_fields(Path(folder)/'lease.tsv')['expiresAt'],'0')
 def test_missing_heartbeat_still_receives_web_reset(self):
  with tempfile.TemporaryDirectory() as folder:
   released=[];runner=Runner({'channel':folder,'podToken':'private'},lambda _:None,lambda:released.append(True))
   with patch.object(runner.api,'request',side_effect=RuntimeError('INVALID_POD_TOKEN')) as remote:runner.run()
   self.assertEqual(released,[True]);remote.assert_called_once_with('/api/execution/link-status',token='private')
