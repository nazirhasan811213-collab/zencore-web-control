'use strict';
const {test}=require('node:test'),a=require('node:assert/strict'),S=require('../tf2-ribbon-scalping'),C=require('../analysis-execution-contract'),Core=require('../auto-trade-core');let seq=0;
function fixture(side='BUY'){
 const now=Date.now()+ ++seq,sign=side==='BUY'?1:-1,row=Array(67).fill(null),t=now-180000;
 Object.assign(row,{0:'XAUUSD',1:t,6:4100,13:sign*2,14:sign,16:35,21:4,22:4100,23:4100-sign*3,24:4100-sign*3,25:4100+sign*4,26:4100+sign*8,27:4100+sign*12,28:true,29:side==='BUY',34:side,35:true,36:true,37:true,38:true,39:true,40:true,41:true,42:side==='BUY'?'BULLISH':'BEARISH',43:60,48:'HOLD',49:'HOLD',52:100,56:0,57:'INITIAL',58:'NONE',59:false});
 row[65]={version:'HEMA2_LIVE_V1',tf2:{fast:4100+sign,slow:4100,fastPreviousBar:4100,slowPreviousBar:4100-sign}};
 row[66]={entryRuleVersion:S.RULE,exitLockVersion:S.POLICY.exitLockVersion,entryPolicyVersion:S.POLICY.entryPolicyVersion,planMode:"Fixed R:R",riskPlanVersion:S.RISK,atrPeriod:10,solidSide:side,solidHoldActive:true,solidClosedAt:null,solidTriggeredAt:t,setupAt:t,sourceEntry:4100-sign,solidEligible:true,completedAt:now,completionPrice:4100,riskAtrReference:4,riskStructure:4100-sign*2,riskTick:.01,entryEvent:true,entryAuthorizedAt:now,dashboardAi:{momentum:side==='BUY'?'Bullish 🟢':'Bearish 🔴',mtfScore:sign,dashboard:{mtfTimeframes:['3','5','10']}}};
 return {row,now,batch:{feedVersion:'TF2_REALTIME_V1',timeframe:'2',schemaVersion:'32.3-EXIT-STEPLOCK',feedUpdateVersion:'SPLIT_CHANNEL_BOOTSTRAP_V2',feedChannel:'EXECUTION',confirmed:false,emittedAt:now,markets:[row]}};
}
function current(side='BUY',aligned=true,direction=side){
 const f=fixture(side);f.row[1]=f.now-120000;f.row[3]=direction==='BUY'?4099.5:direction==='SELL'?4100.5:4100;f.row[4]=4101;f.row[5]=4099;f.row[40]=aligned;f.batch.confirmed=true;
 Object.assign(f.row[66],{entryPolicyVersion:S.SOLID_POLICY,entryCandleVersion:S.CANDLE_VERSION,decisionTimingVersion:'TF2_BAR_CLOSE_V1',decisionBarCloseAt:f.now});return f;
}
function ingest(f){delete require.cache[require.resolve('../tf2-ribbon-market-hub')];return require('../tf2-ribbon-market-hub').ingest(f.batch,f.now)[0];}
for(const [side,label,aligned,direction] of [
 ['BUY','yellow red outline',false,'SELL'],['BUY','red body',false,'SELL'],['BUY','green red outline',true,'SELL'],['BUY','yellow green outline',false,'BUY'],['BUY','red green outline',false,'BUY'],
 ['SELL','yellow green outline',false,'BUY'],['SELL','green body',false,'BUY'],['SELL','red green outline',true,'BUY'],['SELL','yellow red outline',false,'SELL'],['SELL','green red outline',false,'SELL'],
 ['BUY','doji',true,'DOJI'],['SELL','doji',true,'DOJI']])test(side+' holds '+label+' despite SOLID and enough checklist votes',()=>{
 const f=current(side,aligned,direction),m=ingest(f);a.ok(m.strategyNormal.sop.passed>=3);a.equal(m.strategyNormal.sop.sopGreen>=4,true);a.equal(m.strategyNormal.solid,true);a.equal(m.strategyNormal.state,'WAIT');a.match(m.strategyNormal.reason,/HOLD/);
 a.equal(C.createEntryDecision({...m,strategyNormal:{...m.strategyNormal,state:'READY'}},f.now),null);a.equal(Core.buildSetupCommand(m,{capitalUsd:200,lotPerLayer:.01,layers:2,symbols:['XAUUSD'],strategyMode:'TF2_SCALPING'},null,f.now),null);
});
for(const side of ['BUY','SELL'])test(side+' matched native body and OHLC close authorizes normal SOP and Telegram',async()=>{
 const f=current(side),m=ingest(f),d=C.createEntryDecision(m,f.now);a.ok(d);a.ok(d.snapshot.confirmationEvidence.entryCandle);a.equal(m.strategyNormal.state,'READY');
 const {AnalysisAlerts}=require('../analysis-alert-service'),alerts=new AnalysisAlerts();await alerts.init();try{
  await alerts.record(m);const e=alerts.events.find(e=>e.kind==='ENTRY');a.ok(e);a.equal(require('../analysis-telegram').entrySopAllowed(e),true);a.match(require('../analysis-telegram').telegramMessage(e),/Candle entry: (BULLISH|BEARISH)/);
  a.equal(require('../analysis-telegram').entrySopAllowed({...e,telegramSop:{...e.telegramSop,entryCandle:{...e.telegramSop.entryCandle,indicatorAligned:false}}}),false);
 }finally{clearInterval(alerts.cleanupTimer);}
 const changed={...m,open:side==='BUY'?4100.5:4099.5};a.equal(C.createEntryDecision(changed,f.now),null);
 const delivery=require('../entry-delivery-check').checkEntryDelivery({payload:{side,analysisSnapshot:d.snapshot}},changed,f.now);a.equal(delivery.reason,'TF2_HOLD_CANDLE_DIRECTION');
});
test('intrabar, unknown version, missing OHLC and stale candle proof hold without blocking native exits',()=>{
 for(const change of ['intrabar','version','ohlc']){const f=current();if(change==='intrabar')f.batch.confirmed=false;if(change==='version')f.row[66].entryCandleVersion='UNKNOWN';if(change==='ohlc')f.row[3]=null;a.equal(ingest(f).strategyNormal.state,'WAIT');}
 const f=current('BUY',false,'SELL');Object.assign(f.row,{48:'CLOSED',49:'EXIT_ALL',52:0});f.row[66].nativeExitAll=true;const exit=ingest(f);a.equal(exit.strategyNormal.state,'WAIT');a.equal(exit.nativeChartExitAll,true);a.equal(exit.positionManagement.action,'EXIT_ALL');
 const good=ingest(current());a.equal(S.candlePass({...good.strategyNormal.sop.entryCandle,observedAt:good.signalObservedAt+60001},'BUY',good.sourceBarTime),false);
});
test('Pine waits before qualification and applies the same mandatory candle gate to initial, re-entry and ready',()=>{
 const text=require('node:fs').readFileSync('ZenCore_TF2_ATR8_TP1Max3.pine','utf8');a.match(text,/zc_seq_s4 and \(zc24_buy \? close > open : close < open\)/);
 for(const line of text.split('\n').filter(l=>/^(bool zc_followup =|bool zc_hold_qualify =|bool zc24_ready =|zc24_ready :=)/.test(l)))a.match(line,/zc_entry_candle_pass/);
 const expr=text.match(/bool zc_hold_qualify = (.*)/)[1].replace(/\band\b/g,'&&').replace(/\bor\b/g,'||');
 const base={zs_pass:true,zc_entry_candle_pass:false,barstate:{isconfirmed:true},draft_plan_ok:true,zc_hold_active:true,zc_seq_completed:null,zc24_tf2:true,zc80_data:true,zc80_passed:4,zc24_greens:5,na:x=>x==null};
 const run=changes=>{const x={...base,...changes};return Function(...Object.keys(x),'return '+expr)(...Object.values(x));};a.equal(run({}),false);a.equal(run({zc_entry_candle_pass:true}),true);
 a.match(text,/entryCandleVersion/);a.match(text,/HOLD BUY - TUNGGU CANDLE BULLISH/);a.match(text,/HOLD SELL - TUNGGU CANDLE BEARISH/);
});
test('legacy source remains compatible until Pine update; TF15 source is untouched',()=>{
 const f=current();delete f.row[66].entryCandleVersion;f.row[3]=4100.5;const m=ingest(f);a.ok(C.createEntryDecision(m,f.now));
 const fs=require('node:fs');a.doesNotMatch(fs.readFileSync('ZenCore_TF15_Intraday.pine','utf8'),/TF2_NATIVE_CANDLE_DIRECTION_V1/);
});
