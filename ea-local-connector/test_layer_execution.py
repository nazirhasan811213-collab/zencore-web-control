"""Exercise the production Entry function with simulated MT5 quotes, fills and positions."""
import pathlib
import shutil
import subprocess
import tempfile
import unittest


class LayerExecution(unittest.TestCase):
    def test_entry_orders_and_fill_protection(self):
        compiler = shutil.which('g++')
        if not compiler:
            self.skipTest('g++ unavailable')
        source = pathlib.Path(__file__).with_name('ZenCoreExecutor.mq5').read_text()
        start = source.index('bool Tf2EntryPriceAllowed')
        end = source.index('\n}', source.index('\n return true;', source.index('bool Entry(', start))) + 2
        entry = source[start:end].replace('(string)identifier', 'std::to_string(identifier)').replace('(string)TimeCurrent()', 'std::to_string(TimeCurrent())')
        mock = r'''
#include <algorithm>
#include <cassert>
#include <cmath>
#include <string>
#include <vector>
using std::string;
using ulong = unsigned long;
using uint = unsigned int;
#define MathAbs std::abs
#define MathIsValidNumber std::isfinite
#define MathCeil std::ceil
#define MathFloor std::floor
#define MathMin std::min
enum {ACCOUNT_MARGIN_MODE, ACCOUNT_MARGIN_MODE_RETAIL_HEDGING,
      POSITION_MAGIC, POSITION_IDENTIFIER, POSITION_TYPE, POSITION_TYPE_BUY,
      POSITION_SYMBOL, POSITION_PRICE_OPEN, POSITION_SL, POSITION_VOLUME,
      SYMBOL_TRADE_TICK_SIZE, SYMBOL_TRADE_STOPS_LEVEL, SYMBOL_POINT,
      DEAL_POSITION_ID, DEAL_PRICE, TRADE_RETCODE_REQUOTE,
      TRADE_RETCODE_PRICE_CHANGED, TRADE_RETCODE_PRICE_OFF,
      TRADE_RETCODE_TOO_MANY_REQUESTS, TRADE_RETCODE_TIMEOUT};
const ulong MAGIC=100, MAGIC15=150;
bool armed=true, netting=false, slip=false;
string enabledSymbols="XAUUSD", ownerPod="pod", lastEntryCode, brokerSymbols[9], _Symbol="GOLD.pro";
int calls=0, selected=-1, rejectAt=-1, partialAt=-1;
double quoteOffset=0;
ulong now=0, lastPulse=0, longestPulseGap=0, brokerDelay=0;
int missingQuotes=0, sends=0, transientAt=-1;
int leaseStopsAt=-1;
uint errorCode=TRADE_RETCODE_REQUOTE;
bool hasOrder=false, moveQuoteAfterReject=false;
int transientCount=1;
ulong GetTickCount64(){return now;}
bool IsStopped(){return false;}
void Sleep(int ms){now+=ms;}
bool Heartbeat(){longestPulseGap=std::max(longestPulseGap,now-lastPulse);lastPulse=now;return true;}
double lastDeal=0;
string lastRisk;
struct Position { long id; ulong magic; bool buy; double volume, entry, sl; };
std::vector<Position> positions;
bool RejectEntry(string code){lastEntryCode=code;return false;}
int StringFind(string s,string q){return s.find(q)==string::npos?-1:int(s.find(q));}
string StringSubstr(string s,int p,int n){return s.substr(p,n);}
bool Permissions(){return true;}
string PermissionReason(){return "READY";}
string LeaseReason(string){return leaseStopsAt>=0 && sends>=leaseStopsAt?"LEASE_STOPPED":"READY";}
bool VolumeValid(string,double){return true;}
int AccountInfoInteger(int){return netting?0:ACCOUNT_MARGIN_MODE_RETAIL_HEDGING;}
int PositionsTotal(){return int(positions.size());}
ulong PositionGetTicket(int i){selected=i;return i+1;}
bool PositionSelect(string){selected=positions.empty()?-1:0;return selected>=0;}
long PositionGetInteger(int key){
 const auto &p=positions.at(selected);
 if(key==POSITION_IDENTIFIER)return p.id;
 if(key==POSITION_MAGIC)return p.magic;
 return p.buy?POSITION_TYPE_BUY:-1;
}
string PositionGetString(int){return _Symbol;}
double PositionGetDouble(int key){
 const auto &p=positions.at(selected);
 return key==POSITION_PRICE_OPEN?p.entry:key==POSITION_SL?p.sl:p.volume;
}
bool IsOwn(ulong ticket){
 selected=int(ticket)-1;
 auto m=positions.at(selected).magic;
 return m==MAGIC||m==MAGIC15;
}
double SymbolInfoDouble(string,int){return .01;}
long SymbolInfoInteger(string,int){return 0;}
double Price(string,double p){return std::round(p*100)/100;}
struct MqlTick{double bid,ask;};
bool SymbolInfoTick(string,MqlTick &q){if(missingQuotes-->0)return false;q={4000+quoteOffset,4000.10+quoteOffset};return true;}
bool BrokerDone(){return true;}
long TimeCurrent(){return 1;}
string Num(double n){return std::to_string(n);}
string Row(string key,string val){return key+"="+val+"\n";}
bool WriteAtomic(string name,string data){lastRisk=data;return true;}
bool HistoryDealSelect(ulong){return true;}
long HistoryDealGetInteger(ulong,int){return positions.back().id;}
double HistoryDealGetDouble(ulong,int){return lastDeal;}
bool CloseTicket(ulong ticket,double volume){positions.at(ticket-1).volume-=volume;return true;}
void Print(string,ulong){}
struct Trade{
 ulong magic=0;
 double volume=0;
 uint retcode=0;
 ulong deal=0, order=0;
 void SetExpertMagicNumber(ulong m){magic=m;}
 void SetTypeFillingBySymbol(string){}
 bool Send(bool buy,double v,double sl){
  assert(std::abs(v-.01)<1e-8);
  now+=brokerDelay;
  ++sends; retcode=0; deal=0; order=0; volume=0;
  if(transientAt>0 && sends>=transientAt && sends<transientAt+transientCount){
   retcode=errorCode;order=hasOrder?1:0;
   if(moveQuoteAfterReject)quoteOffset=4;
   return false;
  }
  if(calls==rejectAt){++calls;volume=0;return false;}
  if(calls==partialAt)v*=.5;
  lastDeal=4000+(buy?1:-1)*(.11+calls*.01);
  if(slip&&calls==2)lastDeal=4004.01;
  ++calls;volume=v;deal=calls;
  if(netting&&!positions.empty()){
   auto &p=positions.back();
   p.entry=(p.entry*p.volume+lastDeal*v)/(p.volume+v);
   p.volume+=v;p.sl=sl;
  }else positions.push_back({calls,magic,buy,v,lastDeal,sl});
  return true;
 }
 bool Buy(double v,string symbol,double,double sl,double,string){assert(symbol==_Symbol);return Send(true,v,sl);}
 bool Sell(double v,string symbol,double,double sl,double,string){assert(symbol==_Symbol);return Send(false,v,sl);}
 double ResultVolume(){return volume;}
 double ResultPrice(){return lastDeal;}
 ulong ResultDeal(){return deal;}
 ulong ResultOrder(){return order;}
 uint ResultRetcode(){return retcode;}
 bool PositionModify(ulong t,double sl,double){positions.at(t-1).sl=sl;return true;}
} trade;
'''
        checks = r'''
bool Run(bool buy,int layers,string symbol="XAUUSD"){
 int sign=buy?1:-1;
 return Entry("XAUUSD",symbol,buy?"BUY":"SELL",.01,layers,4000,
  4000-sign*2,4000+sign,4000+sign*2,4000+sign*3,"setup",false,
  "TF2_SCALPING",false,0,"MT5_FILL_STEPLOCK","2",true);
}
int main(){
 for(bool merged:{false,true})for(bool buy:{false,true})for(int layers:{12,50,75}){
  netting=merged;calls=0;positions.clear();
  assert(Run(buy,layers));
  assert(calls==layers);
  assert(PositionsTotal()==(merged?1:layers));
  double sum=0;
  for(const auto &p:positions){
   sum+=p.volume;
   assert(std::abs(p.sl-ExecutionStop(buy,p.entry,2,.01))<1e-8);
  }
  assert(std::abs(sum-layers*.01)<1e-8);
  assert(lastRisk.find("tp1="+Num(Price("XAUUSD",positions.back().entry+(buy?1:-1))))!=string::npos);
 }
 netting=true;calls=0;positions={{99,0,true,.10,4000,3998}};
 assert(!Run(true,12)&&calls==0&&lastEntryCode=="NETTING_POSITION_CONFLICT");
 positions.clear();slip=true;
 assert(!Run(true,12)&&calls==3&&lastEntryCode=="FILL_PINE_ENTRY_GAP_4USD");
 assert(std::abs(positions[0].volume-.02)<1e-8);
 slip=false;calls=0;positions.clear();quoteOffset=4;
 assert(!Run(true,12)&&calls==0&&lastEntryCode=="PINE_ENTRY_GAP_4USD");
 quoteOffset=0;rejectAt=3;
 assert(!Run(true,12)&&calls==4&&lastEntryCode=="SETUP_PARTIAL");
 assert(std::abs(positions[0].volume-.03)<1e-8);
 rejectAt=-1;partialAt=2;calls=0;positions.clear();
 assert(!Run(true,12)&&calls==3&&lastEntryCode=="SETUP_PARTIAL");
 assert(std::abs(positions[0].volume-.025)<1e-8);
 assert(std::abs(positions[0].sl-ExecutionStop(true,positions[0].entry,2,.01))<1e-8);
 partialAt=-1;calls=0;sends=0;positions.clear();missingQuotes=20;
 enabledSymbols="EURUSD"; // Direct orders use the chart, regardless of cached EA symbol settings.
 assert(Run(true,12,"")&&calls==12&&sends==12);
 for(uint reason:{TRADE_RETCODE_REQUOTE,TRADE_RETCODE_PRICE_CHANGED,TRADE_RETCODE_PRICE_OFF,TRADE_RETCODE_TOO_MANY_REQUESTS}){
  calls=0;sends=0;positions.clear();transientAt=4;errorCode=reason;
  assert(Run(true,12)&&calls==12&&sends==13);
  assert(std::abs(positions[0].volume-.12)<1e-8);
 }
 calls=0;sends=0;positions.clear();transientAt=4;errorCode=TRADE_RETCODE_TIMEOUT;
 assert(!Run(true,12)&&calls==3&&sends==4);
 calls=0;sends=0;positions.clear();errorCode=TRADE_RETCODE_REQUOTE;hasOrder=true;
 assert(!Run(true,12)&&calls==3&&sends==4);
 calls=0;sends=0;positions.clear();hasOrder=false;leaseStopsAt=4;
 assert(!Run(true,12)&&calls==3&&sends==4);
 calls=0;sends=0;positions.clear();leaseStopsAt=-1;moveQuoteAfterReject=true;
 assert(!Run(true,12)&&calls==3&&sends==4&&lastEntryCode=="PARTIAL_PINE_ENTRY_GAP_4USD");
 calls=0;sends=0;positions.clear();moveQuoteAfterReject=false;quoteOffset=0;transientCount=5;
 assert(!Run(true,12)&&calls==3&&sends==6&&lastEntryCode=="SETUP_PARTIAL");
 calls=0;sends=0;positions.clear();transientAt=-1;
 brokerDelay=900;now=0;lastPulse=0;longestPulseGap=0;
 assert(Run(false,75)&&now==67500&&longestPulseGap<=2700&&now-lastPulse<2000);
 calls=0;sends=0;positions.clear();missingQuotes=99;
 const ulong quoteWaitStarted=now;
 assert(!Run(true,12)&&sends==0&&lastEntryCode=="QUOTE_NOT_READY");
 assert(now-quoteWaitStarted==4000);
 assert(brokerSymbols[0]==_Symbol);
}
'''
        with tempfile.TemporaryDirectory() as folder:
            cpp = pathlib.Path(folder) / 'entry.cpp'
            binary = cpp.with_suffix('')
            cpp.write_text(mock + entry + checks)
            result = subprocess.run([compiler, '-std=c++17', str(cpp), '-o', str(binary)],
                                    capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            subprocess.run([str(binary)], check=True, cwd=folder)
