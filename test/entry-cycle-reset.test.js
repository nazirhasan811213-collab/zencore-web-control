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
