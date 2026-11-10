import json,tempfile,threading,unittest
from pathlib import Path
from unittest.mock import patch
from protocol import atomic_write,encode_fields,read_fields
from connector import Runner

class LocalLinkTests(unittest.TestCase):
 def test_persistent_lock_has_specific_health_reason_and_revokes_entry(self):
  with tempfile.TemporaryDirectory() as folder:
   runner=Runner({'channel':folder},lambda _:None)
   with runner.lease_lock:runner.lease_failed(PermissionError('private path'))
   health=json.loads((Path(folder)/'connector-health.json').read_text())
   self.assertEqual(health['code'],'LOCAL_FILE_LOCKED')
   self.assertEqual(read_fields(Path(folder)/'lease.tsv')['expiresAt'],'0')
   self.assertNotIn('private path',json.dumps(health))
 def test_temporary_mt5_file_lock_recovers_without_cached_heartbeat(self):
  with patch.object(Path,'read_text',side_effect=[PermissionError(),PermissionError(),'eaSession\tnew\n']),patch('protocol.time.sleep') as sleep:
   self.assertEqual(read_fields('heartbeat.tsv'),{'eaSession':'new'})
   self.assertEqual([c.args[0] for c in sleep.call_args_list],[.01,.02])
 def test_persistent_file_lock_is_not_reported_as_connected(self):
  with patch.object(Path,'read_text',side_effect=PermissionError()) as read,patch('protocol.time.sleep'):
   with self.assertRaises(PermissionError):read_fields('heartbeat.tsv')
   self.assertEqual(read.call_count,3)
 def test_missing_or_invalid_files_are_not_hidden_by_retries(self):
  for error in (FileNotFoundError(),):
   with patch.object(Path,'read_text',side_effect=error) as read:
    with self.assertRaises(type(error)):read_fields('heartbeat.tsv')
    self.assertEqual(read.call_count,1)
  with patch.object(Path,'read_text',return_value='broken row'):
   with self.assertRaisesRegex(ValueError,'INVALID_LOCAL_ROW'):read_fields('heartbeat.tsv')
 def test_concurrent_atomic_heartbeat_updates_never_expose_partial_identity(self):
  with tempfile.TemporaryDirectory() as folder:
   path=Path(folder)/'heartbeat.tsv';atomic_write(path,encode_fields({'sequence':0,'identity':'session-0'}))
   errors=[]
   def write():
    try:
     for i in range(1,501):atomic_write(path,encode_fields({'sequence':i,'identity':'session-'+str(i)}))
    except Exception as error:errors.append(error)
   worker=threading.Thread(target=write);worker.start()
   try:
    for _ in range(1000):
     fields=read_fields(path)
     self.assertEqual(fields['identity'],'session-'+fields['sequence'])
   finally:worker.join(5)
   self.assertFalse(worker.is_alive());self.assertEqual(errors,[])
