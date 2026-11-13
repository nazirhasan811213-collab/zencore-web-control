import tempfile,threading,time,unittest
from pathlib import Path
from unittest.mock import patch
from connector import Runner,reconnect_delay
from protocol import atomic_write,encode_fields,read_fields
from test_protocol import IDENTITY,local_heartbeat

class ModuleOneLeaseTests(unittest.TestCase):
 def test_100_slots_spread_reconnects_without_extending_ten_second_cap(self):
  factors=[.8+i*.002 for i in range(100)]
  with patch('connector.random.uniform',side_effect=factors):delays=[reconnect_delay(10) for _ in range(100)]
  self.assertEqual(len(set(delays)),100)
  self.assertTrue(all(8<=delay<=10 for delay in delays))
 def test_repeated_outages_recover_without_changing_saved_user_settings(self):
  with tempfile.TemporaryDirectory() as folder:
   runner=self.make_runner(folder);saved=dict(runner.config)
   class HealthyApi:
    def request(self,*args,**kwargs):return {'desiredState':'ON'}
   class PausedApi:
    def request(self,*args,**kwargs):return {'desiredState':'ON','entryBlockedReason':'GLOBAL_ENTRY_PAUSED'}
   self.assertTrue(runner.renew_lease(api=HealthyApi()))
   for _ in range(20):
    previous=read_fields(Path(folder)/'lease.tsv')
    with runner.lease_lock:runner.lease_failed(RuntimeError('NETWORK_UNAVAILABLE'))
    self.assertEqual(read_fields(Path(folder)/'lease.tsv'),previous)
    with patch('connector.time.monotonic',return_value=runner.lease_retry_at+1):self.assertTrue(runner.renew_lease(api=HealthyApi()))
    self.assertEqual(read_fields(Path(folder)/'lease.tsv')['desiredState'],'ON')
   self.assertEqual(runner.config,saved)
   self.assertTrue(runner.renew_lease(api=PausedApi()))
   self.assertEqual(read_fields(Path(folder)/'lease.tsv')['desiredState'],'STOPPED')
 def make_runner(self,folder):
  path=Path(folder);atomic_write(path/'heartbeat.tsv',encode_fields({**local_heartbeat(),'writtenAt':int(time.time()*1000)}))
  return Runner({**IDENTITY,'channel':folder,'podToken':'test-only'},lambda _:None)
 def test_late_failure_of_stopped_worker_cannot_erase_replacement_lease(self):
  with tempfile.TemporaryDirectory() as folder:
   runner=self.make_runner(folder);entered=threading.Event();release=threading.Event()
   class SlowApi:
    def request(self,*args,**kwargs):entered.set();release.wait(3);raise RuntimeError('NETWORK_UNAVAILABLE')
   worker=threading.Thread(target=runner.maintain_lease,args=(SlowApi(),),daemon=True)
   try:
    worker.start();self.assertTrue(entered.wait(1));runner.stop.set()
    # New slot runner uses its own lock. Its valid file must survive the old response.
    atomic_write(Path(folder)/'lease.tsv',encode_fields({'desiredState':'ON','expiresAt':123456789,'replacement':'yes'}))
    release.set();worker.join(2);self.assertFalse(worker.is_alive())
    self.assertEqual(read_fields(Path(folder)/'lease.tsv')['replacement'],'yes')
   finally:runner.stop.set();release.set();worker.join(2)
 def test_fast_cloud_errors_back_off_instead_of_retrying_four_times_per_second(self):
  with tempfile.TemporaryDirectory() as folder:
   runner=self.make_runner(folder);delays=[];clock=[100.0]
   class BrokenApi:
    def request(self,*args,**kwargs):raise RuntimeError('HTTP_429')
   def wait(delay):
    delays.append(delay);clock[0]+=delay
    if len(delays)>=4:runner.stop.set()
    return runner.stop.is_set()
   with patch.object(runner.stop,'wait',side_effect=wait),patch('connector.time.monotonic',side_effect=lambda:clock[0]),patch('connector.random.uniform',return_value=1):runner.maintain_lease(BrokenApi())
   self.assertEqual(delays,[2,4,8,10])

 def test_foreground_poll_cannot_bypass_background_backoff(self):
  with tempfile.TemporaryDirectory() as folder:
   runner=self.make_runner(folder);calls=[]
   class BrokenApi:
    def request(self,*args,**kwargs):calls.append(1);raise RuntimeError('HTTP_429')
   with patch('connector.time.monotonic',return_value=100):
    with self.assertRaises(RuntimeError):runner.renew_lease(api=BrokenApi())
    self.assertFalse(runner.renew_lease(api=BrokenApi()))
   self.assertEqual(calls,[1]);self.assertEqual(runner.desired_state,'STOPPED');self.assertEqual(runner.lease_error,'HTTP_429')
 def test_successful_recovery_clears_lease_error_and_restores_verified_state(self):
  with tempfile.TemporaryDirectory() as folder:
   runner=self.make_runner(folder);runner.lease_failure_count=3;runner.lease_retry_at=99;runner.lease_error='HTTP_503'
   class HealthyApi:
    def request(self,*args,**kwargs):return {'desiredState':'ON'}
   with patch('connector.time.monotonic',return_value=100):self.assertTrue(runner.renew_lease(api=HealthyApi()))
   self.assertEqual(runner.lease_failure_count,0);self.assertIsNone(runner.lease_error);self.assertEqual(runner.lease_retry_at,0)
   self.assertEqual(read_fields(Path(folder)/'lease.tsv')['desiredState'],'ON')

 def test_ea_session_change_cannot_leave_status_as_authorized(self):
  with tempfile.TemporaryDirectory() as folder:
   runner=self.make_runner(folder);runner.desired_state='ON'
   class ChangedSessionApi:
    def request(self,*args,**kwargs):
     atomic_write(Path(folder)/'heartbeat.tsv',encode_fields({**local_heartbeat(),'writtenAt':int(time.time()*1000),'eaSession':'2'*32}))
     return {'desiredState':'ON'}
   self.assertFalse(runner.renew_lease(api=ChangedSessionApi()))
   self.assertEqual(runner.desired_state,'STOPPED');self.assertEqual(runner.lease_failure_count,1)
   self.assertEqual(runner.lease_error,'EA_SESSION_CHANGED');self.assertEqual(read_fields(Path(folder)/'lease.tsv')['expiresAt'],'0')

 def test_background_token_revocation_reaches_main_unpair_path_during_backoff(self):
  with tempfile.TemporaryDirectory() as folder:
   runner=self.make_runner(folder)
   class RevokedApi:
    def request(self,*args,**kwargs):raise RuntimeError('INVALID_POD_TOKEN')
   with self.assertRaisesRegex(RuntimeError,'INVALID_POD_TOKEN'):runner.renew_lease(api=RevokedApi())
   with patch.object(runner,'flush_results') as flush:
    with self.assertRaisesRegex(RuntimeError,'INVALID_POD_TOKEN'):runner.cycle()
    flush.assert_not_called()
