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
#include <cmath>
using string=std::string;
using ulong=unsigned long;
constexpr int POSITION_MAGIC=1,POSITION_TYPE=2,POSITION_PRICE_OPEN=3,POSITION_SL=4,POSITION_TP=5,POSITION_VOLUME=6,POSITION_IDENTIFIER=7,POSITION_COMMENT=8,POSITION_SYMBOL=9;
constexpr int POSITION_TIME=15,PERIOD_M2=2,POSITION_TYPE_BUY=0,SYMBOL_TRADE_STOPS_LEVEL=10,SYMBOL_TRADE_FREEZE_LEVEL=11,SYMBOL_POINT=12,SYMBOL_VOLUME_STEP=13,FILE_COMMON=14;
string channel="test";
struct MqlTick {double bid,ask;};
struct MqlRates {long time;double close;};
double closedQuote=100;long closedTime=200,openedTime=0;int historyCount=1;
long TimeCurrent(){return closedTime+120;}
int CopyRates(const string&,int,int,int,std::vector<MqlRates>& rows){rows={{closedTime,closedQuote}};return historyCount;}
bool allowed=true,owned=true,closed=false,failModify=false;
int side=0;double quote=101.2,oldSl=99,positionVolume=.01;ulong clockMs=1000;
std::map<string,string> files,fields;
template<class T> int ArraySize(const std::vector<T>& a){return (int)a.size();}
template<class T> void ArrayResize(std::vector<T>& a,int n){a.resize(n);}
ulong GetTickCount64(){return clockMs;}
bool Permissions(){return allowed;}
int PositionsTotal(){return 1;}
ulong PositionGetTicket(int){return 77;}
bool IsOwn(ulong){return owned;}
string PositionGetString(int x){return x==POSITION_COMMENT?"ZC:setup":"XAUUSD";}
long PositionGetInteger(int x){return x==POSITION_TYPE?side:x==POSITION_TIME?openedTime:77;}
double PositionGetDouble(int x){return x==POSITION_SL?oldSl:x==POSITION_PRICE_OPEN?100:x==POSITION_VOLUME?positionVolume:0;}
int StringFind(const string& a,const string& b){auto p=a.find(b);return p==string::npos?-1:(int)p;}
string StringSubstr(const string& a,int n){return a.substr(n);}
void parse(const string& text){fields.clear();std::istringstream stream(text);string line;while(std::getline(stream,line)){auto p=line.find('\t');if(p!=string::npos)fields[line.substr(0,p)]=line.substr(p+1);}}
bool ReadFields(const string& name){if(!files.count(name))return false;parse(files[name]);return true;}
string Get(const string& k){return fields[k];}
double Val(const string& k){return fields.count(k)?std::stod(fields[k]):0;}
string Row(const string& k,const string& v){return k+"\t"+v+"\n";}
bool WriteAtomic(const string& name,const string& text){files[name]=text;return true;}
bool LoadOwnRisk(ulong){return ReadFields("fill-risk-77.tsv")||ReadFields("risk-setup.tsv");}
bool FileIsExist(const string& name,int){auto slash=name.find_last_of("\\");return files.count(name.substr(slash+1));}
bool VolumeValid(const string&,double x){return x>=.01;}
double MathFloor(double x){return std::floor(x);}
bool SymbolInfoTick(const string&,MqlTick& tick){tick.bid=quote;tick.ask=quote;return true;}
long SymbolInfoInteger(const string&,int){return 0;}
double SymbolInfoDouble(const string&,int kind){return kind==SYMBOL_VOLUME_STEP?.01:1;}
double MathMax(double a,double b){return std::max(a,b);}
double MathMin(double a,double b){return std::min(a,b);}
double Price(const string&,double x){return x;}
int partialCount=0;
bool CloseTicket(ulong,double v){if(v<positionVolume){positionVolume-=v;partialCount++;}else closed=true;return true;}
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
  owned=true;closed=false;files.clear();protectionTickets.clear();protectionTryAt.clear();positionVolume=.04;partialCount=0;oldSl=100-sign;
  files["fill-risk-77.tsv"]=Row("version","FILL_PRICE_ATR_V1")+Row("symbol","XAUUSD")+Row("side",sign==1?"BUY":"SELL")+Row("tp1",std::to_string(100+sign*.5))+Row("tp2",std::to_string(100+sign*1.5))+Row("tp3",std::to_string(100+sign*2.5));
  quote=100+sign*.6;clockMs+=1000;ManageLocalStepLock();assert(oldSl==100);assert(partialCount==1);assert(positionVolume==.02);
  quote=100+sign*.8;clockMs+=1000;ManageLocalStepLock();assert(partialCount==1);
  quote=100+sign*1.6;clockMs+=1000;ManageLocalStepLock();assert(oldSl==100+sign*.5);
  quote=100+sign*2.6;clockMs+=1000;ManageLocalStepLock();assert(oldSl==100+sign*1.5);
  positionVolume=.01;
  // Reproduce late fill: Pine TP1/lock was below actual BUY (above SELL).
  files.clear();protectionTickets.clear();protectionTryAt.clear();closed=false;failModify=true;oldSl=100-sign*3.64;
  files["risk-setup.tsv"]=Row("symbol","XAUUSD")+Row("side",sign==1?"BUY":"SELL")+Row("entry",std::to_string(100-sign*1.64))+Row("exitLockVersion","PINE_STEPLOCK_150_TP3_PLUS3_V1")+Row("tp1",std::to_string(100-sign*.14))+Row("tp2",std::to_string(100+sign*.66))+Row("tp3",std::to_string(100+sign*1.86));
  quote=100+sign*.1;closedQuote=quote;clockMs+=1000;ManageLocalStepLock();assert(!closed);assert(oldSl==100-sign*3.64);
  quote=100-sign*.2;clockMs+=1000;ManageLocalStepLock();assert(!closed); // no forced loss from stale Pine lock
  failModify=false;quote=100+sign*.2;clockMs+=1000;ManageLocalStepLock();assert(!closed);assert(oldSl==100); // floor at real fill
  files.clear();protectionTickets.clear();protectionTryAt.clear();closed=false;oldSl=100-sign;
  files["risk-setup.tsv"]=Row("symbol","XAUUSD")+Row("side",sign==1?"BUY":"SELL")+Row("entry","100")+Row("exitLockVersion","PINE_STEPLOCK_150_TP3_PLUS3_V1")+Row("tp1",std::to_string(100+sign*1.5))+Row("tp2",std::to_string(100+sign*2.3))+Row("tp3",std::to_string(100+sign*3.5));
  closedQuote=100+sign;quote=100+sign*3.6;clockMs+=1000;ManageLocalStepLock();assert(oldSl==100-sign); // intrabar TP3 wick does not advance
  closedQuote=100+sign*1.6;quote=100+sign*1.7;clockMs+=1000;ManageLocalStepLock();assert(oldSl==100+sign*1.5);
  quote=100+sign*3.6;clockMs+=1000;ManageLocalStepLock();parse(files["lock-77.tsv"]);assert(Val("stage")==1); // same closed candle still TP1
  closedQuote=100+sign*2.4;quote=100+sign*2.5;clockMs+=1000;ManageLocalStepLock();parse(files["lock-77.tsv"]);assert(Val("stage")==2);
  historyCount=0;closedQuote=100+sign*6.6;quote=closedQuote;clockMs+=1000;ManageLocalStepLock();parse(files["lock-77.tsv"]);assert(Val("stage")==2);historyCount=1;
  openedTime=1000;clockMs+=1000;ManageLocalStepLock();parse(files["lock-77.tsv"]);assert(Val("stage")==2);openedTime=0; // pre-fill candles cannot raise stage
  files.clear();protectionTickets.clear();protectionTryAt.clear();closed=false;failModify=true;oldSl=100-sign;
  files["risk-setup.tsv"]=Row("symbol","XAUUSD")+Row("side",sign==1?"BUY":"SELL")+Row("entry","100")+Row("exitLockVersion","PINE_STEPLOCK_150_TP3_PLUS3_V1")+Row("tp1",std::to_string(100+sign*1.5))+Row("tp2",std::to_string(100+sign*2.3))+Row("tp3",std::to_string(100+sign*3.5));
  closedQuote=100+sign*1.6;quote=100+sign*1.7;clockMs+=1000;ManageLocalStepLock();assert(!closed);
  quote=100+sign*1.4;clockMs+=1000;ManageLocalStepLock();assert(!closed); // intrabar pullback cannot force close
  closedQuote=quote;clockMs+=1000;ManageLocalStepLock();assert(closed);failModify=false; // confirmed breach can close

 }
}
'''
class EaStepLockV2(unittest.TestCase):
 @unittest.skipUnless(shutil.which('g++'),'C++ logic harness compiler unavailable; MetaEditor is separate')
 def test_actual_ea_step_lock_persists_touch_and_respects_owned_positions(self):
  source=(Path(__file__).parent/'ZenCoreExecutor.mq5').read_text();function=source[source.index('ulong protectionTickets[]'):source.index('bool SaveManualConfig()')]
  function=function.replace('MqlRates closedBars[];','std::vector<MqlRates> closedBars;').replace('ulong protectionTickets[],protectionTryAt[];','std::vector<ulong> protectionTickets,protectionTryAt;').replace('(string)PositionGetInteger(POSITION_IDENTIFIER)','std::to_string(PositionGetInteger(POSITION_IDENTIFIER))').replace('(string)stage','std::to_string(stage)')
  with tempfile.TemporaryDirectory() as folder:
   root=Path(folder);(root/'test.cpp').write_text(CPP.replace('__EA_FUNCTION__',function));out=root/('test.exe' if __import__('sys').platform=='win32' else 'test')
   result=subprocess.run(['g++','-std=c++17',str(root/'test.cpp'),'-o',str(out)],capture_output=True,text=True)
   self.assertEqual(result.returncode,0,result.stderr);self.assertEqual(subprocess.run([str(out)],capture_output=True).returncode,0)
