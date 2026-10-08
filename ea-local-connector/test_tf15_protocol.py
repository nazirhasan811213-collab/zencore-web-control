import unittest
from protocol import command_fields,heartbeat
from test_protocol import signed,verified_command,IDENTITY,KEY,POD,NOW,CONTRACT,STRATEGY,SCHEMA,local_heartbeat
class TF15ProtocolTests(unittest.TestCase):
 def test_tf15_command_preserves_mode_and_refuses_tf2_snapshot(self):
  snap={'contractVersion':CONTRACT,'decisionOwner':'ZENCORE_ANALYSIS','decision':'ENTRY_AUTHORIZED','executionTimeframe':'15','symbol':'XAUUSD','side':'BUY','entry':100,'sl':99,'tp1':102,'tp2':104,'tp3':106}
  p={**{k:snap[k] for k in ('symbol','side','entry','sl','tp1','tp2','tp3')},'analysisContractVersion':CONTRACT,'strategy':STRATEGY,'schemaVersion':SCHEMA,'analysisSnapshot':snap,'lotPerLayer':.01,'layers':2,'strategyMode':'TF15_INTRA'}
  c=verified_command(signed('PLACE_SETUP',p),KEY,POD,NOW)
  self.assertEqual(command_fields(c,IDENTITY)['strategyMode'],'TF15_INTRA')
  c['payload']['analysisSnapshot']['executionTimeframe']='2'
  with self.assertRaisesRegex(ValueError,'TF15_SNAPSHOT_REQUIRED'):command_fields(c,IDENTITY)
 def test_old_ea_cannot_advertise_tf15_capability(self):
  h={**local_heartbeat(),'exitPolicyVersion':'TF2_TIGHT_SL_3C_V1'}
  self.assertEqual(heartbeat(h,IDENTITY,NOW)['connectorVersion'],'1.1.0-ea-local')
  h.pop('accountBindingVersion'); h.pop('eaSession')
  h['strategyExecutionVersion']='TF2_TF15_V1'
  self.assertEqual(heartbeat(h,IDENTITY,NOW)['connectorVersion'],'1.3.0-ea-local')
