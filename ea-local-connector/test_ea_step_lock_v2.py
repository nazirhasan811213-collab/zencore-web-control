"""Execute the extracted EA StepLock function with deterministic broker stubs.
This checks logic, not MetaEditor compilation or broker acceptance.
"""
import shutil,subprocess,tempfile,unittest
from pathlib import Path

CPP=r'''
#include <string>
#include <vector>
#include <map>
#include <sstream>
#include <cassert>
#include <algorithm>
using string=std::string;
using ulong=unsigned long;
constexpr int POSITION_MAGIC=1,POSITION_TYPE=2,POSITION_PRICE_OPEN=3,POSITION_SL=4,POSITION_TP=5,POSITION_VOLUME=6,POSITION_IDENTIFIER=7,POSITION_COMMENT=8,POSITION_SYMBOL=9;
constexpr int POSITION_TYPE_BUY=0,SYMBOL_TRADE_STOPS_LEVEL=10,SYMBOL_TRADE_FREEZE_LEVEL=11,SYMBOL_POINT=12;
struct MqlTick {double bid,ask;};
bool allowed=true,owned=true,closed=false,failModify=false;
int side=0;double quote=101.2,oldSl=99;ulong clockMs=1000;
std::map<string,string> files,fields;
template<class T> int ArraySize(const std::vector<T>& a){return (int)a.size();}
template<class T> void ArrayResize(std::vector<T>& a,int n){a.resize(n);}
ulong GetTickCount64(){return clockMs;}
bool Permissions(){return allowed;}
int PositionsTotal(){return 1;}
ulong PositionGetTicket(int){return 77;}
bool IsOwn(ulong){return owned;}
string PositionGetString(int x){return x==POSITION_COMMENT?"ZC:setup":"XAUUSD";}
long PositionGetInteger(int x){return x==POSITION_TYPE?side:77;}
double PositionGetDouble(int x){return x==POSITION_SL?oldSl:x==POSITION_PRICE_OPEN?100:x==POSITION_VOLUME?.01:0;}
int StringFind(const string& a,const string& b){auto p=a.find(b);return p==string::npos?-1:(int)p;}
string StringSubstr(const string& a,int n){return a.substr(n);}
void parse(const string& text){fields.clear();std::istringstream stream(text);string line;while(std::getline(stream,line)){auto p=line.find('\t');if(p!=string::npos)fields[line.substr(0,p)]=line.substr(p+1);}}
bool ReadFields(const string& name){if(!files.count(name))return false;parse(files[name]);return true;}
string Get(const string& k){return fields[k];}
double Val(const string& k){return fields.count(k)?std::stod(fields[k]):0;}
string Row(const string& k,const string& v){return k+"\t"+v+"\n";}
bool WriteAtomic(const string& name,const string& text){files[name]=text;return true;}
bool SymbolInfoTick(const string&,MqlTick& tick){tick.bid=quote;tick.ask=quote;return true;}
long SymbolInfoInteger(const string&,int){return 0;}
double SymbolInfoDouble(const string&,int){return 1;}
double MathMax(double a,double b){return std::max(a,b);}
double Price(const string&,double x){return x;}
bool CloseTicket(ulong,double){closed=true;return true;}
bool BrokerDone(){return true;}
template<class... T> void Print(T...){ }
struct MockTrade {bool PositionModify(ulong,double sl,double){if(failModify)return false;oldSl=sl;return true;}int ResultRetcode(){return 0;}} trade;
__EA_FUNCTION__
int main(){
 for(int sign:{1,-1}){
  side=sign==1?POSITION_TYPE_BUY:1;owned=true;allowed=true;closed=false;failModify=true;oldSl=100-sign;clockMs+=1000;files.clear();protectionTickets.clear();protectionTryAt.clear();
  files["risk-setup.tsv"]=Row("symbol","XAUUSD")+Row("side",sign==1?"BUY":"SELL")+Row("tp1",std::to_string(100+sign))+Row("tp2",std::to_string(100+2*sign))+Row("tp3",std::to_string(100+3*sign));
  quote=100+1.2*sign;ManageLocalStepLock();assert(files.count("lock-77.tsv"));assert(oldSl==100-sign);
  failModify=false;clockMs+=1000;quote=100+.5*sign;ManageLocalStepLock();assert(oldSl==100); // remembers touch after pullback
  clockMs+=1000;quote=100+2.2*sign;ManageLocalStepLock();assert(oldSl==100+sign);
  clockMs+=1000;quote=100+3.2*sign;ManageLocalStepLock();assert(oldSl==100+2*sign);
  oldSl=100-sign;protectionTickets.clear();protectionTryAt.clear();clockMs+=1000;quote=100+2.5*sign;ManageLocalStepLock();assert(oldSl==100+2*sign); // persisted across restart
  oldSl=100-sign;clockMs+=1000;quote=100+1.5*sign;ManageLocalStepLock();assert(closed); // breached pending lock closes own ticket
  closed=false;owned=false;clockMs+=1000;ManageLocalStepLock();assert(!closed);
 }
}
'''
class EaStepLockV2(unittest.TestCase):
 @unittest.skipUnless(shutil.which('g++'),'C++ logic harness compiler unavailable; MetaEditor is separate')
 def test_actual_ea_step_lock_persists_touch_and_respects_owned_positions(self):
  source=(Path(__file__).parent/'ZenCoreExecutor.mq5').read_text();function=source[source.index('ulong protectionTickets[]'):source.index('bool SaveManualConfig()')]
  function=function.replace('ulong protectionTickets[],protectionTryAt[];','std::vector<ulong> protectionTickets,protectionTryAt;').replace('(string)PositionGetInteger(POSITION_IDENTIFIER)','std::to_string(PositionGetInteger(POSITION_IDENTIFIER))').replace('(string)stage','std::to_string(stage)')
  with tempfile.TemporaryDirectory() as folder:
   root=Path(folder);(root/'test.cpp').write_text(CPP.replace('__EA_FUNCTION__',function));out=root/('test.exe' if __import__('sys').platform=='win32' else 'test')
   result=subprocess.run(['g++','-std=c++17',str(root/'test.cpp'),'-o',str(out)],capture_output=True,text=True)
   self.assertEqual(result.returncode,0,result.stderr);self.assertEqual(subprocess.run([str(out)],capture_output=True).returncode,0)
