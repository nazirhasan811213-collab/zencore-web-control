import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from connector import Runner
from protocol import heartbeat, account_fingerprint, command_fields, atomic_write, encode_fields, read_fields
from test_protocol import local_heartbeat, IDENTITY, NOW, signed, POD
class AccountSwitchTests(unittest.TestCase):
 def test_same_mask_different_full_account_never_matches(self):
  a={**IDENTITY,'account':'1111234'};b={**IDENTITY,'account':'2221234'}
  self.assertNotEqual(account_fingerprint(a),account_fingerprint(b))
  with self.assertRaisesRegex(ValueError,'ACCOUNT_CHANGED'):heartbeat({**local_heartbeat(),**b},a,NOW)
 def test_broker_and_mode_are_part_of_binding(self):
  a=account_fingerprint(IDENTITY)
  self.assertNotEqual(a,account_fingerprint({**IDENTITY,'server':'OtherBroker-Demo'}))
  self.assertNotEqual(a,account_fingerprint({**IDENTITY,'tradeMode':'REAL'}))
 def test_old_signed_payload_cannot_be_retargeted_to_new_account(self):
  identity={**IDENTITY,'account':'87654321','eaSession':'1'*32}
  with self.assertRaisesRegex(ValueError,'ACCOUNT_BINDING_CHANGED'):command_fields({'type':'SYSTEM_STOP','id':'a','expiresAt':NOW+1000,'payload':{'accountFingerprint':account_fingerprint(IDENTITY)}},identity)
 def test_stop_during_network_response_never_renews_lease(self):
  with tempfile.TemporaryDirectory() as folder:
   path=Path(folder);atomic_write(path/'heartbeat.tsv',encode_fields(local_heartbeat()))
   runner=Runner({**IDENTITY,'channel':folder,'podToken':'test-only'},lambda _:None)
   class Api:
    def request(self,*args,**kwargs):runner.stop.set();return {'desiredState':'ON'}
   runner.api=Api()
   with patch('protocol.time.time',return_value=NOW/1000):runner.cycle()
   self.assertFalse((path/'lease.tsv').exists())
 def test_changed_session_during_fetch_never_delivers(self):
  with tempfile.TemporaryDirectory() as folder:
   path=Path(folder);atomic_write(path/'heartbeat.tsv',encode_fields(local_heartbeat()))
   runner=Runner({**IDENTITY,'channel':folder,'podToken':'test-only','commandSigningKey':'test-key-string-more-than-32-characters'},lambda _:None)
   class Api:
    def request(self,url,data=None,token=None):
     if url.endswith('/heartbeat'):return {'desiredState':'ON'}
     atomic_write(path/'heartbeat.tsv',encode_fields({**local_heartbeat(),'eaSession':'2'*32}))
     return {'command':signed(),'serverTime':NOW}
   runner.api=Api()
   with patch('protocol.time.time',return_value=NOW/1000):runner.cycle()
   self.assertFalse((path/'command.tsv').exists())
 def test_lost_connection_immediately_invalidates_entry_permission(self):
  with tempfile.TemporaryDirectory() as folder:
   runner=Runner({**IDENTITY,'channel':folder},lambda _:None)
   runner.invalidate_lease()
   self.assertEqual(read_fields(Path(folder)/'lease.tsv')['expiresAt'],'0')
