import unittest
from protocol import command_fields
from test_protocol import CONTRACT,STRATEGY,SCHEMA,IDENTITY
class CurrentPineExitTests(unittest.TestCase):
 def test_current_policy_keeps_step_lock_for_entry_and_reentry(self):
  for tf in ('2','3','15'):
   for kind in ('INITIAL','FOLLOWUP'):
    for side in ('BUY','SELL'):
     sign=1 if side=='BUY' else -1
     prices=dict(side=side,entry=4200,sl=4200-sign*4,tp1=4200+sign*4,tp2=4200+sign*8,tp3=4200+sign*12)
     snap=dict(prices,contractVersion=CONTRACT,decisionOwner='ZENCORE_ANALYSIS',decision='ENTRY_AUTHORIZED',symbol='XAUUSD',executionTimeframe=tf,analysisSopVersion=f'NORMAL_20261001_TF{tf}_RIBBON_V1',entryPolicyVersion='PINE_3TRIGGERS_3OF4_CHOP50_V3',exitLockVersion='PINE_STEPLOCK_150_TP3_PLUS3_V1',cycleKind=kind)
     p=dict(prices,symbol='XAUUSD',analysisContractVersion=CONTRACT,strategy=STRATEGY,schemaVersion=SCHEMA,analysisSnapshot=snap,strategyMode='TF15_INTRA' if tf=='15' else 'TF2_SCALPING',lotPerLayer=.01,layers=2,exitPolicy=None)
     c=dict(id='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',type='PLACE_SETUP',expiresAt=1792370060000,payload=p)
     fields=command_fields(c,IDENTITY)
     self.assertEqual(fields['exitLockVersion'],snap['exitLockVersion'])
     for key in ('entry','sl','tp1','tp2','tp3'):self.assertEqual(float(fields[key]),prices[key])
     snap['exitLockVersion']='UNKNOWN'
     with self.assertRaisesRegex(ValueError,'EXIT_POLICY_REJECTED'):command_fields(c,IDENTITY)
