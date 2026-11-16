"""Run the actual MQL resolver against simulated broker symbol catalogues."""
import pathlib,shutil,subprocess,tempfile,unittest
class SymbolMapping(unittest.TestCase):
 def test_gold_aliases_chart_selection_and_ambiguity(self):
  compiler=shutil.which('g++')
  if not compiler:self.skipTest('Native compiler unavailable')
  source=pathlib.Path(__file__).with_name('ZenCoreExecutor.mq5').read_text()
  rules=source.split('// Symbol resolution:')[1].split('bool IsManual(')[0]
  rules=rules[rules.index('bool GoldUsdSymbol'):]
  rules+=source.split('// Bitcoin symbol resolution.')[1].split('// End Bitcoin symbol resolution.')[0]
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
string canonical[9]={"XAUUSD","EURUSD","GBPUSD","USDJPY","USDCAD","USDCHF","EURJPY","GBPJPY","EURGBP"},brokerSymbols[9],GoldBrokerSymbol,BitcoinBrokerSymbol,_Symbol;
string Broker(string source){for(int i=0;i<9;i++)if(canonical[i]==source)return brokerSymbols[i];return "";}
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

 def test_direct_entry_routes_to_registered_chart_without_symbol_catalogue(self):
  compiler=shutil.which('g++')
  if not compiler:self.skipTest('Native compiler unavailable')
  source=pathlib.Path(__file__).with_name('ZenCoreExecutor.mq5').read_text()
  role=source[source.index('string ChartRoleKey('):source.index('void RegisterEntryChart()')]
  route=source[source.index('long DirectEntryChart('):source.index('string RegisteredChartSymbol(')]
  harness=r'''
#include <string>
#include <map>
#include <cassert>
#include <algorithm>
using string=std::string;
void StringToUpper(string &s){std::transform(s.begin(),s.end(),s.begin(),::toupper);}
int StringFind(string s,string part){auto n=s.find(part);return n==string::npos?-1:int(n);}
enum{CHART_AUTO,CHART_XAUUSD,CHART_BTCUSD};
long primaryChart=10,localChart=10;
int registeredRole=CHART_XAUUSD;
std::map<long,int> charts{{10,CHART_XAUUSD},{20,CHART_BTCUSD},{30,CHART_BTCUSD}};
long ChartID(){return localChart;}
long ChartFirst(){return charts.begin()->first;}
long ChartNext(long chart){auto it=charts.upper_bound(chart);return it==charts.end()?-1:it->first;}
double GlobalVariableGet(string key){return charts.at(std::stol(key.substr(key.rfind('.')+1)));}
'''
  # MQL string cast is equivalent to std::to_string for the chart ID.
  role=role.replace('(string)chart','std::to_string(chart)')
  main=r'''
int main(){
 assert(ChartRoleFromName("XAUUSD.")==CHART_XAUUSD);
 assert(ChartRoleFromName("BTCUSD")==CHART_BTCUSD);
 assert(ChartRoleFromName("btcusd.m")==CHART_BTCUSD);
 assert(ChartRoleFromName("BTCUSDT")==CHART_AUTO);
 assert(ChartRoleFromName("XAUJPY")==CHART_AUTO);
 assert(DirectEntryChart("XAUUSD")==10);
 assert(DirectEntryChart("BTCUSD")==20);
 localChart=30;registeredRole=CHART_BTCUSD;
 assert(DirectEntryChart("BTCUSD")==20);
 assert(DirectEntryChart("XAUUSD")==10);
 charts.erase(20);assert(DirectEntryChart("BTCUSD")==30);
 charts.erase(10);assert(DirectEntryChart("XAUUSD")==-1);
}
'''
  self.assertIn('symbol=_Symbol;',source[source.index('bool Entry('):source.index('void Result(')])
  self.assertIn('EA_ENTRY_CHART_NOT_ATTACHED',source)
  with tempfile.TemporaryDirectory() as tmp:
   p=pathlib.Path(tmp);(p/'routes.cpp').write_text(harness+role+route+main)
   subprocess.run([compiler,'-std=c++17',str(p/'routes.cpp'),'-o',str(p/'routes')],check=True,capture_output=True)
   subprocess.run([str(p/'routes')],check=True,capture_output=True)
