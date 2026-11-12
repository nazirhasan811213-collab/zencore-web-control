"""Execute the EA's pure price rules in a native offline harness. No trades/network."""
import pathlib,shutil,subprocess,tempfile,unittest

class FillGuard(unittest.TestCase):
 def test_actual_ea_rules_both_sides_and_fill_slippage(self):
  compiler=shutil.which('g++')
  if not compiler:self.skipTest('Native C++ compiler unavailable')
  source=pathlib.Path(__file__).with_name('ZenCoreExecutor.mq5').read_text()
  rules=source.split('// Pure price rules:')[1].split('// End pure TF2 entry price rules.')[0]
  rules=rules[rules.index('bool Tf2EntryPriceAllowed'):]
  main=r'''
int main(){
 for(double sign:{-1.0,1.0}){
  assert(PineEntryGapAllowed(4000+sign*3.99,4000));
  assert(!PineEntryGapAllowed(4000+sign*4,4000));
  assert(!PineEntryGapAllowed(4000+sign*4.01,4000));
 }
 assert(PineEntryGapAllowed(4000,4000));
 assert(!PineEntryGapAllowed(NAN,4000));
 assert(!PineEntryGapAllowed(4000,0));
 assert(!Tf2EntryPriceAllowed(true,4016.00,4015.86));
 assert(!Tf2EntryPriceAllowed(false,4014.00,4014.14));
 assert(!Tf2EntryPriceAllowed(true,4015.86,4015.86));
 assert(Tf2EntryPriceAllowed(true,4015.50,4015.86));
 assert(std::abs(ExecutionStop(false,4061.0,4,.01)-4065.0)<1e-8);
 assert(std::abs(ExecutionStop(true,4061.0,4,.01)-4057.0)<1e-8);
 for(bool buy:{false,true})for(double tick:{.001,.01,.03,.25})for(double price:{4061.0,4061.017,4064.10}){
  double stop=ExecutionStop(buy,price,4,tick);
  double risk=buy?price-stop:stop-price;
  assert(Tf2EntryRiskAllowed(buy,price,stop,4));
  assert(risk>=4-tick-1e-8);
  assert(std::abs(stop/tick-std::round(stop/tick))<1e-8);
 }
 assert(ExecutionStop(false,4061.0,4,0)==0);
 // MT5 quotes of 4000 may fill at different prices; the confirmed plan uses the fill.
 assert(std::abs(ExecutionStop(true,4000.25,4,.01)-3996.25)<1e-8);
 assert(std::abs(ExecutionStop(false,3999.75,4,.01)-4003.75)<1e-8);
 assert(std::abs(ExecutionTarget(4000.25,4000,4001.5)-4001.75)<1e-8);
 assert(std::abs(ExecutionTarget(3999.75,4000,3998.5)-3998.25)<1e-8);
 assert(std::abs(ExecutionStop(true,4061,5.23,.01)-4055.77)<1e-8);
 assert(std::abs(ExecutionTarget(4061,4062,4059.5)-4058.5)<1e-8);
 assert(std::abs(ExecutionTarget(4061,4062,4064.5)-4063.5)<1e-8);
 assert(!Tf2EntryRiskAllowed(true,100,96,4.01));
 assert(Tf2EntryRiskAllowed(true,100,97,3));
 assert(Tf2EntryRiskAllowed(true,100,96,4));
 assert(!Tf2EntryRiskAllowed(true,100,95.99,4));
 assert(!Tf2EntryRiskAllowed(true,100,96.99,3));
 assert(!Tf2EntryRiskAllowed(true,100,101,2));
 assert(!Tf2EntryPriceAllowed(true,NAN,101));
}
'''
  with tempfile.TemporaryDirectory() as tmp:
   p=pathlib.Path(tmp);cpp=p/'guard.cpp';out=p/'guard'
   cpp.write_text('#include <cassert>\n#include <cmath>\n#include <algorithm>\n#include <initializer_list>\n#define MathCeil std::ceil\n#define MathFloor std::floor\n#define MathIsValidNumber std::isfinite\n#define MathAbs std::abs\n'+rules+main)
   subprocess.run([compiler,'-std=c++17',str(cpp),'-o',str(out)],check=True,capture_output=True)
   subprocess.run([str(out)],check=True,capture_output=True)
