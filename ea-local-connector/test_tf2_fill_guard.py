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
 assert(!Tf2EntryPriceAllowed(true,4016.00,4015.86));
 assert(!Tf2EntryPriceAllowed(false,4014.00,4014.14));
 assert(!Tf2EntryPriceAllowed(true,4015.86,4015.86));
 assert(Tf2EntryPriceAllowed(true,4015.50,4015.86));
 for(bool buy:{false,true})for(double risk:{0.1,0.5,1.0,2.0,2.5,3.0})for(double drift:{-1.0,0.0,0.2,1.5,3.0}){
  double sign=buy?1:-1,planned=4000-sign*risk,fill=4000+sign*drift;
  double stop=Tf2EntryStop(buy,fill,planned,risk);
  if(sign*(fill-planned)>0){assert(Tf2EntryRiskAllowed(buy,fill,stop,risk));assert(sign*(stop-planned)>=-1e-8);}
  else assert(!Tf2EntryRiskAllowed(buy,fill,stop,risk));
 }
 assert(!Tf2EntryRiskAllowed(true,4016,4012.36,2));
 assert(Tf2EntryRiskAllowed(true,4016,Tf2EntryStop(true,4016,4012.36,2),2));
 assert(!Tf2EntryRiskAllowed(true,100,97,3.01));
 assert(Tf2EntryRiskAllowed(true,100,97,3));
 assert(!Tf2EntryRiskAllowed(true,100,96.99,3));
 assert(!Tf2EntryRiskAllowed(true,100,101,2));
 assert(!Tf2EntryPriceAllowed(true,NAN,101));
}
'''
  with tempfile.TemporaryDirectory() as tmp:
   p=pathlib.Path(tmp);cpp=p/'guard.cpp';out=p/'guard'
   cpp.write_text('#include <cassert>\n#include <cmath>\n#include <algorithm>\n#include <initializer_list>\n#define MathMax std::max\n#define MathMin std::min\n'+rules+main)
   subprocess.run([compiler,'-std=c++17',str(cpp),'-o',str(out)],check=True,capture_output=True)
   subprocess.run([str(out)],check=True,capture_output=True)
