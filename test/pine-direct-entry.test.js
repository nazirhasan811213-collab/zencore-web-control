'use strict';
const test=require('node:test'),a=require('node:assert/strict');
const D=require('../pine-direct-entry'),Core=require('../auto-trade-core');
function event(tf='2',side='BUY'){
 const sign=side==='BUY'?1:-1;
 return {symbol:'XAUUSD',timeframe:tf,feedChannel:'EXECUTION',feedUpdateVersion:'SPLIT_CHANNEL_BOOTSTRAP_V2',entryEvent:true,
 setupKey:`${tf}|test`,entryAuthorizedAt:1000,signalObservedAt:1000,receivedAt:1000,
 setupMeta:{entryPolicyVersion:'PINE_NATIVE_SOLID_ENTRY_V7',solidSide:side,completedAt:1000,cycleKind:'INITIAL'},
 normal3Entry:4000,initialSl:4000-sign*2,tp1:4000+sign*1.5,tp2:4000+sign*2.5,tp3:4000+sign*3.5};
}
for(const tf of ['2','15'])for(const side of ['BUY','SELL'])test(`Pine direct ${tf} ${side}: delayed plan and closed session do not requalify signal`,()=>{
 const m=event(tf,side),s={capitalUsd:100,lotPerLayer:.01,layers:2,symbols:['XAUUSD'],strategyMode:tf==='15'?'TF15_INTRA':'TF2_SCALPING',riskAcknowledgedAt:1,tradingSchedule:{enabled:true,skipNews:true}};
 const d=D.decision(m);a.ok(d);a.equal(d.snapshot.entry,m.normal3Entry);a.equal(d.snapshot.sl,m.initialSl);
 const c=Core.buildSetupCommand(m,s,null,Date.UTC(2026,10,11,16));a.ok(c);a.equal(c.notAfterMs,Infinity);
 a.equal(require('../entry-delivery-check').checkEntryDelivery({type:'PLACE_SETUP',payload:c.payload},null).ok,true);
 a.equal(D.decision({...m,feedChannel:'DASHBOARD'}),null);
 a.equal(D.decision({...m,entryEvent:false}),null);
 a.equal(D.decision({...m,initialSl:m.normal3Entry}),null);
 a.equal(D.decision({...m,tp2:m.tp1}),null);
 a.equal(D.decision({...m,entryAuthorizedAt:999}),null);
});
