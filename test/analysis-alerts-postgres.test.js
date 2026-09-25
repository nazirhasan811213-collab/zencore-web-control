const test=require('node:test');
const assert=require('node:assert/strict');
const {Pool}=require('pg');
const {AnalysisAlerts}=require('../analysis-alert-service');
const url=process.env.ZENCORE_ALERT_TEST_DATABASE_URL;
test('PostgreSQL preserves preferences and de-duplicates concurrent feed across restarts; opt-out cancels queued Telegram', {skip:!url},async()=>{
 const schema='alert_test_'+Date.now();const admin=new Pool({connectionString:url});let pool,a,b;
 try{
  await admin.query(`CREATE SCHEMA ${schema}`);pool=new Pool({connectionString:url,options:`-c search_path=${schema}`});
  await pool.query('CREATE TABLE zencore_users(id UUID PRIMARY KEY,status TEXT,role TEXT)');
  const user='11111111-1111-4111-8111-111111111111';await pool.query("INSERT INTO zencore_users VALUES($1,'active','client')",[user]);
  a=new AnalysisAlerts({pool});await a.init();b=new AnalysisAlerts({pool});await b.init();
  await a.put(user,{popup:true,sound:true,telegramEnabled:true,telegramId:'123456789',verified:true});
  const m={symbol:'XAUUSD',receivedAt:Date.now(),strategyNormal:{state:'READY',side:'BUY',plan:{entry:2000,sl:1990,tp1:2010,tp2:2020,tp3:2030}}};
  await Promise.all([a.record(m),b.record(m)]);await b.record({...m,receivedAt:m.receivedAt+1});
  assert.equal((await a.feed('0')).events.length,1);
  await a.record({...m,receivedAt:m.receivedAt+2,strategyNormal:{state:'WAIT'}});
  await b.record({...m,receivedAt:m.receivedAt+3});
  await a.record({...m,receivedAt:m.receivedAt+4,strategyNormal:{...m.strategyNormal,plan:{...m.strategyNormal.plan,sl:1991}}});
  assert.equal((await a.feed('0')).events.length,3,'popup behavior remains unchanged');
  assert.equal((await pool.query('SELECT * FROM zencore_telegram_deliveries')).rows.length,1);
  assert.equal((await b.get(user)).telegramEnabled,true);
  await b.withUserLock(user,'save',{popup:true,sound:true,telegramEnabled:false,telegramId:'123456789'});
  let sends=0;a.telegram=async()=>{sends++;};await a.deliver();assert.equal(sends,0);
  assert.equal((await pool.query('SELECT status FROM zencore_telegram_deliveries')).rows[0].status,'skipped');
  await a.record({...m,receivedAt:m.receivedAt+5,positionManagement:{action:'CLOSE_50_NOW'}});
  assert.equal((await b.feed('0')).events.length,5,'popup keeps both reverted-plan entry and partial-close events');
  const user2='22222222-2222-4222-8222-222222222222';
  await pool.query("INSERT INTO zencore_users VALUES($1,'active','client')",[user2]);
  for(const id of [user,user2])await a.put(id,{popup:true,sound:true,telegramEnabled:true,telegramId:'123456789',verified:true});
  await a.record({...m,receivedAt:m.receivedAt+6,positionManagement:{action:'EXIT_ALL'}});
  await a.deliver();assert.equal(sends,1,'one shared chat receives one copy of the event');
  await a.put(user,{...await a.get(user),code:'not-a-valid-code',expires:Date.now()+60000,attempts:0});
  await Promise.allSettled(Array.from({length:10},(_,i)=>(i%2?a:b).withUserLock(user,'verify','000000')));
  assert.equal((await a.get(user)).attempts,5);
 }finally{for(const s of [a,b])if(s){clearInterval(s.timer);clearInterval(s.cleanupTimer);}await pool?.end();await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await admin.end();}
});
