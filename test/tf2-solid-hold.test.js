'use strict';
const test=require('node:test'),a=require('node:assert/strict'),fs=require('node:fs');
const E=require('../tf2-solid-hold-sop'),R=require('../tf2-scalp-range'),C=require('../analysis-execution-contract'),T=require('../analysis-telegram'),B=require('../tf2-scalp-range-sop'),P=require('../tf2-post-close-reentry');
function data(side='BUY'){
 const t=Date.now(),sign=side==='BUY'?1:-1,p=R.levels(side,4100,3);
 return {symbol:'XAUUSD',timeframe:'2',feedMode:'INTRABAR',receivedAt:t,signalObservedAt:t,entryAuthorizedAt:t,entryEvent:true,feedChannel:'EXECUTION',feedUpdateVersion:'SPLIT_CHANNEL_BOOTSTRAP_V2',price:4100,close:4100,normal3Close:4100,normal3Entry:4100,normal3Atr:3,initialSl:p.sl,tp1:p.tp1,tp2:p.tp2,tp3:p.tp3,waveTrend1:sign*2,waveTrend2:sign,normal3Sop1:true,normal3Sop2:true,normal3Sop3:true,normal3Sop4:true,normal3Sop5:true,normal3Forecast:side==='BUY'?'BULLISH':'BEARISH',normal3MarketPower:60,hemaConfirmation:{tf2:{fast:4100+sign,slow:4100,fastPreviousBar:4100,slowPreviousBar:4100-sign}},setupMeta:{entryRuleVersion:E.RULE,riskPlanVersion:R.VERSION,solidHoldActive:true,solidClosedAt:null,solidSide:side,solidTriggeredAt:t-240000,setupAt:t-240000,sourceEntry:4100-sign*.2,solidEligible:true,completedAt:t,completionPrice:4100,riskAtrReference:3,dashboardAi:{mtfScore:sign}}};
}
function decision(x){return C.createEntryDecision({...x,strategyNormal:E.strategy(x)});}
test('old native SOLID qualifies later on fresh complete SOP for BUY and SELL',()=>{
 for(const side of ['BUY','SELL']){const x=data(side),n=E.strategy(x);a.equal(n.solid,true);a.equal(n.state,'READY');a.equal(n.sop.passed,6);a.ok(decision(x));a.ok(n.sop.qualifiedAt>n.sop.triggerAt);
 a.ok(T.entrySopAllowed({symbol:'XAUUSD',timeframe:'2',side,telegramPlan:n.plan,telegramSop:{...n.sop,version:E.VERSION,tf:'2m',green:5,power:60}}));}
});
test('held SOLID persists while incomplete; five of six cannot authorize',()=>{
 const x=data();x.setupMeta.solidEligible=false;x.setupMeta.completedAt=null;x.normal3MarketPower=40;
 let n=E.strategy(x);a.equal(n.solid,true);a.equal(n.state,'WAIT');a.equal(n.sop.passed,5);a.equal(decision(x),null);
 x.setupMeta.solidEligible=true;x.setupMeta.completedAt=x.signalObservedAt;x.normal3MarketPower=60;
 a.ok(decision(x));
});
test('CLOSE ALL overrides completed qualification, including contradictory forged active flag',()=>{
 for(const active of [false,true]){const x=data();x.setupMeta.solidHoldActive=active;x.setupMeta.solidClosedAt=x.signalObservedAt;
 const n=E.strategy(x);a.equal(n.solid,false);a.equal(n.state,'WAIT');a.equal(decision(x),null);a.equal(P.qualifies({...x,strategyNormal:n},'BUY'),false);}
});
test('holding does not bypass stale observations, stale receipts or stale authorization',()=>{
 for(const mutate of [x=>x.signalObservedAt-=60000,x=>x.receivedAt-=60000,x=>x.entryAuthorizedAt-=60000,x=>x.setupMeta.completedAt-=60000]){
 const x=data();mutate(x);a.equal(decision(x),null);}
});
test('Dashboard and duplicate heartbeats never authorize another initial entry',()=>{
 for(const mutate of [x=>x.entryEvent=false,x=>x.feedChannel='DASHBOARD',x=>delete x.feedUpdateVersion]){
 const x=data();mutate(x);a.equal(decision(x),null);}
});
test('current ATR gates and frozen completion ATR remain independent',()=>{
 const x=data();x.normal3Atr=4;const n=E.strategy(x);a.equal(n.sop.atrReference,4);a.equal(n.sop.riskAtrReference,3);a.ok(decision(x));
 x.setupMeta.riskAtrReference=4;a.equal(decision(x),null);
});
test('no invented SOLID, opposite direction, missing latch or TF15 cross-talk',()=>{
 for(const mutate of [x=>delete x.setupMeta.solidHoldActive,x=>x.setupMeta.solidSide='SELL',x=>x.timeframe='15',x=>x.setupMeta.solidTriggeredAt=x.signalObservedAt+60000]){
 const x=data();mutate(x);a.equal(decision(x),null);}
});
test('V3 freshness policy cannot be relaxed by V4 latch fields',()=>{
 const x=data();x.setupMeta.entryRuleVersion=B.RULE;const n=B.strategy(x);a.equal(n.state,'WAIT');a.equal(C.createEntryDecision({...x,strategyNormal:n}),null);
 a.equal(C.solid80Tf2Confirmations('BUY',{...E.strategy(data()).sop}),false);
});
test('Pine holds only native chart SOLID; qualification is once, full SOP, CLOSE ALL wins, wire unchanged',()=>{
 const s=fs.readFileSync(require.resolve('../ZenCore_Original_Full_TF2_Scalp_Caps.pine'),'utf8');
 a.ok(s.includes(require('../tf2-solid-hold-v5').RULE));a.match(s,/varip bool zc_hold_active = false/);
 a.match(s,/if current_condition == 3\s+zc_close_all_pulse := true/);
 a.match(s,/if zc_close_all_pulse\s+zc_pending_key := ""\s+zc_hold_active := false/);
 a.match(s,/zc_hold_active and na\(zc_seq_completed\).*zc80_passed >= 5/);
 a.match(s,/zc_seq_completed := zc_seq_now/);a.match(s,/zc_seq_risk := atr/);
 a.match(s,/if zc_hold_qualify\s+xc_half_event_sent := false\s+xc_full_event_sent := false\s+xc_active := true/);
 a.match(s,/zc24_emitted_setup := zc24_setup_at/);
 a.match(s,/zc24_count < 12/);a.equal((s.match(/array.push\(zc24_parts,/g)||[]).length,67);
});
test('global pause still blocks new held policy',()=>{
 const old=process.env.ZENCORE_ENTRY_SIGNALS_PAUSED;try{process.env.ZENCORE_ENTRY_SIGNALS_PAUSED='true';a.equal(E.strategy(data()).state,'PAUSED');a.equal(decision(data()),null);}
 finally{if(old===undefined)delete process.env.ZENCORE_ENTRY_SIGNALS_PAUSED;else process.env.ZENCORE_ENTRY_SIGNALS_PAUSED=old;}
});

test('current server route keeps V4 separate from TF15 and legacy latches',()=>{
 const vm=require('node:vm'),code=fs.readFileSync(require.resolve('../server-v17'),'utf8'),ctx={require:require('node:module').createRequire(require.resolve('../server-v17'))};
 vm.runInNewContext(code.slice(code.indexOf('function normalScalpStrategy('),code.indexOf('function validationKey(')),ctx);
 const x=data();a.equal(ctx.normalScalpStrategy('XAUUSD',x).entrySopVersion,E.VERSION);
 a.equal(require('../entry-setup-state').createEntrySetupTracker().update(x).setupMeta.entryRuleVersion,E.RULE);
});
test('alert service retains hold proof and deduplicates ENTRY without sending messages',async()=>{
 const {AnalysisAlerts}=require('../analysis-alert-service'),service=new AnalysisAlerts();await service.init();
 const x=data();x.setupKey='TF2|XAUUSD|BUY|held';x.strategyNormal=E.strategy(x);
 await service.ingest(x);a.equal(service.events.length,1);a.equal(service.events[0].kind,'ENTRY');
 const event=service.events[0];a.equal(event.telegramSop.solidHoldActive,true);a.equal(event.telegramSop.riskAtrReference,3);a.ok(T.entrySopAllowed(event));
 a.match(T.telegramMessage(event),/ENTRY TF2/);
 const later={...x,receivedAt:x.receivedAt+1,entryEvent:false};await service.ingest(later);a.equal(service.events.length,1);
 const closed={...x,receivedAt:x.receivedAt+2,entryEvent:false,setupMeta:{...x.setupMeta,solidHoldActive:false,solidClosedAt:x.receivedAt+2},positionManagement:{action:'EXIT_ALL',reason:'SOP CLOSE ALL'}};
 closed.strategyNormal=E.strategy(closed);await service.ingest(closed);a.equal(service.events.at(-1).kind,'CLOSE');a.equal(service.events.at(-1).percent,100);
});
test('existing post-close half-layer entry remains supported but CLOSE ALL cannot reenter',()=>{
 const x=data(),market={...x,strategyNormal:E.strategy(x)};a.equal(P.qualifies(market,'BUY'),true);
 const re=P.marketForReentry(market,{side:'BUY',id:'post-close-test'});a.ok(C.createEntryDecision(re));
 market.strategyNormal.sop.solidHoldActive=false;a.equal(P.qualifies(market,'BUY'),false);
});
