import unittest
from pathlib import Path
from protocol import command_fields,account_fingerprint
from test_protocol import IDENTITY
class ManualExitTests(unittest.TestCase):
 def fields(self,typ,payload):return command_fields({'id':'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','type':typ,'expiresAt':1791000000000,'payload':{**payload,'accountFingerprint':account_fingerprint(IDENTITY)}},IDENTITY)
 def test_config_cannot_enable_entry_or_expand_missing_risk(self):
  cfg={'version':'MANUAL_TF2_EXIT_V1','enabled':True,'timeframeMinutes':2,'tp1':1,'tp2':1.5,'tp3':2,'sl':1}
  result=self.fields('MANUAL_EXIT_CONFIG',{'manualExit':cfg})
  self.assertEqual(result['manualEnabled'],'1');self.assertNotIn('lot',result);self.assertNotIn('layers',result)
  for bad in ({'tp1':0},{'sl':1001},{'tp3':1},{'sl':True}):
   with self.assertRaises(ValueError):self.fields('MANUAL_EXIT_CONFIG',{'manualExit':{**cfg,**bad}})
 def test_only_exact_manual_ticket_and_allowed_sop_close_actions_are_encoded(self):
  data={'symbol':'XAUUSD','side':'SELL','ticket':'555','positionId':'666','sourceAt':1791000000000,'actions':[{'type':'CLOSE_PERCENT','reason':'CLOSE_SEPARUH','percent':50}]}
  self.assertEqual(self.fields('MANUAL_EXIT_ACTION',data)['ticket'],'555')
  for bad in ({'ticket':'0'},{'side':'WAIT'},{'symbol':'EURUSD'},{'actions':[{'type':'CLOSE_PERCENT','reason':'EXIT_SL','percent':100}]}):
   with self.assertRaises(ValueError):self.fields('MANUAL_EXIT_ACTION',{**data,**bad})
 def test_ea_transaction_hook_does_not_depend_on_web_refresh_and_manual_guards_exist(self):
  source=(Path(__file__).parent/'ZenCoreExecutor.mq5').read_text()
  self.assertIn('void OnTradeTransaction(',source);self.assertIn('TRADE_TRANSACTION_DEAL_ADD){ManageManual();Heartbeat();}',source)
  self.assertIn('manual-excluded-',source);self.assertIn('ACCOUNT_MARGIN_MODE_RETAIL_HEDGING',source)
  self.assertIn('Get("status")!="DONE"',source)
  self.assertIn('manualSourceAt>=(long)Val("adoptedAt")',source)
  manual=source[source.index('void ManageManual()'):source.index('void OnTradeTransaction')]
  self.assertNotIn('trade.Buy(',manual);self.assertNotIn('trade.Sell(',manual)
