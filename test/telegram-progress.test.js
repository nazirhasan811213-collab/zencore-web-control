'use strict';
const {test}=require('node:test'),a=require('node:assert/strict');
const {progress,allowed}=require('../telegram-progress');
const {notificationKey}=require('../telegram-notification-key');
const {telegramMessage}=require('../analysis-telegram');
for(const tf of ['2','15'])for(const side of ['BUY','SELL'])test(`progress ${tf} ${side}: targets, pullback, restart and close`,()=>{
 const sign=side==='BUY'?1:-1,now=Date.now(),plan={entry:100,sl:100-sign*2,tp1:100+sign*2,tp2:100+sign*4,tp3:100+sign*6};
 let previous={activePlan:{side,setupKey:'A',plan,atrReference:4}},clock=now;
 function tick(distance,events=[]){clock++;const next={time:clock,timeframe:tf,symbol:'XAUUSD'};const result=progress(previous,next,{signalObservedAt:clock,price:100+sign*distance,high:999,low:1},events,clock);previous={...next,activePlan:events.some(e=>e.kind==='CLOSE')?null:previous.activePlan};return result;}
 a.deepEqual(tick(0),[]);let e=tick(2);a.equal(e[0].targetNumber,1);a.ok(allowed(e[0],clock));a.match(telegramMessage(e[0]),/TP1 DILEPASI/);
 a.deepEqual(tick(2),[]);a.deepEqual(tick(1.01),[]);e=tick(1);a.deepEqual(e,[],'distance alone no longer announces a turn');a.deepEqual(tick(.5),[]);
 previous=JSON.parse(JSON.stringify(previous));a.deepEqual(tick(1),[]);
 e=tick(6);a.deepEqual(e.map(x=>x.targetNumber),[2,3]);a.notEqual(notificationKey(e[0]),notificationKey(e[1]));
 a.deepEqual(tick(5),[]);a.deepEqual(tick(4),[]);
 tick(3,[{kind:'CLOSE',percent:100}]);a.equal(previous.telegramProgress,null);a.deepEqual(tick(8),[]);
});
test('freshness, frozen plan, no entry and distinct setup',()=>{
 const now=Date.now(),plan={entry:100,sl:98,tp1:102,tp2:104,tp3:106},old={activePlan:{side:'BUY',setupKey:'A',plan,atrReference:4}};
 const next=()=>({symbol:'XAUUSD',timeframe:'2',time:now});
 a.deepEqual(progress(null,next(),{price:110,signalObservedAt:now},[],now),[]);
 a.deepEqual(progress(old,next(),{price:110,signalObservedAt:now-61000},[],now),[]);
 const n=next();const events=progress(old,n,{price:106,signalObservedAt:now,strategyNormal:{plan:{tp1:200}}},[],now);a.equal(events.length,3);a.equal(events[0].telegramPlan.tp1,102);
 a.deepEqual(progress({...old,...n},next(),{price:110,signalObservedAt:now},[],now),[]);
 const reopened=next();const entry={kind:'ENTRY',side:'BUY',setupKey:'B',telegramPlan:plan,telegramSop:{riskAtrReference:4}};
 a.equal(progress({...old,...n},reopened,{price:102,signalObservedAt:now},[entry],now)[0].targetNumber,1);
 const invalid={...events[0],currentPrice:101};a.equal(allowed(invalid,now),false);a.equal(allowed(events[0],now+61000),false);
});

const S=require('../tf2-ribbon-scalping'),Hub=require('../tf2-ribbon-market-hub');let seq=0;
function fixture(side='BUY'){
 const now=Date.now()+ ++seq,sign=side==='BUY'?1:-1,row=Array(67).fill(null),t=now-180000;
 Object.assign(row,{0:'XAUUSD',1:t,6:4100,13:sign*2,14:sign,16:35,21:4,22:4100,23:4100-sign*3,24:4100-sign*3,25:4100+sign*4,26:4100+sign*8,27:4100+sign*12,28:true,29:side==='BUY',34:side,35:true,36:true,37:true,38:true,39:true,40:true,41:true,42:side==='BUY'?'BULLISH':'BEARISH',43:60,48:'HOLD',49:'HOLD',52:100,56:0,57:'INITIAL',58:'NONE',59:false});
 row[65]={version:'HEMA2_LIVE_V1',tf2:{fast:4100+sign,slow:4100,fastPreviousBar:4100,slowPreviousBar:4100-sign}};
 row[66]={entryRuleVersion:S.RULE,exitLockVersion:S.POLICY.exitLockVersion,entryPolicyVersion:S.POLICY.entryPolicyVersion,planMode:"Fixed R:R",riskPlanVersion:S.RISK,atrPeriod:10,solidSide:side,solidHoldActive:true,solidClosedAt:null,solidTriggeredAt:t,setupAt:t,sourceEntry:4100-sign,solidEligible:true,completedAt:now,completionPrice:4100,riskAtrReference:4,riskStructure:4100-sign*2,riskTick:.01,entryEvent:true,entryAuthorizedAt:now,dashboardAi:{momentum:side==='BUY'?'Bullish 🟢':'Bearish 🔴',mtfScore:sign,dashboard:{mtfTimeframes:['3','5','10']}}};
 return {row,now,batch:{feedVersion:'TF2_REALTIME_V1',timeframe:'2',schemaVersion:'32.3-EXIT-STEPLOCK',feedUpdateVersion:'SPLIT_CHANNEL_BOOTSTRAP_V2',feedChannel:'EXECUTION',confirmed:false,emittedAt:now,markets:[row]}};
}
test('actual entry pipeline persists plan, then dashboard emits TP without entry',async()=>{
 const {AnalysisAlerts}=require('../analysis-alert-service'),{ingestMarket}=require('../analysis-alert-input');
 const service=new AnalysisAlerts({fetchFn:()=>{throw Error('no network');}});service.ready=true;
 const f=fixture();f.row[66].entryPolicyVersion=S.SOLID_POLICY;
 const market=Hub.ingest(f.batch,f.now)[0];await ingestMarket(service,market);
 a.equal(service.events[0].kind,'ENTRY');a.equal(service.states.get('XAUUSD|2').activePlan.atrReference,4);
 const plan=service.states.get('XAUUSD|2').activePlan.plan;
 await ingestMarket(service,{...market,feedChannel:'DASHBOARD',receivedAt:f.now+1,signalObservedAt:f.now+1,price:plan.tp2});
 a.deepEqual(service.events.map(e=>e.kind),['ENTRY','TP_HIT','TP_HIT']);
 const restored=new AnalysisAlerts();restored.ready=true;restored.states=new Map(JSON.parse(JSON.stringify([...service.states])));
 await ingestMarket(restored,{...market,feedChannel:'DASHBOARD',receivedAt:f.now+2,signalObservedAt:f.now+2,price:plan.tp2});a.equal(restored.events.length,0);
 await ingestMarket(restored,{...market,feedChannel:'DASHBOARD',receivedAt:f.now+3,signalObservedAt:f.now+3,price:plan.tp2-1});a.equal(restored.events.length,0,'retracement without closed reversal evidence is suppressed');
});
