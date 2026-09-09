#property strict
#property version   "1.00"
#property description "ZenCore Web -> MT5 execution bridge. Manual-confirm web orders only."

#include <Trade/Trade.mqh>
CTrade trade;

input string BridgeBaseUrl   = "https://zencore-web-control.onrender.com";
input string BridgeToken     = "PASTE_BRIDGE_TOKEN_HERE";
input int    PollSeconds     = 2;
input bool   AllowLiveTrading= false;
input double MaxVolume       = 1.00;
input ulong  MagicNumber     = 56001;
input int    DeviationPoints = 30;

int heartbeatCounter = 0;

string JsonEscape(string s)
{
   StringReplace(s,"\\","\\\\");
   StringReplace(s,"\"","\\\"");
   StringReplace(s,"\r"," ");
   StringReplace(s,"\n"," ");
   return s;
}

int HttpGet(string url,string &response)
{
   char data[];
   char result[];
   string result_headers;
   string headers = "X-ZenCore-Token: " + BridgeToken + "\r\n";
   ResetLastError();
   int code = WebRequest("GET",url,headers,5000,data,result,result_headers);
   response = CharArrayToString(result,0,-1,CP_UTF8);
   if(code == -1)
      Print("ZenCore GET failed. Error=",GetLastError()," URL=",url);
   return code;
}

int HttpPost(string url,string body,string &response)
{
   char data[];
   char result[];
   string result_headers;
   StringToCharArray(body,data,0,WHOLE_ARRAY,CP_UTF8);
   if(ArraySize(data)>0)
      ArrayResize(data,ArraySize(data)-1);
   string headers = "Content-Type: application/json\r\nX-ZenCore-Token: " + BridgeToken + "\r\n";
   ResetLastError();
   int code = WebRequest("POST",url,headers,5000,data,result,result_headers);
   response = CharArrayToString(result,0,-1,CP_UTF8);
   if(code == -1)
      Print("ZenCore POST failed. Error=",GetLastError()," URL=",url);
   return code;
}

void SendHeartbeat()
{
   string broker = JsonEscape(AccountInfoString(ACCOUNT_COMPANY));
   string server = JsonEscape(AccountInfoString(ACCOUNT_SERVER));
   long login = AccountInfoInteger(ACCOUNT_LOGIN);
   double balance = AccountInfoDouble(ACCOUNT_BALANCE);
   double equity = AccountInfoDouble(ACCOUNT_EQUITY);
   double freeMargin = AccountInfoDouble(ACCOUNT_MARGIN_FREE);
   int positions = PositionsTotal();
   string body = StringFormat("{\"broker\":\"%s\",\"server\":\"%s\",\"login\":\"%I64d\",\"balance\":%.2f,\"equity\":%.2f,\"freeMargin\":%.2f,\"positions\":%d}",broker,server,login,balance,equity,freeMargin,positions);
   string response;
   int code = HttpPost(BridgeBaseUrl + "/api/mt5/heartbeat",body,response);
   if(code>=200 && code<300)
      Print("ZenCore bridge heartbeat OK");
}

double NormalizeVolumeForSymbol(string symbol,double requested)
{
   double minv=SymbolInfoDouble(symbol,SYMBOL_VOLUME_MIN);
   double maxv=SymbolInfoDouble(symbol,SYMBOL_VOLUME_MAX);
   double step=SymbolInfoDouble(symbol,SYMBOL_VOLUME_STEP);
   if(step<=0) step=0.01;
   double v=MathMax(minv,MathMin(MathMin(maxv,MaxVolume),requested));
   v=MathFloor(v/step+0.0000001)*step;
   int digits=2;
   if(step>=1.0) digits=0;
   else if(step>=0.1) digits=1;
   else if(step>=0.01) digits=2;
   else digits=3;
   return NormalizeDouble(v,digits);
}

void ReportResult(string id,string status,string message)
{
   ulong order=trade.ResultOrder();
   ulong deal=trade.ResultDeal();
   uint retcode=trade.ResultRetcode();
   string body = StringFormat("{\"id\":\"%s\",\"status\":\"%s\",\"ticket\":\"%I64u\",\"deal\":\"%I64u\",\"retcode\":\"%u\",\"message\":\"%s\"}",JsonEscape(id),JsonEscape(status),order,deal,retcode,JsonEscape(message));
   string response;
   HttpPost(BridgeBaseUrl + "/api/mt5/result",body,response);
}

void ProcessCommand(string line)
{
   if(line=="" || line=="NONE") return;
   string p[];
   ushort sep=StringGetCharacter("|",0);
   int count=StringSplit(line,sep,p);
   if(count<6)
   {
      Print("ZenCore invalid command: ",line);
      return;
   }

   string id=p[0];
   string side=p[1];
   string symbol=p[2];
   double volume=StringToDouble(p[3]);
   double sl=StringToDouble(p[4]);
   double tp=StringToDouble(p[5]);

   if(!AllowLiveTrading)
   {
      ReportResult(id,"BLOCKED","AllowLiveTrading=false in EA inputs");
      return;
   }
   if(!TerminalInfoInteger(TERMINAL_TRADE_ALLOWED) || !MQLInfoInteger(MQL_TRADE_ALLOWED))
   {
      ReportResult(id,"BLOCKED","MT5 AutoTrading / Algo Trading is disabled");
      return;
   }
   if(volume<=0 || volume>MaxVolume)
   {
      ReportResult(id,"BLOCKED","Volume outside EA safety limit");
      return;
   }
   if(!SymbolSelect(symbol,true))
   {
      ReportResult(id,"REJECTED","SymbolSelect failed");
      return;
   }

   double v=NormalizeVolumeForSymbol(symbol,volume);
   trade.SetExpertMagicNumber(MagicNumber);
   trade.SetDeviationInPoints(DeviationPoints);

   bool ok=false;
   string comment="ZenCore "+id;
   if(side=="BUY")
      ok=trade.Buy(v,symbol,0.0,sl,tp,comment);
   else if(side=="SELL")
      ok=trade.Sell(v,symbol,0.0,sl,tp,comment);
   else
   {
      ReportResult(id,"REJECTED","Unknown side");
      return;
   }

   string msg=trade.ResultRetcodeDescription();
   if(ok)
      ReportResult(id,"FILLED",msg);
   else
      ReportResult(id,"REJECTED",msg);
}

void PollCommand()
{
   string response;
   int code=HttpGet(BridgeBaseUrl + "/api/mt5/next",response);
   if(code==200)
      ProcessCommand(response);
   else if(code==401)
      Print("ZenCore bridge token rejected. Check BridgeToken.");
}

int OnInit()
{
   if(BridgeToken=="" || BridgeToken=="PASTE_BRIDGE_TOKEN_HERE")
   {
      Print("ZenCore MT5 Bridge: set BridgeToken in EA inputs before use.");
      return(INIT_PARAMETERS_INCORRECT);
   }
   EventSetTimer(MathMax(1,PollSeconds));
   SendHeartbeat();
   Print("ZenCore MT5 Bridge started. AllowLiveTrading=",AllowLiveTrading);
   return(INIT_SUCCEEDED);
}

void OnDeinit(const int reason)
{
   EventKillTimer();
}

void OnTimer()
{
   heartbeatCounter++;
   if(heartbeatCounter>=5)
   {
      heartbeatCounter=0;
      SendHeartbeat();
   }
   PollCommand();
}
