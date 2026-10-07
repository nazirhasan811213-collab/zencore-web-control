#property strict
#property version "1.26"
#property description "ZenCore local executor: no WebRequest, DLL or Python API. REAL and DEMO."
#include <Trade/Trade.mqh>
CTrade trade;
const ulong MAGIC=32603231;
const ulong MAGIC15=32601545;
string channel,account,server;
string keys[],values[];
int lockHandle=INVALID_HANDLE;
bool armed=false;
ulong processingStarted=0;
string enabledSymbols="";
string canonical[9]={"XAUUSD","EURUSD","GBPUSD","USDJPY","USDCAD","USDCHF","EURJPY","GBPJPY","EURGBP"};
string brokerSymbols[9];

long UtcMs(){return (long)TimeGMT()*1000;}
string Escape(string s){StringReplace(s,"\t"," ");StringReplace(s,"\r"," ");StringReplace(s,"\n"," ");return s;}
string Row(string k,string v){return k+"\t"+Escape(v)+"\n";}
string Num(double x){return DoubleToString(x,10);}
string Hash(string text){
 uchar data[],empty[],result[];
 StringToCharArray(text,data,0,WHOLE_ARRAY,CP_UTF8);
 ArrayResize(data,ArraySize(data)-1);
 if(CryptEncode(CRYPT_HASH_SHA256,data,empty,result)<=0)return "";
 string out="";for(int i=0;i<ArraySize(result);i++)out+=StringFormat("%02x",result[i]);return out;
}
bool WriteAtomic(string name,string content){
 string tmp=channel+"\\"+name+".tmp",dst=channel+"\\"+name;
 int f=FileOpen(tmp,FILE_WRITE|FILE_TXT|FILE_ANSI|FILE_COMMON,0,CP_UTF8);
 if(f==INVALID_HANDLE)return false;
 FileWriteString(f,content);FileFlush(f);FileClose(f);
 return FileMove(tmp,FILE_COMMON,dst,FILE_COMMON|FILE_REWRITE);
}
bool ReadFields(string name){
 ArrayResize(keys,0);ArrayResize(values,0);
 int f=FileOpen(channel+"\\"+name,FILE_READ|FILE_TXT|FILE_ANSI|FILE_COMMON,0,CP_UTF8);
 if(f==INVALID_HANDLE)return false;
 bool valid=true;
 while(!FileIsEnding(f)){
  string line=FileReadString(f);if(line=="")continue;
  int tab=StringFind(line,"\t");if(tab<1){valid=false;break;}
  string k=StringSubstr(line,0,tab),v=StringSubstr(line,tab+1);
  if(StringLen(v)>4096){valid=false;break;}
  for(int i=0;i<ArraySize(keys);i++)if(keys[i]==k)valid=false;
  if(!valid)break;
  int n=ArraySize(keys);if(n>100){valid=false;break;}
  ArrayResize(keys,n+1);ArrayResize(values,n+1);keys[n]=k;values[n]=v;
 }
 FileClose(f);return valid;
}
string Get(string key){for(int i=0;i<ArraySize(keys);i++)if(keys[i]==key)return values[i];return "";}
double Val(string key){return StringToDouble(Get(key));}
string Broker(string source){for(int i=0;i<9;i++)if(canonical[i]==source)return brokerSymbols[i];return "";}
string Canonical(string symbol){for(int i=0;i<9;i++)if(brokerSymbols[i]==symbol)return canonical[i];return "";}
void MapSymbols(){
 for(int i=0;i<9;i++){
  brokerSymbols[i]="";
  if(SymbolSelect(canonical[i],true)){brokerSymbols[i]=canonical[i];continue;}
  string found="";int count=0;
  for(int j=0;j<SymbolsTotal(false);j++){
   string candidate=SymbolName(j,false),upper=candidate;StringToUpper(upper);
   if(StringFind(upper,canonical[i])==0){found=candidate;count++;}
  }
  if(count==1 && SymbolSelect(found,true))brokerSymbols[i]=found;
 }
}
bool IsOwn(ulong ticket){return PositionSelectByTicket(ticket) && ((ulong)PositionGetInteger(POSITION_MAGIC)==MAGIC || (ulong)PositionGetInteger(POSITION_MAGIC)==MAGIC15);}
string AccountMode(){long mode=AccountInfoInteger(ACCOUNT_TRADE_MODE);return mode==ACCOUNT_TRADE_MODE_DEMO?"DEMO":mode==ACCOUNT_TRADE_MODE_REAL?"REAL":"UNSUPPORTED";}
bool SupportedAccount(){return AccountMode()!="UNSUPPORTED";}
bool AllowedServer(){string s=AccountInfoString(ACCOUNT_SERVER);return s=="InterStellarFinancial-Server" || s=="InterStellarFinancial-Demo";}
bool Permissions(){return AllowedServer() && SupportedAccount() &&
 TerminalInfoInteger(TERMINAL_CONNECTED) && TerminalInfoInteger(TERMINAL_TRADE_ALLOWED) &&
 MQLInfoInteger(MQL_TRADE_ALLOWED) && AccountInfoInteger(ACCOUNT_TRADE_ALLOWED) && AccountInfoInteger(ACCOUNT_TRADE_EXPERT);}
