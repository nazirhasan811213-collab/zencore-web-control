import json,tempfile,threading,time,unittest
from pathlib import Path
from unittest.mock import patch
from connector import reset_connector_data,App
from protocol import atomic_write,encode_fields,read_fields
from test_protocol import local_heartbeat
from vps_manager import expected_channel

class ResetTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
  self.root=Path(self.tmp.name);self.common=self.root/'common'
  self.identity=local_heartbeat();self.identity['writtenAt']=int(time.time()*1000)
  self.channel=expected_channel(self.common,self.identity);self.channel.mkdir(parents=True)
  self.config={**self.identity,'channel':str(self.channel)}
  self.token=self.root/'paired.dpapi';self.token.write_bytes(b'old-secret')
  self.write_heartbeat()
 def write_heartbeat(self,**changes):
  atomic_write(self.channel/'heartbeat.tsv',encode_fields({**self.identity,**changes}))
 def reset(self):reset_connector_data(self.config,config_path=self.token,common=self.common)
 def test_reset_clears_only_connector_data_and_blocks_old_lease(self):
  for n in ('connector-health.json','execution-timing.jsonl','execution-timing.previous.jsonl','risk-old.tsv','manual-old.tsv','state.tsv'):(self.channel/n).write_text('keep-or-clear')
  other=self.common/'other';other.mkdir();(other/'paired.dpapi').write_text('other-client')
  self.token.with_suffix('.tmp').write_text('old-secret')
  self.reset()
  self.assertFalse(self.token.exists());self.assertFalse(self.token.with_suffix('.tmp').exists())
  for n in ('connector-health.json','execution-timing.jsonl','execution-timing.previous.jsonl'):self.assertFalse((self.channel/n).exists())
  for n in ('risk-old.tsv','manual-old.tsv','state.tsv','heartbeat.tsv'):self.assertTrue((self.channel/n).exists())
  self.assertEqual((other/'paired.dpapi').read_text(),'other-client')
  self.assertEqual(read_fields(self.channel/'lease.tsv')['expiresAt'],'0')
  self.reset() # repeated click stays safe
 def test_open_unknown_offline_or_pending_positions_preserve_token(self):
  for changes in ({'positionCount':1},{'positionCount':-1},{'terminalConnected':0},{'writtenAt':0}):
   with self.subTest(changes=changes):
    self.write_heartbeat(**changes)
    with self.assertRaises((RuntimeError,ValueError,KeyError)):self.reset()
    self.assertTrue(self.token.exists())
  self.write_heartbeat()
  for name in ('command.tsv','old.result'):
   (self.channel/name).write_text('pending')
   with self.assertRaisesRegex(RuntimeError,'RESET_COMMAND_PENDING'):self.reset()
   self.assertTrue(self.token.exists());(self.channel/name).unlink()
 def test_untrusted_channel_cannot_delete_another_profile(self):
  self.config['channel']=str(self.root)
  with self.assertRaisesRegex(RuntimeError,'CHANNEL_BINDING_INVALID'):self.reset()
  self.assertTrue(self.token.exists())
 def test_running_worker_must_stop_before_any_data_is_deleted(self):
  class Thread:
   def join(self,timeout):pass
   def is_alive(self):return True
  with self.assertRaisesRegex(RuntimeError,'CONNECTOR_STOP_PENDING'):
   reset_connector_data(self.config,runner_thread=Thread(),config_path=self.token,common=self.common)
  self.assertTrue(self.token.exists())
 def test_normal_reset_clears_old_login_session_and_credentials(self):
  class Value:
   def __init__(self):self.value='old-client'
   def set(self,value):self.value=value
  class Immediate:
   def __init__(self,target,**kwargs):self.target=target
   def start(self):self.target()
  app=App.__new__(App);app.pairing=False;app.switching=False;app.runner=None;app.runner_thread=None
  app.session_api=object();app.post=lambda fn:fn();app.accounts={};app.available={'old':None}
  for n in ('status','email','password','account','folder'):setattr(app,n,Value())
  with patch('connector.messagebox.askyesno',return_value=True),patch('connector.load_config',return_value=None),patch('connector.reset_connector_data') as reset,patch('connector.threading.Thread',Immediate):app.reset_link()
  reset.assert_called_once();self.assertIsNone(app.session_api);self.assertFalse(app.available)
  for n in ('email','password','account','folder'):self.assertEqual(getattr(app,n).value,'')
