import tempfile,threading,time,unittest
from pathlib import Path
from unittest.mock import patch
from connector import Runner
from protocol import atomic_write,encode_fields,read_fields
from test_protocol import IDENTITY,local_heartbeat

class LeaseIndependenceTests(unittest.TestCase):
 def test_slow_command_fetch_does_not_starve_lease_and_stop_is_observed(self):
  with tempfile.TemporaryDirectory() as folder:
   path=Path(folder);atomic_write(path/'heartbeat.tsv',encode_fields({**local_heartbeat(),'writtenAt':int(time.time()*1000)}))
   runner=Runner({**IDENTITY,'channel':folder,'podToken':'test-only'},lambda _:None)
   fetching=threading.Event();release=threading.Event();renewed=threading.Event();stopped=threading.Event();desired=['ON']
   class CommandApi:
    def request(self,url,*args,**kwargs):
     fetching.set();release.wait(5);return {'command':None}
   class HeartbeatApi:
    def request(self,url,*args,**kwargs):
     self_url=url
     if desired[0]=='STOPPED':stopped.set()
     else:renewed.set()
     return {'desiredState':desired[0]}
   runner.api=CommandApi();runner.next_heartbeat=time.monotonic()+20
   poll=threading.Thread(target=runner.cycle,daemon=True);lease=threading.Thread(target=runner.maintain_lease,args=(HeartbeatApi(),),daemon=True)
   try:
    poll.start();self.assertTrue(fetching.wait(2));runner.next_heartbeat=0;lease.start();self.assertTrue(renewed.wait(2))
    with runner.lease_lock:self.assertEqual(read_fields(path/'lease.tsv')['desiredState'],'ON')
    self.assertTrue(poll.is_alive(),'command API is still blocked while lease renews')
    desired[0]='STOPPED';runner.next_heartbeat=0;self.assertTrue(stopped.wait(2))
    with runner.lease_lock:self.assertEqual(read_fields(path/'lease.tsv')['desiredState'],'STOPPED')
   finally:runner.stop.set();release.set();poll.join(2);lease.join(2)
 def test_atomic_file_contention_retries_same_replace_without_deleting_destination(self):
  with tempfile.TemporaryDirectory() as folder:
   path=Path(folder)/'lease.tsv';atomic_write(path,'old');replace=__import__('os').replace;calls=[]
   def locked(src,dst):
    calls.append((src,dst));self.assertEqual(path.read_text(),'old')
    if len(calls)<3:raise PermissionError('sharing violation')
    replace(src,dst)
   with patch('protocol.os.replace',side_effect=locked),patch('protocol.time.sleep'):
    atomic_write(path,'new')
   self.assertEqual(path.read_text(),'new');self.assertEqual(len(calls),3)
 def test_persistent_file_lock_fails_bounded_and_preserves_destination(self):
  with tempfile.TemporaryDirectory() as folder:
   path=Path(folder)/'command.tsv';atomic_write(path,'old')
   with patch('protocol.os.replace',side_effect=PermissionError('locked')) as replace,patch('protocol.time.sleep'):
    with self.assertRaises(PermissionError):atomic_write(path,'new')
   self.assertEqual(path.read_text(),'old');self.assertEqual(replace.call_count,6)
