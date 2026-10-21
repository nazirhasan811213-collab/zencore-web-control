'use strict';
const {test}=require('node:test'),a=require('node:assert/strict'),crypto=require('node:crypto'),{Pool}=require('pg');
const {CurrentSignalRecords}=require('../current-signal-records'),url=process.env.ZENCORE_ALERT_TEST_DATABASE_URL;
test('real PG recovers saved events, atomically checkpoints, survives restart and source retention',{skip:!url},async()=>{
 const schema='records_'+crypto.randomBytes(8).toString('hex'),db=new Pool({connectionString:url});let pool;
 try{await db.query(`CREATE SCHEMA ${schema}`);pool=new Pool({connectionString:url,options:`-c search_path=${schema}`});
  await pool.query('CREATE TABLE zencore_analysis_alerts(id BIGSERIAL PRIMARY KEY,data JSONB NOT NULL)');
  const entry={kind:'ENTRY',symbol:'XAUUSD',timeframe:'2',setupKey:'A',side:'BUY',time:1000,telegramPlan:{entry:100,sl:98,tp1:102,tp2:104,tp3:106}};
  const insert=e=>pool.query('INSERT INTO zencore_analysis_alerts(data) VALUES($1)',[e]);
  await insert(entry);await insert({...entry,time:1100,telegramDuplicate:true});await insert({...entry,kind:'TP_HIT',targetNumber:1,currentPrice:102,time:1200});
  const one=new CurrentSignalRecords({pool}),two=new CurrentSignalRecords({pool});await one.init();await two.init();await Promise.all([one.sync(),two.sync()]);
  let saved=await one.read();a.equal(saved.records.length,1);a.equal(saved.records[0].hitTp1,true);a.equal(saved.totals[0].open,1);
  const cursor=(await pool.query('SELECT last_event_id FROM zencore_signal_record_cursor')).rows[0].last_event_id;
  await insert({...entry,kind:'CLOSE',percent:100,time:1300});
  let fail=true;const broken=new CurrentSignalRecords({pool:{connect:async()=>{const c=await pool.connect();return {release:()=>c.release(),query:async(sql,args)=>{if(fail&&sql.startsWith('INSERT INTO zencore_current_signal_records')){fail=false;throw Error('simulated write failure');}return c.query(sql,args);}}}}});
  await a.rejects(broken.sync());a.equal((await pool.query('SELECT last_event_id FROM zencore_signal_record_cursor')).rows[0].last_event_id,cursor);a.equal((await one.read()).records[0].state,'OPEN');
  await two.sync();a.equal((await two.read()).records[0].outcome,'CLOSE_SIGNAL');await pool.query('DELETE FROM zencore_analysis_alerts');
  const restarted=new CurrentSignalRecords({pool});await restarted.init();await restarted.sync();saved=await restarted.read();a.equal(saved.records.length,1);a.equal(saved.records[0].hitTp1,true);a.equal(saved.totals[0].resolved,1);
 }finally{await pool?.end();await db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await db.end();}
});
