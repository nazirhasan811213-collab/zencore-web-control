'use strict';
const test=require('node:test'),a=require('node:assert/strict'),L=require('../setup-lifecycle');
function sop(side='BUY'){
 const sign=side==='BUY'?1:-1;
 return {lifecycleVersion:L.VERSION,qualifiedAt:5000,atrReference:2,riskAtrReference:2,price:100+sign*3,
 hema3:{fast:100+sign*2,slow:100+sign,waveTrend1:sign*4,waveTrend2:sign},
 reentryContext:{parentQualifiedAt:1000,fastPrevious:100+sign,slowPrevious:100+sign*.5,wtGapPrevious:2,previousHigh:102,previousLow:98,pricePath:[[1500,100],[2000,100+sign],[3000,100+sign*.5],[5000,100+sign*3]]}};
}
test('pullback is measured after confirmed MT5 close, directionally and per timeframe ATR',()=>{
 for(const side of ['BUY','SELL']){const s=sop(side);a.ok(L.reentry(side,s,1000,5000));a.ok(L.reentry(side,s,1800,5000));
 a.equal(L.reentry(side,s,3100,5000),null); // all pullback points were before close
 a.equal(L.reentry(side,{...s,qualifiedAt:1000},1000,5000),null);
 }
});
test('flat/narrow/converging ribbon, weak WT and absent resumption cannot re-enter',()=>{
 for(const side of ['BUY','SELL']){const s=sop(side);
 for(const bad of [{...s,hema3:{...s.hema3,fast:s.hema3.slow}}, {...s,reentryContext:{...s.reentryContext,wtGapPrevious:4}}, {...s,price:100}, {...s,reentryContext:{...s.reentryContext,fastPrevious:s.hema3.fast}}])a.equal(L.momentum(side,bad),false);
 const tiny={...s,reentryContext:{...s.reentryContext,pricePath:[[1500,100],[2000,100.01],[3000,100.005],[5000,s.price]]}};a.equal(L.reentry(side,tiny,1000,5000),null);
 }
});
test('retry may carry newer path points, but cannot use points after original qualification as pullback evidence',()=>{
 const s=sop();s.reentryContext.pricePath.push([6000,104]);a.ok(L.reentry('BUY',s,1000,6000));a.equal(L.reentry('BUY',s,1000,5000),null);
 a.equal(L.pullback('BUY',[[2,100],[1,99]],0,5,1),null);a.equal(L.pullback('BUY',Array(121).fill([1,100]),0,5,1),null);
});
test('chart/Analysis READY is revoked after authorization expiry; waiting source has no age expiry',()=>{
 const p={solid:true,confirmations:true,completedAt:1000,observedAt:61001,now:61001,event:true};a.equal(L.describe(p),'EVENT_EXPIRED');
 a.equal(L.describe({...p,completedAt:null,confirmations:false}),'WAIT_SOP');a.equal(L.describe({...p,now:1001}),'ENTRY_EVENT_READY');
});
test('actual close gate requires post-close pullback even for a new native SOLID',async()=>{
 const {createEntryCycleReset}=require('../entry-cycle-reset');const audit=[];const store={appendAudit:async(u,t,d)=>audit.push(d),lastStrategyCycleReset:async()=>null};const reset=createEntryCycleReset(store);
 await reset.observe('u','p',[{symbol:'XAUUSD',strategyMode:'TF2_SCALPING',origin:'ZENCORE'}],[],2500);
 const s=sop();const m={symbol:'XAUUSD',timeframe:'3',signalObservedAt:5000,strategyNormal:{side:'BUY',sop:{...s,entryPolicyVersion:'PINE_3TRIGGERS_4OF5_V2',triggerAt:4000}}};
 a.equal((await reset.check('u','p',m)).reason,'WAIT_PULLBACK_MOMENTUM_AFTER_CLOSE');
 m.strategyNormal.sop.reentryContext.pricePath=[[2600,100],[3000,101],[4000,100.5],[5000,103]];a.equal(await reset.allows('u','p',m),true);
});
test('browser adapters load lifecycle helper first; both pages and static route include it',()=>{
 const fs=require('node:fs'),vm=require('node:vm'),ctx=vm.createContext({});
 for(const file of ['setup-lifecycle.js','tf15-intraday.js','tf3-scalping.js'])vm.runInContext(fs.readFileSync(file,'utf8'),ctx);
 a.equal(ctx.ZenCoreTf3.strategy({}).state,'WAIT');a.equal(ctx.ZenCoreTf15.strategy({}).state,'WAIT');
 for(const file of ['auto-trade.html','precision-entry.html']){const s=fs.readFileSync(file,'utf8');a.ok(s.indexOf('/setup-lifecycle.js')<s.indexOf('/tf15-intraday.js'));}
 a.match(fs.readFileSync('server-analysis.js','utf8'),/pathname === '\/setup-lifecycle.js'/);
});
test('an executed order without an observed MT5 close cannot be treated as a new first entry',async()=>{
 const {createEntryCycleReset}=require('../entry-cycle-reset');const store={lastStrategyCycleReset:async()=>null,latestExecutedSetupForMode:async()=>({acknowledgedAt:1000})};
 const gate=createEntryCycleReset(store),s=sop(),m={timeframe:'3',signalObservedAt:5000,strategyNormal:{side:'BUY',sop:{...s,entryPolicyVersion:'PINE_3TRIGGERS_4OF5_V2'}}};
 a.equal((await gate.check('u','pod',m)).reason,'WAIT_MT5_CLOSE_CONFIRMATION');
});
