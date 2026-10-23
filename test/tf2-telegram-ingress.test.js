'use strict';
const {test}=require('node:test'),a=require('node:assert/strict');
const S=require('../tf2-ribbon-scalping'),Hub=require('../tf2-ribbon-market-hub'),{AnalysisAlerts}=require('../analysis-alert-service'),{ingestMarket}=require('../analysis-alert-input');let seq=0;
function fixture(side='BUY'){
 const now=Date.now()+ ++seq,sign=side==='BUY'?1:-1,row=Array(67).fill(null),t=now-180000;
 Object.assign(row,{0:'XAUUSD',1:t,6:4100,13:sign*2,14:sign,16:35,21:4,22:4100,23:4100-sign*3,24:4100-sign*3,25:4100+sign*4,26:4100+sign*8,27:4100+sign*12,28:true,29:side==='BUY',34:side,35:true,36:true,37:true,38:true,39:true,40:true,41:true,42:side==='BUY'?'BULLISH':'BEARISH',43:60,48:'HOLD',49:'HOLD',52:100,56:0,57:'INITIAL',58:'NONE',59:false});
 row[65]={version:'HEMA2_LIVE_V1',tf2:{fast:4100+sign,slow:4100,fastPreviousBar:4100,slowPreviousBar:4100-sign}};
 row[66]={entryRuleVersion:S.RULE,exitLockVersion:S.POLICY.exitLockVersion,entryPolicyVersion:S.POLICY.entryPolicyVersion,planMode:"Fixed R:R",riskPlanVersion:S.RISK,atrPeriod:10,solidSide:side,solidHoldActive:true,solidClosedAt:null,solidTriggeredAt:t,setupAt:t,sourceEntry:4100-sign,solidEligible:true,completedAt:now,completionPrice:4100,riskAtrReference:4,riskStructure:4100-sign*2,riskTick:.01,entryEvent:true,entryAuthorizedAt:now,dashboardAi:{momentum:side==='BUY'?'Bullish 🟢':'Bearish 🔴',mtfScore:sign,dashboard:{mtfTimeframes:['3','5','10']}}};
 return {row,now,batch:{feedVersion:'TF2_REALTIME_V1',timeframe:'2',schemaVersion:'32.3-EXIT-STEPLOCK',feedUpdateVersion:'SPLIT_CHANNEL_BOOTSTRAP_V2',feedChannel:'EXECUTION',confirmed:false,emittedAt:now,markets:[row]}};
}

for(const side of ['BUY','SELL'])test('real TF2 '+side+' execution -> alert entry; Dashboard suppressed; repeated setup deduplicated',async()=>{
 const f=fixture(side);f.row[66].entryPolicyVersion=S.SOLID_POLICY;f.row[66].entryDeliveryVersion='FIXED_EVENT_RETRY_V1';
 const m=Hub.ingest(f.batch,f.now)[0],alerts=new AnalysisAlerts({fetchFn:()=>{throw Error('NO_NETWORK_TEST')}});await alerts.init();
 const before=JSON.stringify(m),dashboard={...m,feedChannel:'DASHBOARD'};
 await ingestMarket(alerts,dashboard);a.equal(alerts.events.filter(e=>e.kind==='ENTRY').length,0);
 await ingestMarket(alerts,{...m,receivedAt:m.receivedAt+1});
 const entries=alerts.events.filter(e=>e.kind==='ENTRY');a.equal(entries.length,1);a.equal(entries[0].side,side);
 a.equal(require('../analysis-telegram').entrySopAllowed(entries[0]),true);
 a.match(require('../analysis-telegram').telegramMessage(entries[0]),/ENTRY/);
 await ingestMarket(alerts,{...m,receivedAt:m.receivedAt+2});a.equal(alerts.events.filter(e=>e.kind==='ENTRY').length,1);
 a.equal(JSON.stringify(m),before);
 const close={...m,receivedAt:m.receivedAt+3,entryEvent:false,positionManagement:{action:'EXIT_ALL',reason:'Native chart Close All'}};
 await ingestMarket(alerts,close);a.ok(alerts.events.some(e=>e.kind==='CLOSE'));
});
test('invalid or expired TF2 execution never produces Telegram entry',async()=>{
 for(const edit of [m=>m.strategyNormal.solid=false,m=>m.entryEvent=false,m=>m.entryAuthorizedAt=Date.now()-61000]){
  const f=fixture();f.row[66].entryPolicyVersion=S.SOLID_POLICY;const m=Hub.ingest(f.batch,f.now)[0];edit(m);
  const alerts=new AnalysisAlerts();await alerts.init();await ingestMarket(alerts,m);a.equal(alerts.events.filter(e=>e.kind==='ENTRY').length,0);
 }
});
test('production market bus uses the tested alert ingress function',()=>{
 const s=require('node:fs').readFileSync(require.resolve('../server-analysis.js'),'utf8');
 a.match(s,/require\('\.\/analysis-alert-input'\)\.ingestMarket\(analysisAlerts,market\)/);
});
