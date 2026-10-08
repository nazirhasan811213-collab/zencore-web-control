import tempfile,unittest
from pathlib import Path
from unittest.mock import patch
from connector import Runner
from protocol import atomic_write,encode_fields,read_fields,validation_code
from test_protocol import IDENTITY,NOW,KEY,POD,CONTRACT,STRATEGY,SCHEMA,signed,local_heartbeat
class CommandClockTests(unittest.TestCase):
 def cycle(self,offset,tf='2',server_time=NOW,tamper=False):
  folder=tempfile.TemporaryDirectory();self.addCleanup(folder.cleanup);path=Path(folder.name)
  h={**local_heartbeat(),'writtenAt':NOW+offset,'strategyExecutionVersion':'TF2_TF15_V1'}
  atomic_write(path/'heartbeat.tsv',encode_fields(h));acks=[];statuses=[]
  snap={'contractVersion':CONTRACT,'decisionOwner':'ZENCORE_ANALYSIS','decision':'ENTRY_AUTHORIZED','executionTimeframe':tf,'symbol':'XAUUSD','side':'BUY','entry':100,'sl':99,'tp1':101,'tp2':102,'tp3':103}
  p={**{k:snap[k] for k in ('symbol','side','entry','sl','tp1','tp2','tp3')},'analysisContractVersion':CONTRACT,'strategy':STRATEGY,'schemaVersion':SCHEMA,'analysisSnapshot':snap,'lotPerLayer':.01,'layers':2,'strategyMode':'TF15_INTRA' if tf=='15' else 'TF2_SCALPING','exitPolicy':None}
  cmd=signed('PLACE_SETUP',p)
  if tamper:cmd['signature']='bad'
  class Api:
   def request(self,url,data=None,token=None):
    if url.endswith('/heartbeat'):return {'desiredState':'ON'}
    if url.endswith('/next'):return {'command':cmd,'serverTime':server_time}
    acks.append(data);return {'ok':True}
  runner=Runner({**IDENTITY,'channel':folder.name,'podToken':'hidden','podId':'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','commandSigningKey':KEY,'podId':POD},statuses.append);runner.api=Api()
  with patch('protocol.time.time',return_value=(NOW+offset)/1000),patch('connector.time.monotonic',return_value=100):runner.cycle()
  return path,acks,statuses
 def test_live_tf2_and_tf15_ignore_vm_clock_offset_without_extending_validity(self):
  for tf in ('2','15'):
   for offset in (-120000,120000):
    path,acks,_=self.cycle(offset,tf)
    fields=read_fields(path/'command.tsv');self.assertEqual(int(fields['expiresAt']),NOW+offset+10000)
    self.assertEqual(fields['strategyMode'],'TF15_INTRA' if tf=='15' else 'TF2_SCALPING');self.assertEqual(fields['sl'],'99');self.assertEqual(acks,[])
 def test_expired_server_deadline_still_rejected_even_if_vm_clock_behind(self):
  path,acks,status=self.cycle(-120000,server_time=NOW+10001)
  self.assertFalse((path/'command.tsv').exists());self.assertEqual(acks[0]['code'],'COMMAND_EXPIRED')
 def test_tampered_signature_still_rejected(self):
  path,acks,_=self.cycle(120000,tamper=True)
  self.assertFalse((path/'command.tsv').exists());self.assertEqual(acks[0]['code'],'SIGNATURE_REJECTED')
 def test_missing_server_clock_fails_closed(self):
  path,acks,_=self.cycle(0,server_time=None)
  self.assertFalse((path/'command.tsv').exists());self.assertEqual(acks[0]['code'],'SERVER_TIME_REQUIRED')
 def test_error_reporting_never_exposes_unknown_exception_contents(self):
  self.assertEqual(validation_code(ValueError('private-secret')), 'COMMAND_VALIDATION_FAILED')
  self.assertEqual(validation_code(KeyError('private-secret')), 'REQUIRED_FIELD_MISSING')
