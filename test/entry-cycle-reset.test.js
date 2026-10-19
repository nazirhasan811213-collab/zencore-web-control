'use strict';
const test=require('node:test'),a=require('node:assert/strict');
const {MemoryAutoTradeStore}=require('../auto-trade-store'),{createEntryCycleReset}=require('../entry-cycle-reset');
const pos=mode=>({symbol:'XAUUSD',origin:'ZENCORE',strategyMode:mode});
const market=(tf,t)=>({timeframe:tf,strategyNormal:{sop:{entryPolicyVersion:'PINE_3TRIGGERS_4OF5_V2',triggerAt:t}}});
test('close of all TF3 positions resets only TF3 and rejects old SOLID after restart',async()=>{
 const store=new MemoryAutoTradeStore(),r=createEntryCycleReset(store),before=[pos('TF2_SCALPING'),pos('TF15_INTRA')];
 await r.observe('u','pod',before,[before[1]],1000);
 a.equal(await r.allows('u','pod',market('3',999)),false);a.equal(await r.allows('u','pod',market('3',1001)),true);
 a.equal(await r.allows('u','pod',market('15',999)),true);
 const restarted=createEntryCycleReset(store);a.equal(await restarted.allows('u','pod',market('3',999)),false);
 a.equal(await restarted.allows('u','new-pod',market('3',999)),true);
});
test('partial close and manual closes do not reset strategy; next complete cycle resets again',async()=>{
 const store=new MemoryAutoTradeStore(),r=createEntryCycleReset(store),p=pos('TF15_INTRA');
 await r.observe('u','pod',[p,p],[p],1000);a.equal((await store.listAudit('u')).length,0);
 await r.observe('u','pod',[{...p,origin:'MANUAL'}],[],1001);a.equal((await store.listAudit('u')).length,0);
 await r.observe('u','pod',[p],[],1100);a.equal(await r.allows('u','pod',market('15',1200)),true);
 await r.observe('u','pod',[p],[],1300);a.equal(await r.allows('u','pod',market('15',1200)),false);
});
test('missed open/close transition recovers only after two confirmed flat MT5 snapshots',async()=>{
 const store=new MemoryAutoTradeStore(),gate=createEntryCycleReset(store);
 store.commands.set('pod',[{id:'filled-15',userId:'u',podId:'pod',type:'PLACE_SETUP',status:'EXECUTED',acknowledgedAt:1000,payload:{symbol:'XAUUSD',strategyMode:'TF15_INTRA'}}]);
 const m={timeframe:'15',signalObservedAt:30000,strategyNormal:{side:'BUY',sop:{entryPolicyVersion:'PINE_3TRIGGERS_3OF4_CHOP50_V3',lifecycleVersion:'PULLBACK_REQUALIFY_V1',qualifiedAt:30000}}};
 a.equal((await gate.check('u','pod',m)).reason,'WAIT_MT5_CLOSE_CONFIRMATION');
 await gate.observe('u','pod',[],[],20000);a.equal((await store.listAudit('u')).length,0);
 await gate.observe('u','pod',[],[],24000);a.equal((await store.listAudit('u')).length,0);
 await gate.observe('u','pod',[],[],25000);
 const reset=await store.lastStrategyCycleReset('u','pod','TF15_INTRA');a.equal(reset.closedAt,25000);a.equal(reset.source,'CONFIRMED_FLAT_SNAPSHOTS');
 a.equal((await gate.check('u','pod',m)).reason,'WAIT_PULLBACK_MOMENTUM_AFTER_CLOSE','recovery never bypasses fresh pullback and strong SOP');
 a.equal(await store.lastStrategyCycleReset('u','pod','TF2_SCALPING'),null);
 const restarted=createEntryCycleReset(store);a.equal((await restarted.check('u','pod',m)).reason,'WAIT_PULLBACK_MOMENTUM_AFTER_CLOSE');
 a.equal((await gate.check('u','different-pod',m)).allowed,true);
});
test('unarmed, single, recent-fill and interrupted flat evidence cannot reset a trade cycle',async()=>{
 const store=new MemoryAutoTradeStore(),gate=createEntryCycleReset(store),rows=[{id:'a',userId:'u',podId:'p',type:'PLACE_SETUP',status:'EXECUTED',acknowledgedAt:1000,payload:{symbol:'XAUUSD',strategyMode:'TF2_SCALPING'}}];
 store.commands.set('p',rows);
 const m={timeframe:'3',signalObservedAt:50000,strategyNormal:{side:'BUY',sop:{entryPolicyVersion:'PINE_3TRIGGERS_3OF4_CHOP50_V3',lifecycleVersion:'PULLBACK_REQUALIFY_V1'}}};
 await gate.observe('u','p',[],[],10000);a.equal((await store.listAudit('u')).length,0,'no scan without a blocked executed cycle');
 await gate.check('u','p',m);await gate.observe('u','p',[],[],11000);
 rows.push({...rows[0],id:'b',acknowledgedAt:14000});
 await gate.observe('u','p',[],[],16000);a.equal((await store.listAudit('u')).length,0,'new execution restarts evidence');
 await gate.observe('u','p',[],[],21000);a.equal((await store.listAudit('u')).length,0,'less than 10 seconds after acknowledgement');
 await gate.observe('u','p',[],[pos('TF2_SCALPING')],24000);
 await gate.observe('u','p',[],[],26000);a.equal((await store.listAudit('u')).length,0,'seeing a position interrupts empty evidence');
 await gate.observe('u','p',[],[],31000);a.equal((await store.lastStrategyCycleReset('u','p','TF2_SCALPING')).closedAt,31000);
});
test('a new Pine INITIAL native SOLID after confirmed close uses entry SOP; held/followup signals still need re-entry proof',async()=>{
 const store=new MemoryAutoTradeStore(),gate=createEntryCycleReset(store);
 await gate.observe('u','p',[pos('TF2_SCALPING')],[],10000);
 const s={entryPolicyVersion:'PINE_3TRIGGERS_3OF4_CHOP50_V3',lifecycleVersion:'PULLBACK_REQUALIFY_V1',cycleKind:'INITIAL',sourceSetupAt:20000,triggerAt:20001,reentryContext:{parentQualifiedAt:null}};
 const m={timeframe:'3',signalObservedAt:21000,strategyNormal:{side:'BUY',sop:s}};
 a.equal((await gate.check('u','p',m)).allowed,true);
 for(const bad of [{...s,sourceSetupAt:9999},{...s,triggerAt:9999},{...s,cycleKind:'FOLLOWUP'},{...s,reentryContext:{parentQualifiedAt:5000}},{...s,sourceSetupAt:undefined}])a.equal((await gate.check('u','p',{...m,strategyNormal:{side:'BUY',sop:bad}})).reason,'WAIT_PULLBACK_MOMENTUM_AFTER_CLOSE');
 await gate.observe('u','p',[pos('TF2_SCALPING')],[],22000);
 a.equal((await gate.check('u','p',m)).reason,'WAIT_PULLBACK_MOMENTUM_AFTER_CLOSE','same INITIAL cannot bypass its own confirmed close');
});

