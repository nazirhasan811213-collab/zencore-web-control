'use strict';
const {evaluateEntrySop}=require('../../normal-entry-sop');
function readyMarket({tf='2',side='BUY',at=Date.now(),symbol='XAUUSD',plan}={}){
 const sign=side==='BUY'?1:-1;
 plan ||= {entry:100,sl:100-sign,tp1:100+sign,tp2:100+sign*2,tp3:100+sign*3};
 const ribbon=side==='BUY'?{fast:102,slow:101}:{fast:98,slow:99},higher=tf==='15'?'30':'3';
 const x=evaluateEntrySop({timeframe:tf,normal3Side:side,normal3Entry:plan.entry,normal3Close:plan.entry+sign*.01,normal3Atr:1,normal3Solid:true,normal3PricePastEntry:true,normal3Sop1:true,normal3Sop2:true,normal3Sop3:true,normal3Sop4:true,normal3Forecast:side==='BUY'?'BULLISH':'BEARISH',normal3MarketPower:80,hemaConfirmation:{version:tf==='15'?'HEMA1530_V1':'HEMA23_LIVE_V1',['tf'+tf]:ribbon,['tf'+higher]:ribbon}},tf);
 return {symbol,timeframe:tf,price:plan.entry+sign*.01,receivedAt:at,signalObservedAt:at,feedMode:'INTRABAR',predictionConfidence:85,stability:80,confluence:4,setupProbability:75,strategyNormal:{state:'READY',side,tf:tf+'m',solid:true,entrySopVersion:x.version,sop:{gates:x.gates,sopGreen:x.green,forecast:x.forecast,marketPower:x.power,['hema'+tf]:x['hema'+tf],['hema'+higher]:x['hema'+higher]},plan}};
}
module.exports={readyMarket};
