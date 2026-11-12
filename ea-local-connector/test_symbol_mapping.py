"""Run the actual MQL resolver against simulated broker symbol catalogues."""
import pathlib,shutil,subprocess,tempfile,unittest
class SymbolMapping(unittest.TestCase):
 def test_gold_aliases_chart_selection_and_ambiguity(self):
  compiler=shutil.which('g++')
  if not compiler:self.skipTest('Native compiler unavailable')
  source=pathlib.Path(__file__).with_name('ZenCoreExecutor.mq5').read_text()
  rules=source.split('// Symbol resolution:')[1].split('// End symbol resolution.')[0]
  rules=rules[rules.index('bool GoldUsdSymbol'):]
  harness=r'''
#include <string>
#include <map>
#include <vector>
#include <algorithm>
#include <cassert>
using string=std::string;
const int SYMBOL_CURRENCY_BASE=1,SYMBOL_CURRENCY_PROFIT=2,SYMBOL_TRADE_MODE=3;
const int SYMBOL_TRADE_MODE_DISABLED=0,SYMBOL_TRADE_MODE_CLOSEONLY=3;
struct Spec {string base,profit;int mode=4;};
std::map<string,Spec> specs;
string canonical[9]={"XAUUSD","EURUSD","GBPUSD","USDJPY","USDCAD","USDCHF","EURJPY","GBPJPY","EURGBP"},brokerSymbols[9],GoldBrokerSymbol,_Symbol;
string SymbolInfoString(string s,int p){if(!specs.count(s))return "";return p==1?specs[s].base:specs[s].profit;}
int SymbolInfoInteger(string s,int){return specs.count(s)?specs[s].mode:0;}
bool SymbolSelect(string s,bool){return specs.count(s);}
void StringToUpper(string &s){std::transform(s.begin(),s.end(),s.begin(),::toupper);}
int StringFind(string s,string part){auto n=s.find(part);return n==string::npos?-1:int(n);}
int SymbolsTotal(bool){return specs.size();}
string SymbolName(int n,bool){auto it=specs.begin();std::advance(it,n);return it->first;}
'''
  main=r'''
int main(){
 specs={{"GOLD.pro",{"XAU","USD",4}},{"XAUUSD.old",{"XAU","USD",0}}};_Symbol="EURUSD";
 MapSymbols();assert(brokerSymbols[0]=="GOLD.pro");
 specs["XAUUSD.m"]={"XAU","USD",4};MapSymbols();assert(brokerSymbols[0]=="");
 _Symbol="XAUUSD.m";MapSymbols();assert(brokerSymbols[0]=="XAUUSD.m");
 GoldBrokerSymbol="GOLD.pro";MapSymbols();assert(brokerSymbols[0]=="GOLD.pro");
 GoldBrokerSymbol="missing";MapSymbols();assert(brokerSymbols[0]=="");
 GoldBrokerSymbol="";_Symbol="XAUEUR";specs={{"XAUEUR",{"XAU","EUR",4}},{"GOLDJPY",{"XAU","JPY",4}}};
 MapSymbols();assert(brokerSymbols[0]=="");
 specs={{"XAUUSD",{"XAU","USD",3}},{"GOLD",{"XAU","USD",4}}};MapSymbols();assert(brokerSymbols[0]=="XAUUSD");
 specs={{"XAUUSD.m",{"","",4}}};MapSymbols();assert(brokerSymbols[0]=="XAUUSD.m");
 specs={{"GOLDJPY",{"","",4}}};MapSymbols();assert(brokerSymbols[0]=="");
 specs={{"XAUUSD",{"XAU","USD",4}}};MapSymbols();assert(brokerSymbols[0]=="XAUUSD");
}
'''
  with tempfile.TemporaryDirectory() as tmp:
   p=pathlib.Path(tmp);(p/'mapping.cpp').write_text(harness+rules+main)
   subprocess.run([compiler,'-std=c++17',str(p/'mapping.cpp'),'-o',str(p/'mapping')],check=True,capture_output=True)
   subprocess.run([str(p/'mapping')],check=True,capture_output=True)
