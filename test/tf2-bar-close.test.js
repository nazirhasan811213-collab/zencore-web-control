'use strict';
const {test}=require('node:test'),a=require('node:assert/strict');
const S=require('../tf2-ribbon-scalping'),Hub=require('../tf2-ribbon-market-hub'),C=require('../analysis-execution-contract'),Core=require('../auto-trade-core');let seq=0;
function fixture(side='BUY'){
 const now=Date.now()+ ++seq,sign=side==='BUY'?1:-1,row=Array(67).fill(null),t=now-180000;
 Object.assign(row,{0:'XAUUSD',1:t,6:4100,13:sign*2,14:sign,16:35,21:4,22:4100,23:4100-sign*3,24:4100-sign*3,25:4100+sign*4,26:4100+sign*8,27:4100+sign*12,28:true,29:side==='BUY',34:side,35:true,36:true,37:true,38:true,39:true,40:true,41:true,42:side==='BUY'?'BULLISH':'BEARISH',43:60,48:'HOLD',49:'HOLD',52:100,56:0,57:'INITIAL',58:'NONE',59:false});
 row[65]={version:'HEMA2_LIVE_V1',tf2:{fast:4100+sign,slow:4100,fastPreviousBar:4100,slowPreviousBar:4100-sign}};
 row[66]={entryRuleVersion:S.RULE,exitLockVersion:S.POLICY.exitLockVersion,entryPolicyVersion:S.POLICY.entryPolicyVersion,planMode:"Fixed R:R",riskPlanVersion:S.RISK,atrPeriod:10,solidSide:side,solidHoldActive:true,solidClosedAt:null,solidTriggeredAt:t,setupAt:t,sourceEntry:4100-sign,solidEligible:true,completedAt:now,completionPrice:4100,riskAtrReference:4,riskStructure:4100-sign*2,riskTick:.01,entryEvent:true,entryAuthorizedAt:now,dashboardAi:{momentum:side==='BUY'?'Bullish 🟢':'Bearish 🔴',mtfScore:sign,dashboard:{mtfTimeframes:['3','5','10']}}};
 return {row,now,batch:{feedVersion:'TF2_REALTIME_V1',timeframe:'2',schemaVersion:'32.3-EXIT-STEPLOCK',feedUpdateVersion:'SPLIT_CHANNEL_BOOTSTRAP_V2',feedChannel:'EXECUTION',confirmed:false,emittedAt:now,markets:[row]}};
}


