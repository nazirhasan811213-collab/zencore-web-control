import tempfile,unittest
from pathlib import Path
from unittest.mock import patch
from connector import Runner
from protocol import atomic_write,encode_fields,read_fields,command_fields,CONTRACT,STRATEGY,SCHEMA
from status_view import status_cards
from test_protocol import IDENTITY,NOW,local_heartbeat,POD,KEY,ID,signed

class V2ConnectorTests(unittest.TestCase):
 def test_exact_sl_is_default_and_legacy_shrink_requires_explicit_policy(self):
  snap={'contractVersion':CONTRACT,'decisionOwner':'ZENCORE_ANALYSIS','decision':'ENTRY_AUTHORIZED','symbol':'XAUUSD','side':'BUY','entry':100,'sl':97,'tp1':102,'tp2':104,'tp3':106}
  p={**snap,'analysisContractVersion':CONTRACT,'strategy':STRATEGY,'schemaVersion':SCHEMA,'analysisSnapshot':snap,'lotPerLayer':.01,'layers':3}
  f=command_fields({'id':ID,'type':'PLACE_SETUP','expiresAt':NOW+10000,'payload':p},IDENTITY)
  self.assertEqual(f['slPolicy'],'EXACT_ANALYSIS_V2');self.assertEqual(f['sl'],'97')
  p.update(strategyMode='TF2_SCALPING',exitPolicy={'version':'TF2_TIGHT_SL_3C_V1','timeframeMinutes':2,'slDistanceFactor':.8,'maxCompletedCandlesWithoutTp1':3})
  self.assertEqual(command_fields({'id':ID,'type':'PLACE_SETUP','expiresAt':NOW+10000,'payload':p},IDENTITY)['slPolicy'],'LEGACY_TIGHT_SL_80')
 def test_server_pause_wins_even_if_old_profile_was_on(self):
  with tempfile.TemporaryDirectory() as folder:
   path=Path(folder);atomic_write(path/'heartbeat.tsv',encode_fields(local_heartbeat()));r=Runner({**IDENTITY,'channel':folder,'podToken':'test'},lambda _:None)
   class API:
    def request(self,*args,**kwargs):return {'desiredState':'ON','entryBlockedReason':'GLOBAL_ENTRY_PAUSED'}
   r.api=API()
   with patch('protocol.time.time',return_value=NOW/1000):self.assertTrue(r.renew_lease(local_heartbeat()))
   self.assertEqual(read_fields(path/'lease.tsv')['desiredState'],'STOPPED');self.assertEqual(r.entry_blocked_reason,'GLOBAL_ENTRY_PAUSED')
 def test_results_are_forwarded_even_if_ea_heartbeat_disappeared(self):
  with tempfile.TemporaryDirectory() as folder:
   path=Path(folder);atomic_write(path/(ID+'.result'),encode_fields({'id':ID,'status':'EXECUTED','code':'MANAGED'}));r=Runner({**IDENTITY,'channel':folder,'podToken':'test'},lambda _:None);calls=[]
   class API:
    def request(self,url,*args,**kwargs):calls.append(url);return {'ok':True}
   r.api=API()
   with self.assertRaises(FileNotFoundError):r.cycle()
   self.assertEqual(calls,['/api/execution/commands/'+ID+'/ack']);self.assertFalse((path/(ID+'.result')).exists())
 def test_cloud_failure_keeps_result_for_retry_and_never_fetches_entry(self):
  with tempfile.TemporaryDirectory() as folder:
   path=Path(folder);atomic_write(path/(ID+'.result'),encode_fields({'id':ID,'status':'EXECUTED','code':'MANAGED'}));r=Runner({**IDENTITY,'channel':folder,'podToken':'test'},lambda _:None)
   with patch.object(r.api,'request',side_effect=RuntimeError('NETWORK_UNAVAILABLE')) as api:
    with self.assertRaisesRegex(RuntimeError,'NETWORK_UNAVAILABLE'):r.cycle()
   self.assertTrue((path/(ID+'.result')).exists());self.assertEqual(api.call_count,1)
 def test_old_ea_cannot_receive_new_on_command(self):
  with tempfile.TemporaryDirectory() as folder:
   path=Path(folder);local=local_heartbeat();local.pop('executorPolicyVersion');atomic_write(path/'heartbeat.tsv',encode_fields(local));r=Runner({**IDENTITY,'channel':folder,'podToken':'test','commandSigningKey':KEY},lambda _:None);acks=[]
   command=signed('SYSTEM_ON',{'mode':'DEMO','strategy':STRATEGY,'exitSchema':SCHEMA,'settings':{'symbols':['XAUUSD'],'lotPerLayer':.01,'layers':3}})
   class API:
    def request(self,url,data=None,token=None):
     if url.endswith('/heartbeat'):return {'desiredState':'ON'}
     if url.endswith('/next'):return {'command':command,'serverTime':NOW}
     acks.append(data);return {'ok':True}
   r.api=API()
   with patch('protocol.time.time',return_value=NOW/1000):r.cycle()
   self.assertEqual(acks[0]['code'],'EA_POLICY_UPGRADE_REQUIRED');self.assertFalse((path/'command.tsv').exists())
 def test_health_separates_connection_permission_and_server_pause(self):
  local={'writtenAt':NOW,'terminalConnected':True,'terminalTradeAllowed':True,'accountTradeAllowed':True,'expertTradeAllowed':True,'executorPolicyVersion':'EXACT_ANALYSIS_V2'}
  cloud={'lastCloudHeartbeatMs':NOW,'desiredState':'ON','consecutiveFailures':0}
  self.assertEqual(status_cards(local,cloud,NOW,True)['entry'][0],'ENTRY DIBENARKAN')
  self.assertEqual(status_cards(local,{**cloud,'entryBlockedReason':'GLOBAL_ENTRY_PAUSED'},NOW,True)['entry'][0],'SERVER PAUSED')
  self.assertNotEqual(status_cards(local,cloud,NOW+16000,True)['entry'][1],'good')
  self.assertNotEqual(status_cards({**local,'terminalTradeAllowed':False},cloud,NOW,True)['entry'][1],'good')
