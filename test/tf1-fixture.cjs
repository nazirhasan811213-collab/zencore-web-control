'use strict';
const S=require('../tf2-ribbon-scalping');
let seq=0;
function fixture(symbol='XAUUSD',side='BUY',tf='1'){
 const now=Date.now()+ ++seq,sign=side==='BUY'?1:-1,entry=symbol==='BTCUSD'?64000:4000,dist=symbol==='BTCUSD'?150:1.5;
 const row=Array(67).fill(null),time=now-Number(tf)*60000;
 Object.assign(row,{0:symbol,1:time,2:1,3:entry-sign*.5,4:entry+1,5:entry-1,6:entry,7:entry,8:entry,9:entry,10:entry+sign,11:entry,12:entry-sign,13:sign*2,14:sign,15:50,16:35,17:1.2,18:sign,19:80,20:4,21:4,22:entry,23:entry-sign*(symbol==='BTCUSD'?300:4),24:entry-sign*4,25:entry+sign*dist,26:entry+sign*(symbol==='BTCUSD'?250:2.5),27:entry+sign*(symbol==='BTCUSD'?400:3.5),28:true,29:side==='BUY',34:side,35:true,36:true,37:true,38:true,39:true,40:true,41:true,42:side==='BUY'?'BULLISH':'BEARISH',43:60,48:'HOLD',49:'HOLD',52:100,56:0,57:'INITIAL',58:'NONE',59:false});
 row[65]={version:tf==='1'?'HEMA1_LIVE_V1':'HEMA15_LIVE_V1',['tf'+tf]:{fast:entry+sign,slow:entry,fastPreviousBar:entry,slowPreviousBar:entry-sign}};
 row[66]={entryRuleVersion:tf==='1'?S.RULE:'TF15_SOLID_RIBBON_V1',entryPolicyVersion:'PINE_NATIVE_SOLID_ENTRY_V7',planMode:'Fixed R:R',riskPlanVersion:S.RISK8_CAPS4,atrPeriod:8,solidSide:side,solidHoldActive:true,solidClosedAt:null,solidTriggeredAt:time,setupAt:time,sourceEntry:entry-sign,solidEligible:true,completedAt:now,completionPrice:entry,riskAtrReference:4,riskTick:.01,entryEvent:true,entryAuthorizedAt:now,cycleKind:'INITIAL',lifecycleVersion:'CLOSED_PAUSE_RESUME_V2',decisionTimingVersion:'TF1_BAR_CLOSE_V1',decisionBarCloseAt:now,entryCandleVersion:'TF1_NATIVE_CANDLE_DIRECTION_V1',nativeSolid:{version:'NATIVE_SOLID_LABEL_V1',barTime:time,pulse:true,basis:entry-sign,rsi:50},dashboardAi:{momentum:side==='BUY'?'Bullish':'Bearish',mtfScore:sign}};
 return {row,now,batch:{feedVersion:tf==='1'?'TF1_REALTIME_V1':'TF15_REALTIME_V1',timeframe:tf,schemaVersion:'32.3-EXIT-STEPLOCK',feedUpdateVersion:'SPLIT_CHANNEL_BOOTSTRAP_V2',feedChannel:'EXECUTION',confirmed:true,emittedAt:now,markets:[row]}};
}

module.exports={fixture};
