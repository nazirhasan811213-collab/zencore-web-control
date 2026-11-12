"""Exercise the EA's actual manual milestone functions offline; never place orders."""
import pathlib,shutil,subprocess,tempfile,unittest
class ManualStepLock(unittest.TestCase):
 def test_buy_sell_custom_targets_and_pullback(self):
  cc=shutil.which('g++')
  if not cc:self.skipTest('Native compiler unavailable')
  source=pathlib.Path(__file__).with_name('ZenCoreExecutor.mq5').read_text()
  rules=source.split('// Pure manual step-lock rules:')[1].split('// End pure manual step-lock rules.')[0]
  rules=rules[rules.index('int ManualReachedStage'):]
  main=r'''
int main(){
 for(bool buy:{false,true}){
  double sign=buy?1:-1,entry=4000.25,initial=entry-sign*4;
  double t1=entry+sign*1.5,t2=entry+sign*2.5,t3=entry+sign*3.5;
  assert(ManualReachedStage(buy,entry,t1,t2,t3)==0);
  assert(ManualStageStop(0,entry,initial,t1,t2,t3)==initial);
  assert(ManualReachedStage(buy,t1,t1,t2,t3)==1);
  assert(ManualStageStop(1,entry,initial,t1,t2,t3)==entry);
  assert(ManualReachedStage(buy,t2,t1,t2,t3)==2);
  assert(ManualStageStop(2,entry,initial,t1,t2,t3)==t1);
  assert(ManualReachedStage(buy,t3,t1,t2,t3)==3);
  assert(ManualStageStop(3,entry,initial,t1,t2,t3)==t2);
  assert(ManualReachedStage(buy,t3+sign*1.99,t1,t2,t3)==3);
  assert(ManualReachedStage(buy,t3+sign*2,t1,t2,t3)==4);
  assert(ManualStageStop(4,entry,initial,t1,t2,t3)==t3);
  assert(ManualReachedStage(buy,t3+sign*20,t1,t2,t3)==4);
  // A persisted stage-4 lock remains TP3 after price retreats below TP2.
  assert(ManualReachedStage(buy,t1,t1,t2,t3)==1);
  assert(ManualStageStop(4,entry,initial,t1,t2,t3)==t3);
 }
}
'''
  with tempfile.TemporaryDirectory() as tmp:
   p=pathlib.Path(tmp);(p/'rules.cpp').write_text('#include <cassert>\n#include <initializer_list>\n'+rules+main)
   subprocess.run([cc,'-std=c++17',str(p/'rules.cpp'),'-o',str(p/'rules')],check=True,capture_output=True)
   subprocess.run([str(p/'rules')],check=True,capture_output=True)
 def test_manual_path_clears_hard_tp_and_rejects_pine_closes(self):
  source=pathlib.Path(__file__).with_name('ZenCoreExecutor.mq5').read_text()
  manual=source.split('void ManageManual(){')[1].split('void OnTradeTransaction')[0]
  self.assertIn('trade.PositionModify(ticket,target,0)',manual)
  self.assertIn('if(reached>stage){stage=reached;',manual)
  self.assertIn('if(!manualEnabled || !Permissions()',manual)
  self.assertNotIn('quote>=t3:quote<=t3',manual)
  self.assertIn('code="MANUAL_EXIT_STEPLOCK_ONLY"',source)