bool BrokerDone(){uint r=trade.ResultRetcode();return r==TRADE_RETCODE_DONE || r==TRADE_RETCODE_DONE_PARTIAL || r==TRADE_RETCODE_NO_CHANGES;}
double Price(string symbol,double value){double tick=SymbolInfoDouble(symbol,SYMBOL_TRADE_TICK_SIZE);if(tick<=0)return 0;return NormalizeDouble(MathRound(value/tick)*tick,(int)SymbolInfoInteger(symbol,SYMBOL_DIGITS));}
bool VolumeValid(string symbol,double value){
 double minv=SymbolInfoDouble(symbol,SYMBOL_VOLUME_MIN),maxv=SymbolInfoDouble(symbol,SYMBOL_VOLUME_MAX),step=SymbolInfoDouble(symbol,SYMBOL_VOLUME_STEP);
 return step>0 && value>=minv-1e-9 && value<=maxv+1e-9 && MathAbs(value/step-MathRound(value/step))<1e-6;
}
void SaveState(){WriteAtomic("state.tsv",Row("armed",armed?"1":"0")+Row("symbols",enabledSymbols));}
bool Heartbeat(){
 bool identity=account==(string)AccountInfoInteger(ACCOUNT_LOGIN) && server==AccountInfoString(ACCOUNT_SERVER);
 string mode=AccountMode();
 string text=Row("writtenAt",(string)UtcMs())+Row("account",(string)AccountInfoInteger(ACCOUNT_LOGIN))+Row("server",AccountInfoString(ACCOUNT_SERVER))+
 Row("accountExecutionVersion","REAL_DEMO_V1")+Row("strategyExecutionVersion","TF2_TF15_V1")+Row("exitPolicyVersion","TF2_TIGHT_SL_3C_V1")+Row("tradeMode",mode)+Row("terminalBuild",(string)TerminalInfoInteger(TERMINAL_BUILD))+
 Row("terminalTradeAllowed",identity && TerminalInfoInteger(TERMINAL_CONNECTED) && TerminalInfoInteger(TERMINAL_TRADE_ALLOWED)?"1":"0")+
 Row("accountTradeAllowed",identity && AccountInfoInteger(ACCOUNT_TRADE_ALLOWED)?"1":"0")+
 Row("expertTradeAllowed",identity && MQLInfoInteger(MQL_TRADE_ALLOWED) && AccountInfoInteger(ACCOUNT_TRADE_EXPERT)?"1":"0");
 int count=0;
 for(int i=0;i<9;i++){
  string symbol=brokerSymbols[i];if(symbol=="")continue;
  string p="s"+(string)count;
  text+=Row(p+"symbol",canonical[i])+Row(p+"tickSize",Num(SymbolInfoDouble(symbol,SYMBOL_TRADE_TICK_SIZE)))+
  Row(p+"tickValue",Num(SymbolInfoDouble(symbol,SYMBOL_TRADE_TICK_VALUE)))+
  Row(p+"volumeMin",Num(SymbolInfoDouble(symbol,SYMBOL_VOLUME_MIN)))+Row(p+"volumeMax",Num(SymbolInfoDouble(symbol,SYMBOL_VOLUME_MAX)))+
  Row(p+"volumeStep",Num(SymbolInfoDouble(symbol,SYMBOL_VOLUME_STEP)));count++;
 }
 text+=Row("specCount",(string)count);count=0;
 for(int i=0;i<PositionsTotal();i++){
  ulong ticket=PositionGetTicket(i);if(!IsOwn(ticket))continue;
  string symbol=PositionGetString(POSITION_SYMBOL),c=Canonical(symbol);if(c=="")continue;
  string p="p"+(string)count;
  text+=Row(p+"strategyMode",(ulong)PositionGetInteger(POSITION_MAGIC)==MAGIC15?"TF15_INTRA":"TF2_SCALPING")+Row(p+"ticket",(string)ticket)+Row(p+"symbol",c)+Row(p+"side",PositionGetInteger(POSITION_TYPE)==POSITION_TYPE_BUY?"BUY":"SELL")+
  Row(p+"volume",Num(PositionGetDouble(POSITION_VOLUME)))+Row(p+"entry",Num(PositionGetDouble(POSITION_PRICE_OPEN)))+
  Row(p+"currentPrice",Num(PositionGetDouble(POSITION_PRICE_CURRENT)))+Row(p+"activeSl",Num(PositionGetDouble(POSITION_SL)))+
  Row(p+"profitUsd",Num(PositionGetDouble(POSITION_PROFIT)))+Row(p+"openedAt",(string)(PositionGetInteger(POSITION_TIME)*1000));count++;
 }
 text+=Row("positionCount",(string)count);return WriteAtomic("heartbeat.tsv",text);
}
bool FreshLease(){
 if(!ReadFields("lease.tsv"))return false;
 return Get("account")==account && Get("server")==server && (long)StringToInteger(Get("expiresAt"))>UtcMs() && Get("desiredState")=="ON";
}
bool CloseTicket(ulong ticket,double volume){
 if(!IsOwn(ticket))return false;
 trade.SetExpertMagicNumber((ulong)PositionGetInteger(POSITION_MAGIC));
 string symbol=PositionGetString(POSITION_SYMBOL);
 double full=PositionGetDouble(POSITION_VOLUME);
 if(volume>=full-1e-8)return trade.PositionClose(ticket) && BrokerDone();
 if(!VolumeValid(symbol,volume) || !VolumeValid(symbol,full-volume))return false;
 trade.SetTypeFillingBySymbol(symbol);
 if(AccountInfoInteger(ACCOUNT_MARGIN_MODE)==ACCOUNT_MARGIN_MODE_RETAIL_HEDGING)
  return trade.PositionClosePartial(ticket,volume) && BrokerDone();
 // Netting: send a reducing deal with the exact position ticket. No concurrent EA may share this symbol.
 MqlTradeRequest req={};MqlTradeResult res={};
 req.action=TRADE_ACTION_DEAL;req.position=ticket;req.symbol=symbol;req.magic=(ulong)PositionGetInteger(POSITION_MAGIC);req.volume=volume;req.deviation=30;
 bool buy=PositionGetInteger(POSITION_TYPE)==POSITION_TYPE_BUY;
 req.type=buy?ORDER_TYPE_SELL:ORDER_TYPE_BUY;req.price=SymbolInfoDouble(symbol,buy?SYMBOL_BID:SYMBOL_ASK);
 long fill=SymbolInfoInteger(symbol,SYMBOL_FILLING_MODE);
 req.type_filling=(fill & SYMBOL_FILLING_FOK)!=0?ORDER_FILLING_FOK:ORDER_FILLING_IOC;
 return OrderSend(req,res) && (res.retcode==TRADE_RETCODE_DONE || res.retcode==TRADE_RETCODE_DONE_PARTIAL);
}
bool CloseGroup(string symbol,int percent,ulong scope=0){
 ulong tickets[];double total=0;
 for(int i=0;i<PositionsTotal();i++){
  ulong t=PositionGetTicket(i);if(!IsOwn(t) || (scope!=0 && (ulong)PositionGetInteger(POSITION_MAGIC)!=scope) || (symbol!="" && PositionGetString(POSITION_SYMBOL)!=symbol))continue;
  if(percent==50 && FileIsExist(channel+"\\half-"+(string)PositionGetInteger(POSITION_IDENTIFIER)+".done",FILE_COMMON))continue;
  int n=ArraySize(tickets);ArrayResize(tickets,n+1);tickets[n]=t;total+=PositionGetDouble(POSITION_VOLUME);
 }
 if(total<=0)return true;
 double remaining=total;
 if(percent==50){
  double step=SymbolInfoDouble(symbol,SYMBOL_VOLUME_STEP),minv=SymbolInfoDouble(symbol,SYMBOL_VOLUME_MIN);
  if(step<=0)return false;
  remaining=MathMin(total-minv,MathCeil((total*0.5-1e-9)/step)*step);
  if(remaining<minv-1e-9)return false;
  // Persist once-only intent before any partial close; interruption must not repeat it.
  for(int i=0;i<ArraySize(tickets);i++){
   if(!IsOwn(tickets[i]))continue;
   if(!WriteAtomic("half-"+(string)PositionGetInteger(POSITION_IDENTIFIER)+".done","intent"))return false;
  }
 }
 for(int i=0;i<ArraySize(tickets) && remaining>1e-8;i++){
  if(!IsOwn(tickets[i]))return false;
  double v=MathMin(remaining,PositionGetDouble(POSITION_VOLUME));
  if(!CloseTicket(tickets[i],v))return false;remaining-=v;
 }
 return remaining<1e-8;
}
bool MoveGroup(string symbol,string kind,double target,ulong scope=0){
 bool ok=true;
 for(int i=0;i<PositionsTotal();i++){
  ulong ticket=PositionGetTicket(i);if(!IsOwn(ticket) || (scope!=0 && (ulong)PositionGetInteger(POSITION_MAGIC)!=scope) || PositionGetString(POSITION_SYMBOL)!=symbol)continue;
  double old=PositionGetDouble(POSITION_SL),sl=Price(symbol,kind=="MOVE_SL_ENTRY"?PositionGetDouble(POSITION_PRICE_OPEN):target);
  bool buy=PositionGetInteger(POSITION_TYPE)==POSITION_TYPE_BUY;
  if(sl<=0){ok=false;continue;}
  if(old>0 && (buy?sl<=old+1e-9:sl>=old-1e-9))continue;
  if(!(trade.PositionModify(ticket,sl,PositionGetDouble(POSITION_TP)) && BrokerDone()))ok=false;
 }
 return ok;
}
bool Entry(string c,string symbol,string side,double lot,int layers,double entry,double sl,double tp1,double tp2,double tp3,string id,bool tightTf2=false,string strategyMode="TF2_SCALPING"){
 if(c!="XAUUSD" && c!="GBPUSD" && c!="GBPJPY")return false;
 if(strategyMode!="TF2_SCALPING" && strategyMode!="TF15_INTRA")return false;
 if(strategyMode=="TF15_INTRA" && tightTf2)return false;
 ulong entryScope=strategyMode=="TF15_INTRA"?MAGIC15:MAGIC;
 trade.SetExpertMagicNumber(entryScope);
 if(!armed || StringFind(","+enabledSymbols+",",","+c+",")<0 || !Permissions() || !FreshLease())return false;
 if(layers<1 || layers>10 || !VolumeValid(symbol,lot) || (side!="BUY" && side!="SELL"))return false;
 bool buy=side=="BUY";
 if(entry<=0 || sl<=0 || !(buy?(sl<entry && entry<tp1 && tp1<tp2 && tp2<tp3):(sl>entry && entry>tp1 && tp1>tp2 && tp2>tp3)))return false;
 // Netting cannot hold separate strategy positions on one symbol.
 if(AccountInfoInteger(ACCOUNT_MARGIN_MODE)!=ACCOUNT_MARGIN_MODE_RETAIL_HEDGING && PositionSelect(symbol))return false;
 for(int i=0;i<PositionsTotal();i++){
  ulong ticket=PositionGetTicket(i);if(IsOwn(ticket) && (ulong)PositionGetInteger(POSITION_MAGIC)==entryScope && PositionGetString(POSITION_SYMBOL)==symbol &&
   (PositionGetInteger(POSITION_TYPE)==POSITION_TYPE_BUY)!=buy)return false;
 }
 // A netting merge or second setup would lose setup-level metadata: refuse rather than close unrelated trades.
 if(true){
  for(int j=0;j<PositionsTotal();j++){ulong existing=PositionGetTicket(j);if(IsOwn(existing) && (ulong)PositionGetInteger(POSITION_MAGIC)==entryScope && PositionGetString(POSITION_SYMBOL)==symbol)return false;}
  sl=entry+(sl-entry)*0.8;
 }
 trade.SetTypeFillingBySymbol(symbol);sl=Price(symbol,sl);
 MqlTick tick;if(!SymbolInfoTick(symbol,tick) || tick.bid<=0 || tick.ask<=0)return false;
 // Refuse a late market entry, even if the quote moved after Analysis dispatched it.
 if(buy?tick.ask>=tp1 || tick.bid<=sl:tick.bid<=tp1 || tick.ask>=sl)return false;
 double distance=SymbolInfoInteger(symbol,SYMBOL_TRADE_STOPS_LEVEL)*SymbolInfoDouble(symbol,SYMBOL_POINT);
 if(buy?sl>=tick.bid-distance:sl<=tick.ask+distance)return false;
 if(tightTf2 && !WriteAtomic("tf2-"+StringSubstr(id,0,20)+".tsv",Row("symbol",symbol)+Row("openedServerAt",(string)TimeCurrent())+Row("tp1",Num(tp1))+Row("side",side)+Row("touched","0")))return false;
 // Store chart targets locally so StepLock survives a TradingView/feed outage.
 if(!WriteAtomic("risk-"+StringSubstr(id,0,20)+".tsv",Row("symbol",symbol)+Row("side",side)+Row("tp1",Num(tp1))+Row("tp2",Num(tp2))+Row("tp3",Num(tp3))))return false;
 for(int i=0;i<layers;i++){
  if(!Permissions() || !FreshLease())return false;
  if(!SymbolInfoTick(symbol,tick) || (buy?tick.ask>=tp1 || tick.bid<=sl:tick.bid<=tp1 || tick.ask>=sl))return false;
  // No TP3 broker close: EXIT-STEPLOCK moves SL at TP3; Analysis owns close decisions.
  bool sent=buy?trade.Buy(lot,symbol,0,sl,0,(strategyMode=="TF15_INTRA"?"ZC15:":"ZC:")+StringSubstr(id,0,20)):trade.Sell(lot,symbol,0,sl,0,(strategyMode=="TF15_INTRA"?"ZC15:":"ZC:")+StringSubstr(id,0,20));
  if(!sent || !BrokerDone() || MathAbs(trade.ResultVolume()-lot)>1e-8)return false;
 }
 return true;
}
// Persistent per-setup policy. Runs during entry pauses and SYSTEM_STOP as well.
void ManageTf2Timeout(){
 if(account!=(string)AccountInfoInteger(ACCOUNT_LOGIN) || server!=AccountInfoString(ACCOUNT_SERVER) || !Permissions())return;
 string processed="|";
 for(int i=PositionsTotal()-1;i>=0;i--){
  ulong ticket=PositionGetTicket(i);if(!IsOwn(ticket))continue;
  string comment=PositionGetString(POSITION_COMMENT),symbol=PositionGetString(POSITION_SYMBOL);
  if(StringFind(comment,"ZC:")!=0)continue;
  string suffix=StringSubstr(comment,3),name="tf2-"+suffix+".tsv";
  if(StringFind(processed,"|"+suffix+"|")>=0)continue;processed+=suffix+"|";
  if(!ReadFields(name) || Get("symbol")!=symbol || Get("touched")=="1")continue;
  datetime opened=(datetime)StringToInteger(Get("openedServerAt"));double target=Val("tp1");string side=Get("side");bool buy=side=="BUY";
  if(opened<=0 || target<=0 || (side!="BUY" && side!="SELL"))continue;
  MqlTick ticks[];
  int n=CopyTicksRange(symbol,ticks,COPY_TICKS_INFO,(ulong)opened*1000,(ulong)TimeCurrent()*1000+999);
  // Without tick history, do not assume TP1 was never touched. Retry after history sync.
  if(n<=0)continue;
  bool touched=false;
  for(int j=0;j<n;j++){double px=buy?ticks[j].bid:ticks[j].ask;if(px>0 && (buy?px>=target:px<=target)){touched=true;break;}}
  if(touched){WriteAtomic(name,Row("symbol",symbol)+Row("openedServerAt",(string)opened)+Row("tp1",Num(target))+Row("side",side)+Row("touched","1"));continue;}
  MqlRates rates[];int count=CopyRates(symbol,PERIOD_M2,opened,TimeCurrent(),rates),complete=0;
  for(int j=0;j<count;j++)if(rates[j].time>=opened && rates[j].time+120<=TimeCurrent())complete++;
  if(complete<3)continue;
  for(int j=PositionsTotal()-1;j>=0;j--){
   ulong own=PositionGetTicket(j);if(!IsOwn(own) || PositionGetString(POSITION_SYMBOL)!=symbol || PositionGetString(POSITION_COMMENT)!=comment)continue;
   if(!CloseTicket(own,PositionGetDouble(POSITION_VOLUME)))Print("ZenCore TF2 timeout: close retry pending.");
  }
 }
}
void Result(string id,string status,string code){
 if(WriteAtomic(id+".result",Row("id",id)+Row("status",status)+Row("code",code)+Row("brokerOrderId",(string)trade.ResultOrder())+Row("eaProcessingMs",(string)(GetTickCount64()-processingStarted))))
  FileDelete(channel+"\\command.tsv",FILE_COMMON);
 Heartbeat();
}
bool ValidId(string id){
 if(StringLen(id)!=36)return false;
 for(int i=0;i<36;i++){
  ushort x=StringGetCharacter(id,i);
  if(i==8 || i==13 || i==18 || i==23){if(x!='-')return false;}
  else if(!((x>='0' && x<='9') || (x>='a' && x<='f')))return false;
 }
 return true;
}
// Broker SL remains installed even when this EA/PC is offline. Local StepLock
// needs a running connected terminal, but never needs a TradingView heartbeat.
void ManageLocalStepLock(){
 if(!Permissions())return;
 for(int i=0;i<PositionsTotal();i++){
  ulong ticket=PositionGetTicket(i);if(!IsOwn(ticket))continue;
  string comment=PositionGetString(POSITION_COMMENT),symbol=PositionGetString(POSITION_SYMBOL);
  int prefix=StringFind(comment,"ZC15:")==0?5:StringFind(comment,"ZC:")==0?3:0;
  if(prefix==0 || !ReadFields("risk-"+StringSubstr(comment,prefix)+".tsv"))continue;
  bool buy=PositionGetInteger(POSITION_TYPE)==POSITION_TYPE_BUY;
  if(Get("symbol")!=symbol || Get("side")!=(buy?"BUY":"SELL"))continue;
  double t1=Val("tp1"),t2=Val("tp2"),t3=Val("tp3"),entry=PositionGetDouble(POSITION_PRICE_OPEN);
  if(t1<=0 || !(buy?t1<t2 && t2<t3:t1>t2 && t2>t3))continue;
  MqlTick tick;if(!SymbolInfoTick(symbol,tick))continue;
  double quote=buy?tick.bid:tick.ask,target=0;
  if(buy?quote>=t3:quote<=t3)target=t2;
  else if(buy?quote>=t2:quote<=t2)target=t1;
  else if(buy?quote>=t1:quote<=t1)target=entry;
  if(target<=0)continue;
  double old=PositionGetDouble(POSITION_SL),sl=Price(symbol,target);
  if(sl<=0 || (old>0 && (buy?sl<=old:sl>=old)))continue;
  double distance=MathMax(SymbolInfoInteger(symbol,SYMBOL_TRADE_STOPS_LEVEL),SymbolInfoInteger(symbol,SYMBOL_TRADE_FREEZE_LEVEL))*SymbolInfoDouble(symbol,SYMBOL_POINT);
  if(buy?sl>=tick.bid-distance:sl<=tick.ask+distance)continue;
  if(!trade.PositionModify(ticket,sl,PositionGetDouble(POSITION_TP)) || !BrokerDone())Print("ZenCore local StepLock pending ticket=",ticket," retcode=",trade.ResultRetcode());
 }
}
void Process(){
 if(!FileIsExist(channel+"\\command.tsv",FILE_COMMON))return;
 if(!ReadFields("command.tsv")){armed=false;return;}
 processingStarted=GetTickCount64();
 string id=Get("id"),type=Get("type"),c=Get("symbol"),symbol=Broker(c);
 string strategyMode=Get("strategyMode");if(strategyMode=="")strategyMode="TF2_SCALPING";
 ulong scope=strategyMode=="TF15_INTRA"?MAGIC15:MAGIC;
 string side=Get("side"),symbols=Get("symbols");
 bool tightTf2=Get("exitPolicyVersion")=="TF2_TIGHT_SL_3C_V1";
 double lot=Val("lot"),entry=Val("entry"),sl=Val("sl"),tp1=Val("tp1"),tp2=Val("tp2"),tp3=Val("tp3");
 int layers=(int)StringToInteger(Get("layers")),actions=(int)StringToInteger(Get("actions"));
 string actionType[4];double actionValue[4];
 for(int i=0;i<4;i++){actionType[i]=Get("a"+(string)i+"type");actionValue[i]=Val("a"+(string)i+"value");}
 if(!ValidId(id)){armed=false;return;}
 if(Get("protocol")!="1" || Get("account")!=account || Get("server")!=server ||
 account!=(string)AccountInfoInteger(ACCOUNT_LOGIN) || server!=AccountInfoString(ACCOUNT_SERVER) ||
 !SupportedAccount() || Get("tradeMode")!=AccountMode()){armed=false;Result(id,"REJECTED","ACCOUNT_OR_PROTOCOL_REJECTED");return;}
 if((long)StringToInteger(Get("expiresAt"))<=UtcMs()){Result(id,"REJECTED","COMMAND_EXPIRED");return;}
 if(FileIsExist(channel+"\\"+id+".started",FILE_COMMON)){
  // Existing result is authoritative. Never overwrite it or execute a replay.
  if(!FileIsExist(channel+"\\"+id+".result",FILE_COMMON))Result(id,"REJECTED","REPLAY_OR_INTERRUPTED");
  else FileDelete(channel+"\\command.tsv",FILE_COMMON);
  return;
 }
 if(!WriteAtomic(id+".started","intent")){armed=false;return;}
 bool ok=false;string code="BROKER_REJECTED";
 if(type=="SYSTEM_STOP"){armed=false;SaveState();ok=true;code="STOPPED";}
 else if(type=="SYSTEM_ON"){
  ok=Permissions() && layers>=1 && layers<=10 && lot>0 && symbols!="";
  if(ok){armed=true;enabledSymbols=symbols;code="ARMED";}else{armed=false;code="ALGO_OR_ACCOUNT_NOT_READY";}
  SaveState();
 }
 else if(type=="PLACE_SETUP"){
  if(symbol!="")ok=Entry(c,symbol,side,lot,layers,entry,sl,tp1,tp2,tp3,id,tightTf2,strategyMode);
  code=ok?"SETUP_OPENED":"ENTRY_REJECTED_OR_PARTIAL";
 }
 else if(type=="EMERGENCY_CLOSE_ALL"){armed=false;SaveState();ok=Permissions() && CloseGroup("",100);code=ok?"CLOSED_ALL":"CLOSE_FAILED";}
 else if(type=="MANAGE_POSITION" && symbol!="" && actions>=1 && actions<=4 && Permissions()){
  ok=true;
  for(int i=0;i<actions;i++){
   bool done=false;
   if(actionType[i]=="CLOSE_PERCENT" && (actionValue[i]==50 || actionValue[i]==100))done=CloseGroup(symbol,(int)actionValue[i],scope);
   else if(actionType[i]=="MOVE_SL_ENTRY" || actionType[i]=="MOVE_SL_TP1" || actionType[i]=="MOVE_SL_TP2")done=MoveGroup(symbol,actionType[i],actionValue[i],scope);
   if(!done)ok=false;
  }
  code=ok?"MANAGED":"MANAGEMENT_FAILED";
 }
 Result(id,ok?"EXECUTED":"FAILED",code);
}
int OnInit(){
 account=(string)AccountInfoInteger(ACCOUNT_LOGIN);server=AccountInfoString(ACCOUNT_SERVER);
 if(!AllowedServer()){Print("ZenCore: SERVER_NOT_ALLOWED. Use InterStellarFinancial-Server or InterStellarFinancial-Demo.");return INIT_FAILED;}
 if(!SupportedAccount()){Print("ZenCore: unsupported account mode.");return INIT_FAILED;}
 ResetLastError();
 string digest=Hash(server);if(digest==""){Print("ZenCore: INIT_HASH_FAILED error=",GetLastError());return INIT_FAILED;}
 channel="ZenCore\\"+account+"-"+StringSubstr(digest,0,16);
 FolderCreate("ZenCore",FILE_COMMON);
 ResetLastError();
 if(!FolderCreate(channel,FILE_COMMON)){Print("ZenCore: INIT_FOLDER_FAILED error=",GetLastError());return INIT_FAILED;}
 ResetLastError();
 lockHandle=FileOpen(channel+"\\ea.lock",FILE_WRITE|FILE_BIN|FILE_COMMON);
 if(lockHandle==INVALID_HANDLE){Print("ZenCore: INIT_LOCK_FAILED error=",GetLastError(),". Another EA/terminal may hold the account lock, or Common Files is not writable.");return INIT_FAILED;}
 trade.SetExpertMagicNumber(MAGIC);trade.SetDeviationInPoints(30);trade.SetAsyncMode(false);
 MapSymbols();
 if(ReadFields("state.tsv")){armed=Get("armed")=="1";enabledSymbols=Get("symbols");}
 ResetLastError();if(!Heartbeat()){Print("ZenCore: INIT_HEARTBEAT_FAILED error=",GetLastError());return INIT_FAILED;}
 ResetLastError();if(!EventSetMillisecondTimer(250)){Print("ZenCore: INIT_TIMER_FAILED error=",GetLastError());return INIT_FAILED;}
 Print("ZenCore: EA_READY version=1.26 mode=",AccountMode());return INIT_SUCCEEDED;
}
void OnTimer(){
 static ulong lastManagement=0,lastHeartbeat=0;
 ulong now=GetTickCount64();
 // Process commands every 250ms; costly position/tick-history scans stay bounded.
 if(now-lastManagement>=1000){ManageLocalStepLock();ManageTf2Timeout();lastManagement=now;}
 Process();
 if(now-lastHeartbeat>=2000){Heartbeat();lastHeartbeat=now;}
 Comment("ZenCore 1.26 • ",AccountMode()," • ",armed?"ARMED":"STOPPED","\nSetting dan ON/OFF melalui web ZenCore.");
}
void OnDeinit(const int reason){armed=false;EventKillTimer();if(lockHandle!=INVALID_HANDLE){FileDelete(channel+"\\heartbeat.tsv",FILE_COMMON);FileClose(lockHandle);lockHandle=INVALID_HANDLE;}Comment("");}
