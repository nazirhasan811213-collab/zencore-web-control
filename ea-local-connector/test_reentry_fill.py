import copy,unittest
from protocol import command_fields,heartbeat,CONTRACT,STRATEGY,SCHEMA
from test_protocol import ID,IDENTITY,NOW,local_heartbeat
class ReentryFillTests(unittest.TestCase):
 def payload(self,side='BUY',atr=10):
  sign=1 if side=='BUY' else -1;d={'tp1':min(.5*atr,2),'tp2':atr,'tp3':1.5*atr,'sl':.75*atr}
  prices={k:4100+(-sign if k=='sl' else sign)*v for k,v in d.items()}
  r={'version':'TF2_POST_CLOSE_HALF_LAYERS_V1','parentCommandId':ID,'closedAt':NOW,'layerFraction':.5}
  snap={'contractVersion':CONTRACT,'decisionOwner':'ZENCORE_ANALYSIS','decision':'ENTRY_AUTHORIZED','symbol':'XAUUSD','side':side,'entry':4100,**prices,'entryAnchor':'FILL_PRICE_ATR_V1','reentry':r}
  return {**snap,'analysisContractVersion':CONTRACT,'strategy':STRATEGY,'schemaVersion':SCHEMA,'analysisSnapshot':snap,'strategyMode':'TF2_SCALPING','lotPerLayer':.01,'layers':2,'reentry':r,'fillRisk':{'version':'FILL_PRICE_ATR_V1','atr':atr,'distances':d},'exitPolicy':None}
 def fields(self,p):return command_fields({'id':ID,'type':'PLACE_SETUP','expiresAt':NOW+10000,'payload':p},IDENTITY)
 def test_signed_reentry_carries_frozen_atr_with_only_tp1_cap(self):
  for side in ('BUY','SELL'):
   p=self.payload(side);f=self.fields(p);self.assertEqual(f['fillAnchor'],'FILL_PRICE_ATR_V1');self.assertEqual(f['riskAtr'],'10');self.assertEqual(f['layers'],2)
 def test_tampered_range_anchor_direction_and_policy_rejected(self):
  for mutate in (lambda p:p['fillRisk']['distances'].update(tp2=4),lambda p:p['fillRisk'].update(atr=0),lambda p:p['fillRisk'].update(version='wrong'),lambda p:p.update(strategyMode='TF15_INTRA'),lambda p:p['analysisSnapshot']['reentry'].update(parentCommandId='wrong')):
   p=copy.deepcopy(self.payload());p['analysisSnapshot']['reentry']=copy.deepcopy(p['reentry']);mutate(p)
   with self.assertRaises(ValueError):self.fields(p)
 def test_heartbeat_reports_capability_setup_and_per_position_targets(self):
  h=local_heartbeat();h.update(reentryVersion='TF2_POST_CLOSE_HALF_LAYERS_V1',fillRiskVersion='FILL_PRICE_ATR_V1',positionCount=1,p0ticket='55',p0positionId='55',p0symbol='XAUUSD',p0side='BUY',p0strategyMode='TF2_SCALPING',p0volume='.01',p0entry='4100',p0currentPrice='4101',p0activeSl='4097.75',p0profitUsd='1',p0openedAt=str(NOW),p0setupId=ID[:20],p0fillRiskVersion='FILL_PRICE_ATR_V1',p0tp1='4101.5',p0tp2='4103',p0tp3='4104.5',p0initialSl='4097.75')
  x=heartbeat(h,IDENTITY,NOW);self.assertTrue(x['terminalConnected']);self.assertEqual(x['fillRiskVersion'],'FILL_PRICE_ATR_V1');self.assertEqual(x['positions'][0]['tp1'],4101.5);self.assertEqual(x['positions'][0]['setupId'],ID[:20])