test('a new untraded TF2 source remains a normal entry across Pine virtual followups',async()=>{
 const store=new MemoryAutoTradeStore(),gate=createEntryCycleReset(store);
 const close=1792393054646,source=1792395480000,trigger=1792395480544,parent=1792396200430,qualified=1792396417870;
 await gate.observe('u','p',[pos('TF2_SCALPING')],[],close);
 const s={entryPolicyVersion:'PINE_3TRIGGERS_3OF4_CHOP50_V3',lifecycleVersion:'PULLBACK_REQUALIFY_V1',cycleKind:'FOLLOWUP',sourceSetupAt:source,triggerAt:trigger,qualifiedAt:qualified,reentryContext:{parentQualifiedAt:parent}};
 const m={timeframe:'2',signalObservedAt:qualified,strategyNormal:{side:'SELL',sop:s}};
 const decision=await gate.check('u','p',m);a.equal(decision.allowed,true);a.equal(decision.entryKind,'NORMAL_ENTRY');
 await gate.observe('u','p',[pos('TF15_INTRA')],[],close);a.equal((await gate.check('u','p',{...m,timeframe:'15'})).reason,'WAIT_PULLBACK_MOMENTUM_AFTER_CLOSE','TF15 policy is unchanged');
 for(const bad of [{...s,sourceSetupAt:close-1},{...s,sourceSetupAt:undefined},{...s,triggerAt:source-1},{...s,reentryContext:{parentQualifiedAt:null}},{...s,reentryContext:{parentQualifiedAt:qualified+1}},{...s,cycleKind:'UNKNOWN'}])a.equal((await gate.check('u','p',{...m,strategyNormal:{side:'SELL',sop:bad}})).reason,'WAIT_PULLBACK_MOMENTUM_AFTER_CLOSE');
 await gate.observe('u','p',[pos('TF2_SCALPING')],[],qualified+10000);
 a.equal((await gate.check('u','p',m)).reason,'WAIT_PULLBACK_MOMENTUM_AFTER_CLOSE','once broker cycle closes, the same source must provide real re-entry proof');
});

test('an executed setup without confirmed close still blocks a new TF2 followup source',async()=>{
 const store=new MemoryAutoTradeStore(),gate=createEntryCycleReset(store);
 await gate.observe('u','p',[pos('TF2_SCALPING')],[],10000);
 store.commands.set('p',[{id:'open-command',userId:'u',podId:'p',type:'PLACE_SETUP',status:'EXECUTED',acknowledgedAt:25000,payload:{symbol:'XAUUSD',strategyMode:'TF2_SCALPING'}}]);
 const m={timeframe:'2',signalObservedAt:30000,strategyNormal:{side:'SELL',sop:{entryPolicyVersion:'PINE_3TRIGGERS_3OF4_CHOP50_V3',lifecycleVersion:'PULLBACK_REQUALIFY_V1',cycleKind:'FOLLOWUP',sourceSetupAt:20000,triggerAt:20001,qualifiedAt:30000,reentryContext:{parentQualifiedAt:22000}}}};
 a.equal((await gate.check('u','p',m)).reason,'WAIT_MT5_CLOSE_CONFIRMATION');
});
