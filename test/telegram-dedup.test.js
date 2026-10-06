const test=require('node:test');
const assert=require('node:assert/strict');
const {AnalysisAlerts}=require('../analysis-alert-service');
const {notificationKey}=require('../telegram-notification-key');

const market=(time,setupKey='setup-A',tf='2')=>({symbol:'XAUUSD',timeframe:tf,setupKey,receivedAt:time,
 strategyNormal:{state:'READY',side:'BUY',sop:{sopGreen:4,forecast:'BULLISH',marketPower:70,gates:[{pass:true},{pass:true}]},plan:{entry:2000,sl:1990,tp1:2010,tp2:2020,tp3:2030}},positionManagement:{action:'HOLD'}});

test('notification identity ignores arrival, SL and event IDs, preserves TF, setup and re-entry candle',()=>{
 const e={kind:'ENTRY',symbol:'XAUUSD',timeframe:'2',side:'BUY',setupKey:'A',telegramPlan:{entry:2000,sl:1990}};
 assert.equal(notificationKey(e),notificationKey({...e,id:999,time:Date.now(),telegramPlan:{entry:2000,sl:1995}}));
 for(const edit of [{timeframe:'15'},{setupKey:'B'},{side:'SELL'}])assert.notEqual(notificationKey(e),notificationKey({...e,...edit}));
 const re={...e,entryType:'HIGH_REENTRY',sourceBarTime:123};
 assert.notEqual(notificationKey(re),notificationKey({...re,sourceBarTime:124}));
 assert.notEqual(notificationKey(e),notificationKey(re));
});

test('replayed setup and full close never notify twice; fresh same-price setups and TF15 remain independent',async()=>{
 const s=new AnalysisAlerts();await s.init();let t=Date.now()-20000;
 const record=edit=>s.record({...market(++t),...edit});
 try{
  await record({});await record({strategyNormal:{state:'WAIT'}});await record({});
  await record({positionManagement:{action:'EXIT_ALL'}});
  await record({strategyNormal:{state:'WAIT'}});
  await record({positionManagement:{action:'EXIT_SL'}});
  await record({strategyNormal:{state:'WAIT'}});await record({});
  await record({setupKey:'setup-B'});
  await record({timeframe:'15'});
  const events=(await s.feed('0')).events;
  assert.equal(events.filter(e=>e.kind==='ENTRY'&&!e.telegramDuplicate).length,3);
  assert.equal(events.filter(e=>e.kind==='CLOSE'&&!e.telegramDuplicate).length,1);
  assert.ok(events.filter(e=>e.telegramDuplicate).length>=3);
 }finally{clearInterval(s.cleanupTimer);}
});

test('database notification ledger survives a new service instance and stale frame transitions',async()=>{
 const states=new Map(),keys=new Set(),events=[];
 const query=async(sql,args=[])=>{
  if(sql.startsWith('SELECT data FROM zencore_alert_states'))return {rows:states.has(args[0])?[{data:structuredClone(states.get(args[0]))}]:[]};
  if(sql.startsWith('INSERT INTO zencore_alert_states'))states.set(args[0],structuredClone(args[1]));
  if(sql.startsWith('INSERT INTO zencore_notification_keys')){if(keys.has(args[0]))return {rows:[]};keys.add(args[0]);return {rows:[{notification_key:args[0]}]};}
  if(sql.startsWith('INSERT INTO zencore_analysis_alerts')){events.push(structuredClone(args[0]));return {rows:[{id:events.length}]};}
  return {rows:[]};
 };
 const pool={query,connect:async()=>({query,release(){}})};
 const a=new AnalysisAlerts({pool}),b=new AnalysisAlerts({pool});await a.init();await b.init();let t=Date.now()-20000;
 try{
  await a.record(market(++t));
  await a.record({...market(++t),positionManagement:{action:'EXIT_ALL'}});
  await b.record({...market(++t),strategyNormal:{state:'WAIT'}});
  await b.record(market(++t));
  await b.record({...market(++t),positionManagement:{action:'EXIT_SL'}});
  await b.record(market(++t,'setup-B'));
  assert.equal(events.filter(e=>e.kind==='ENTRY'&&!e.telegramDuplicate).length,2);
  assert.equal(events.filter(e=>e.kind==='CLOSE'&&!e.telegramDuplicate).length,1);
 }finally{clearInterval(a.cleanupTimer);clearInterval(b.cleanupTimer);}
});

test('upgrade adopts the key of an already-announced legacy position without replaying entry',async()=>{
 const s=new AnalysisAlerts();await s.init();let t=Date.now()-20000;
 try{
  await s.record(market(++t,null));
  await s.record(market(++t));
  await s.record({...market(++t),positionManagement:{action:'EXIT_ALL'}});
  await s.record({...market(++t),strategyNormal:{state:'WAIT'}});
  await s.record(market(++t));
  assert.equal((await s.feed('0')).events.filter(e=>e.kind==='ENTRY'&&!e.telegramDuplicate).length,1);
  await s.record(market(++t,'setup-B'));
  assert.equal((await s.feed('0')).events.filter(e=>e.kind==='ENTRY'&&!e.telegramDuplicate).length,2);
 }finally{clearInterval(s.cleanupTimer);}
});

test('queued duplicate event IDs and users sharing a chat send one notification, including after restart',async()=>{
 const e={symbol:'XAUUSD',kind:'CLOSE',timeframe:'2',setupKey:'A',percent:100,time:Date.now(),message:'close'};
 const events=[e,{...e},{...e,timeframe:'15'}],claims=new Set(),sent=[],statuses=[];
 let batch=[{id:1,event_id:1,user_id:'one'},{id:2,event_id:2,user_id:'two'},{id:3,event_id:3,user_id:'one'}];
 const pool={query:async(sql,args)=>{
  if(sql.startsWith("UPDATE zencore_telegram_deliveries SET status='sending'")){const rows=batch;batch=[];return {rows};}
  if(sql.startsWith('SELECT status,role'))return {rows:[{status:'active',role:'client'}]};
  if(sql.startsWith('SELECT data FROM zencore_analysis_alerts'))return {rows:[{data:events[args[0]-1]}]};
  if(sql.startsWith('INSERT INTO zencore_telegram_chat_claims'))return {rows:[{event_id:args[0]}]};
  if(sql.startsWith('INSERT INTO zencore_telegram_signal_claims')){const key=args.join('|');if(claims.has(key))return {rows:[]};claims.add(key);return {rows:[{notification_key:args[0]}]};}
  if(sql.startsWith('UPDATE zencore_telegram_deliveries SET status=$2')){statuses.push(args);return {rows:[]};}
  throw Error('Unexpected SQL');
 }};
 const service=()=>{const s=new AnalysisAlerts({pool});s.get=async()=>({telegramEnabled:true,verified:true,telegramId:'test-chat'});s.telegram=async(chat,text)=>sent.push(text);return s;};
 await service().deliver();
 batch=[{id:4,event_id:2,user_id:'one'}];await service().deliver();
 assert.equal(sent.length,2);
 assert.deepEqual(statuses,[[1,'sent'],[2,'skipped'],[3,'sent'],[4,'skipped']]);
});
