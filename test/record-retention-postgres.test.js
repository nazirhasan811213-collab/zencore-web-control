'use strict';
const {test}=require('node:test'),a=require('node:assert/strict'),crypto=require('node:crypto'),{Pool}=require('pg');
const {CurrentSignalRecords,applyEvent,idFor}=require('../current-signal-records'),{SignalOutcomeStore}=require('../signal-outcome-store'),R=require('../record-retention');
const url=process.env.ZENCORE_ALERT_TEST_DATABASE_URL;
test('PG purges both record stores, blocks old replay and applies cutoff to totals and statistics',{skip:!url},async()=>{
 const db=new Pool({connectionString:url}),schema='retention_'+crypto.randomBytes(8).toString('hex');let pool,clock=Date.parse('2026-11-04T08:00:00+08:00');const now=()=>clock,log={log:()=>{},warn:()=>{}};
 try{
  await db.query(`CREATE SCHEMA ${schema}`);pool=new Pool({connectionString:url,options:`-c search_path=${schema}`});
  await pool.query('CREATE TABLE zencore_analysis_alerts(id BIGSERIAL PRIMARY KEY,data JSONB NOT NULL)');
  const entry=(key,time)=>({kind:'ENTRY',symbol:'XAUUSD',timeframe:'2',setupKey:key,side:'BUY',time,telegramPlan:{entry:100,sl:98,tp1:102,tp2:104,tp3:106}});
  const old=entry('old',R.START_AT-1),boundary=entry('boundary',R.START_AT),current=new CurrentSignalRecords({pool,now,log});await current.init();
  // Seed a record from the old deployment, then enforce the policy on startup.
  const rows=new Map();applyEvent(rows,old);const r=rows.get(idFor(old));
  await pool.query('INSERT INTO zencore_current_signal_records(id,symbol,timeframe,state,opened_at,resolved_at,data) VALUES($1,$2,$3,$4,$5,$6,$7)',[r.id,r.symbol,r.timeframe,r.state,r.openedAt,r.resolvedAt,r]);
  await current.init();a.equal((await pool.query('SELECT COUNT(*)::int AS n FROM zencore_current_signal_records')).rows[0].n,0);
  for(const e of [old,boundary])await pool.query('INSERT INTO zencore_analysis_alerts(data) VALUES($1)',[e]);await current.sync();
  let view=await current.read();a.equal(view.records.length,1);a.equal(view.records[0].openedAt,R.START_AT);a.equal(view.totals[0].sample,1);
  const closed=(id,openedAt)=>({id,symbol:'XAUUSD',mode:'NORMAL',side:'BUY',state:'CLOSED',openedAt,resolvedAt:openedAt+1,entry:100,sl:98,tp1:102,tp2:104,tp3:106,outcome:'TP1',hitTp1:true});
  let recent=[closed('archive-old',R.START_AT-10),closed('archive-boundary',R.START_AT)];
  const archive=new SignalOutcomeStore({pool,now,log,fetchSummary:async symbol=>({ok:true,symbol,mode:'NORMAL',summary:{recent:symbol==='XAUUSD'?recent:[]}})});await archive.init();await archive.sync();
  a.equal((await archive.read()).records.length,1);a.equal((await archive.targetStats('XAUUSD','BUY')).sample,1);
  clock=Date.parse('2027-02-02T00:00:00+08:00');const fresh=entry('fresh',clock-1000);recent.push(closed('archive-fresh',clock-1000));
  await pool.query('INSERT INTO zencore_analysis_alerts(data) VALUES($1)',[fresh]);await current.sync();await archive.sync();
  view=await current.read();a.equal(view.records.length,1);a.equal(view.records[0].setupKey,'fresh');a.equal(view.totals[0].sample,1);
  a.equal((await archive.read()).records[0].id,'archive-fresh');a.equal((await archive.read()).totals[0].sample,1);a.equal((await archive.targetStats('XAUUSD','BUY')).sample,1);
  await pool.query('UPDATE zencore_signal_record_cursor SET last_event_id=0');await current.sync();a.equal((await current.read()).records.length,1,'replay cannot restore purged entry');
  // Reads enforce the same bounds even if cleanup has not run yet.
  await pool.query('UPDATE zencore_current_signal_records SET opened_at=$1',[R.START_AT]);a.equal((await current.read()).records.length,0);a.deepEqual((await current.read()).totals,[]);
  await pool.query('UPDATE zencore_signal_outcomes SET opened_at=$1',[R.START_AT]);a.equal((await archive.read()).records.length,0);a.equal((await archive.targetStats('XAUUSD','BUY')).sample,0);
  await archive.prune();a.equal((await pool.query('SELECT COUNT(*)::int AS n FROM zencore_signal_outcomes')).rows[0].n,0);
 }finally{await pool?.end();await db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await db.end();}
});
