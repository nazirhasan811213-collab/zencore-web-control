import tempfile,unittest
from pathlib import Path
from unittest.mock import patch
from connector import Runner,readiness_message
from protocol import atomic_write,encode_fields,read_fields,STRATEGY,SCHEMA
from test_protocol import IDENTITY,NOW,KEY,POD,signed,local_heartbeat

class OnHandoffTests(unittest.TestCase):
 def run_case(self, state='ON', alter_session=False, stop=False, delay=0, tamper=False):
  folder=tempfile.TemporaryDirectory();self.addCleanup(folder.cleanup);path=Path(folder.name)
  atomic_write(path/'heartbeat.tsv',encode_fields(local_heartbeat()))
  atomic_write(path/'lease.tsv',encode_fields({'desiredState':'STOPPED','expiresAt':NOW+10000}))
  runner=Runner({**IDENTITY,'channel':folder.name,'podToken':'test-only','commandSigningKey':KEY},lambda _:None)
  # A prior periodic heartbeat observed STOPPED; the next heartbeat is not due yet.
  runner.next_heartbeat=102;runner.desired_state='STOPPED'
  cmd=signed('SYSTEM_ON',{'mode':'DEMO','strategy':STRATEGY,'exitSchema':SCHEMA,
    'settings':{'symbols':['XAUUSD'],'lotPerLayer':.01,'layers':3}})
  if tamper:cmd['signature']='tampered'
  calls=[];clock=[100.5];acks=[]
  class Api:
   def request(self,url,data=None,token=None):
    calls.append(url)
    if url.endswith('/next'):return {'command':cmd,'serverTime':NOW}
    if url.endswith('/heartbeat'):
     clock[0]+=delay
     if alter_session:atomic_write(path/'heartbeat.tsv',encode_fields({**local_heartbeat(),'eaSession':'2'*32}))
     if stop:runner.stop.set()
     return {'desiredState':state}
    acks.append(data);return {'ok':True}
  runner.api=Api()
  with patch('protocol.time.time',return_value=NOW/1000),patch('connector.time.monotonic',side_effect=lambda:clock[0]):runner.cycle()
  return path,calls,acks
 def test_on_between_periodic_heartbeats_gets_fresh_on_lease_before_handoff(self):
  path,calls,acks=self.run_case()
  lease=read_fields(path/'lease.tsv');command=read_fields(path/'command.tsv')
  self.assertEqual(lease['desiredState'],'ON')
  self.assertEqual(calls,['/api/execution/commands/next','/api/execution/heartbeat'])
  for k in ('account','server','tradeMode','podId','eaSession'):self.assertEqual(lease[k],command[k])
  self.assertEqual(acks,[])
 def test_stop_wins_over_previously_queued_on(self):
  path,_,acks=self.run_case(state='STOPPED')
  self.assertFalse((path/'command.tsv').exists());self.assertEqual(acks[0]['code'],'CONTROL_STOPPED')
 def test_session_change_during_renewal_invalidates_lease_and_does_not_deliver(self):
  path,_,_=self.run_case(alter_session=True)
  self.assertFalse((path/'command.tsv').exists());self.assertEqual(read_fields(path/'lease.tsv')['expiresAt'],'0')
 def test_user_stop_during_renewal_does_not_deliver_or_extend_lease(self):
  path,_,_=self.run_case(stop=True)
  self.assertFalse((path/'command.tsv').exists());self.assertEqual(read_fields(path/'lease.tsv')['desiredState'],'STOPPED')
 def test_slow_renewal_does_not_extend_command_deadline(self):
  path,_,acks=self.run_case(delay=11)
  self.assertFalse((path/'command.tsv').exists());self.assertEqual(acks[0]['code'],'COMMAND_EXPIRED')
 def test_bad_signature_cannot_refresh_on_lease(self):
  path,calls,acks=self.run_case(tamper=True)
  self.assertNotIn('/api/execution/heartbeat',calls);self.assertEqual(acks[0]['code'],'SIGNATURE_REJECTED')
  self.assertEqual(read_fields(path/'lease.tsv')['desiredState'],'STOPPED')
 def test_actionable_permission_reason_and_local_ea_guard(self):
  self.assertIn('Algo Trading',readiness_message('TERMINAL_ALGO_DISABLED'))
  self.assertIn('Allow Algo Trading',readiness_message('EA_ALGO_DISABLED'))
  source=(Path(__file__).parent/'ZenCoreExecutor.mq5').read_text()
  self.assertIn('code=LeaseReason(commandPod)',source)
  self.assertIn('code=PermissionReason()',source)
