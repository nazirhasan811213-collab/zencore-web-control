'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {AnalysisAlerts}=require('../analysis-alert-service');
const {createHealthWatchdog}=require('../admin-health-watchdog');
const incident={id:'feed2',severity:'error',component:'TradingView TF2',message:'Feed luput'};
test('health notifications require verified opt-in and preserve trade preferences; incident dedup and recovery persist',async()=>{
 const sent=[],s=new AnalysisAlerts({token:'test',fetchFn:async(_,options)=>{sent.push(JSON.parse(options.body));return {ok:true,json:async()=>({ok:true})};}});
 await assert.rejects(s.healthSettings('admin',{enabled:true}),/Sahkan/);
 await s.put('admin',{verified:true,telegramId:'123456',telegramEnabled:false});
 await s.healthSettings('admin',{enabled:true});
 const snapshot={observedAt:Date.now(),alerts:[incident]};
 await Promise.all([s.withUserLock('admin','deliverHealthSnapshot',snapshot),s.withUserLock('admin','deliverHealthSnapshot',snapshot)]);
 assert.equal(sent.length,1);assert.equal((await s.get('admin')).telegramEnabled,false);
 const restarted=new AnalysisAlerts({token:'test',fetchFn:s.fetch});restarted.prefs=s.prefs;
 await restarted.deliverHealthSnapshot('admin',snapshot);assert.equal(sent.length,1);
 await restarted.deliverHealthSnapshot('admin',{...snapshot,alerts:[]});assert.equal(sent.length,2);assert.match(sent[1].text,/sudah tiada/);
 await restarted.deliverHealthSnapshot('admin',{...snapshot,alerts:[]});assert.equal(sent.length,2);
 await s.healthSettings('admin',{enabled:false});await s.deliverHealthSnapshot('admin',snapshot);assert.equal(sent.length,2);
});
test('role revocation prevents notification and failed Telegram delivery can retry',async()=>{
 const s=new AnalysisAlerts({token:'test',fetchFn:async()=>({ok:false,json:async()=>({ok:false})})});
 await s.put('u',{verified:true,telegramId:'123456',healthNotificationsEnabled:true});
 const snapshot={observedAt:Date.now(),alerts:[incident]};
 await assert.rejects(s.deliverHealthSnapshot('u',snapshot),/Telegram gagal/);assert.equal((await s.get('u')).healthNotificationState,undefined);
 let sent=0;s.fetch=async()=>{sent++;return {ok:true,json:async()=>({ok:true})};};
 const get=s.get.bind(s);s.get=get;s.pool={query:async()=>({rows:[{role:'client',status:'active'}]})};
 // Keep in-memory preferences while emulating the authoritative role lookup.
 s.get=async()=>s.prefs.get('u');await s.deliverHealthSnapshot('u',snapshot);assert.equal(sent,0);
 s.pool=null;s.get=get;await s.deliverHealthSnapshot('u',snapshot);assert.equal(sent,1);
});
test('watchdog debounces transitions, isolates recipients and runs without an open browser',async()=>{
 let alerts=[incident],reads=0;const sent=[];
 const service={ready:true,token:'test',pool:{query:async q=>{assert.match(q.text,/u.role='admin'/);return {rows:[{id:'a'},{id:'b'}]};}},withUserLock:async(id,method,snapshot)=>{if(id==='a')throw new Error('private');sent.push(snapshot.alerts.map(a=>a.id));}};
 const watchdog=createHealthWatchdog({ready:()=>true,alerts:()=>service,monitor:{snapshot:async()=>{reads++;return {observedAt:Date.now(),alerts};}}});
 const original=console.error;console.error=()=>{};
 try{
  await watchdog.tick();assert.equal(sent.length,0);await watchdog.tick();assert.deepEqual(sent.at(-1),['feed2']);
  alerts=[];await watchdog.tick();assert.deepEqual(sent.at(-1),['feed2']);await watchdog.tick();assert.deepEqual(sent.at(-1),[]);
  const before=reads;await Promise.all([watchdog.tick(),watchdog.tick()]);assert.equal(reads,before+1);
 }finally{console.error=original;watchdog.stop();}
});
