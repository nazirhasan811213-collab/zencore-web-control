import pathlib, unittest
from protocol import command_fields
from test_protocol import CONTRACT, STRATEGY, SCHEMA, IDENTITY

class TF1ProtocolTests(unittest.TestCase):
 def test_one_minute_entry_preserves_symbol_direction_and_plan(self):
  for symbol in ('XAUUSD','BTCUSD'):
   for side in ('BUY','SELL'):
    sign=1 if side=='BUY' else -1
    price=dict(symbol=symbol,side=side,entry=64000,sl=64000-sign*300,tp1=64000+sign*150,tp2=64000+sign*250,tp3=64000+sign*400)
    snapshot=dict(price,contractVersion=CONTRACT,decisionOwner='ZENCORE_ANALYSIS',decision='ENTRY_AUTHORIZED',executionTimeframe='1',analysisSopVersion='NORMAL_20261001_TF1_RIBBON_V1',entryPolicyVersion='PINE_3TRIGGERS_3OF4_CHOP50_V3',executionPolicy='PINE_DIRECT_FILL_GAP4_V1',maxEntryGap=4,exitLockVersion='PINE_STEPLOCK_150_TP3_PLUS3_V1')
    payload=dict(price,analysisContractVersion=CONTRACT,strategy=STRATEGY,schemaVersion=SCHEMA,analysisSnapshot=snapshot,strategyMode='TF2_SCALPING',lotPerLayer=.01,layers=6,exitPolicy=None)
    command=dict(id='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',type='PLACE_SETUP',expiresAt=1792370060000,payload=payload)
    fields=command_fields(command,IDENTITY)
    self.assertEqual(fields['executionTimeframe'],'1')
    self.assertEqual(fields['strategyMode'],'TF2_SCALPING')
    self.assertEqual(fields['side'],side)
    self.assertEqual(fields['symbol'],symbol)
    for name in ('entry','sl','tp1','tp2','tp3'):self.assertEqual(float(fields[name]),price[name])
    snapshot['executionTimeframe']='2'
    with self.assertRaisesRegex(ValueError,'TIMEFRAME_MODE_MISMATCH'):command_fields(command,IDENTITY)
 def test_ea_dispatcher_accepts_tf1_with_the_existing_magic_and_manual_contract(self):
  source=pathlib.Path(__file__).with_name('ZenCoreExecutor.mq5').read_text()
  self.assertIn('executionTf!="1" && executionTf!="3" && executionTf!="2"',source)
  self.assertIn('const ulong MAGIC=32603231;',source)
  self.assertIn('MANUAL_PAIR_STEPLOCK_V5',source)