const B=require('../tf2-bar-close');
for(const side of ['BUY','SELL'])test('TF2 '+side+' new timing rejects intrabar/future confirmations and accepts a real completed candle',async()=>{
 delete require.cache[require.resolve('../tf2-ribbon-market-hub')];const Hub=require('../tf2-ribbon-market-hub');
 const f=fixture(side);f.row[1]=f.now-120000;
 Object.assign(f.row[66],{entryDeliveryVersion:'FIXED_EVENT_RETRY_V1',decisionTimingVersion:B.VERSION,decisionBarCloseAt:f.now});
 const intrabar=Hub.ingest(f.batch,f.now)[0];a.equal(intrabar.strategyNormal.state,'WAIT');a.equal(C.createEntryDecision(intrabar,f.now),null);a.match(intrabar.strategyNormal.reason,/candle TF2 tutup/);
 const good={...f.batch,confirmed:true,emittedAt:f.now+1};const m=Hub.ingest(good,f.now+1)[0];a.equal(m.strategyNormal.state,'READY');const d=C.createEntryDecision(m,f.now+1);a.ok(d);a.equal(d.snapshot.decisionTimingVersion,B.VERSION);
 const forced={...m,confirmed:false,strategyNormal:{...m.strategyNormal,state:'READY'}};a.equal(C.createEntryDecision(forced,f.now+1),null);
 const f2=fixture(side);f2.row[1]=f2.now-60000;Object.assign(f2.row[66],{decisionTimingVersion:B.VERSION,decisionBarCloseAt:f2.now+60000});f2.batch.confirmed=true;
 const early=Hub.ingest(f2.batch,f2.now)[0];a.equal(C.createEntryDecision(early,f2.now),null,'confirmed flag alone cannot authorize before source candle close');
 const {AnalysisAlerts}=require('../analysis-alert-service');const alerts=new AnalysisAlerts();await alerts.init();try{await alerts.record(m);const e=alerts.events.find(e=>e.kind==='ENTRY');a.ok(e);a.equal(require('../analysis-telegram').entrySopAllowed(e),true);}finally{clearInterval(alerts.cleanupTimer);}
});
test('new timing blocks intrabar native close and SL moves; confirmed close enables management',()=>{
 delete require.cache[require.resolve('../tf2-ribbon-market-hub')];const Hub=require('../tf2-ribbon-market-hub');
 const f=fixture();Object.assign(f.row,{1:f.now-120000,48:'CLOSED',49:'EXIT_ALL',52:0});Object.assign(f.row[66],{decisionTimingVersion:B.VERSION,decisionBarCloseAt:f.now,nativeExitAll:true});
 const first=Hub.ingest(f.batch,f.now)[0];a.equal(first.nativeChartExitAll,false);a.equal(first.positionManagement.action,'IDLE');
 const second=Hub.ingest({...f.batch,confirmed:true,emittedAt:f.now+1},f.now+1)[0];a.equal(second.nativeChartExitAll,true);a.equal(second.positionManagement.action,'EXIT_ALL');
 const allow=require('../tf2-ribbon-live-management').allow;a.equal(allow(f.row,f.batch,f.now),false);a.equal(allow(f.row,{...f.batch,confirmed:true},f.now),true);
});
test('TF2 progress waits for close; frozen retries do not extend original confirmed evidence',()=>{
 const at=Date.now(),plan={entry:100,sl:99,tp1:101,tp2:102,tp3:103},previous={activePlan:{side:'BUY',setupKey:'setup',plan,atrReference:2}},next=()=>({timeframe:'2',symbol:'XAUUSD',time:at});
 const m={price:104,timeframe:'2',sourceBarTime:at-120000,signalObservedAt:at,confirmed:false,setupMeta:{decisionTimingVersion:B.VERSION,decisionBarCloseAt:at}};
 const progress=require('../telegram-progress').progress;a.deepEqual(progress(previous,next(),m,[],at),[]);
 a.equal(progress(previous,next(),{...m,confirmed:true},[],at).filter(e=>e.kind==='TP_HIT').length,3);
 a.equal(B.confirmed({...m,confirmed:true,signalObservedAt:at+60001}),false);
 a.equal(B.confirmed({...m,confirmed:true,signalObservedAt:at+60000}),true);
});

test('closing tick true event survives immediate false pulse, without extending authorization',()=>{
 delete require.cache[require.resolve('../tf2-ribbon-market-hub')];const H=require('../tf2-ribbon-market-hub');
 const f=fixture();f.row[1]=f.now-120000;f.batch.confirmed=true;
 Object.assign(f.row[66],{entryDeliveryVersion:'FIXED_EVENT_RETRY_V1',decisionTimingVersion:B.VERSION,decisionBarCloseAt:f.now});
 const first=H.ingest(f.batch,f.now)[0];a.ok(C.createEntryDecision(first,f.now));
 const cleared=structuredClone(f.batch);cleared.emittedAt+=3;cleared.markets[0][66].entryEvent=false;cleared.markets[0][66].entryAuthorizedAt=null;
 a.equal(H.ingest(cleared,f.now+3).length,0);
 const kept=H.markets()[0];a.equal(kept,first);a.equal(kept.receivedAt,f.now);a.ok(C.createEntryDecision(kept,f.now+100));
 a.equal(S.entryDecision(kept,f.now+60001),null);
 // A changed close/plan or a genuine exit must still replace the cached entry.
 const changed=structuredClone(cleared);changed.emittedAt+=1;changed.markets[0][6]-=.01;
 a.equal(H.ingest(changed,f.now+4).length,1);a.equal(H.markets()[0].entryEvent,false);
});
test('same-close exit cannot be hidden by entry preservation',()=>{
 delete require.cache[require.resolve('../tf2-ribbon-market-hub')];const H=require('../tf2-ribbon-market-hub');
 const f=fixture();f.row[1]=f.now-120000;f.batch.confirmed=true;
 Object.assign(f.row[66],{entryDeliveryVersion:'FIXED_EVENT_RETRY_V1',decisionTimingVersion:B.VERSION,decisionBarCloseAt:f.now});
 H.ingest(f.batch,f.now);
 const exit=structuredClone(f.batch);exit.emittedAt+=3;Object.assign(exit.markets[0],{48:'CLOSED',49:'EXIT_ALL',52:0});Object.assign(exit.markets[0][66],{entryEvent:false,entryAuthorizedAt:null,nativeExitAll:true});
 a.equal(H.ingest(exit,f.now+3)[0].positionManagement.action,'EXIT_ALL');
});
