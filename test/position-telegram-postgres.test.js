'use strict';
const {test}=require('node:test'),a=require('node:assert/strict'),crypto=require('node:crypto'),{Pool}=require('pg'),{PositionTelegram}=require('../position-telegram');
const url=process.env.ZENCORE_ALERT_TEST_DATABASE_URL;
test('PG personal position outbox batches layers, isolates users, survives restart and never repeats ambiguous sends',{skip:!url},async()=>{
 const schema='position_notice_'+crypto.randomBytes(8).toString('hex'),db=new Pool({connectionString:url});let pool,at=1793800000000;const now=()=>at;
 const u1='11111111-1111-4111-8111-111111111111',u2='22222222-2222-4222-8222-222222222222',fp='a'.repeat(64),pod='33333333-3333-4333-8333-333333333333',cmd='44444444-4444-4444-8444-444444444444',sent=[],prefs=new Map(),pods=new Map(),positions=new Map();let failSend=false;
 try{
  await db.query(`CREATE SCHEMA ${schema}`);pool=new Pool({connectionString:url,options:`-c search_path=${schema}`});await pool.query("CREATE TABLE zencore_users(id UUID PRIMARY KEY,status TEXT,role TEXT,access_expires_at TIMESTAMPTZ,handover_state TEXT,handover_generation INTEGER DEFAULT 0)");
  for(const id of [u1,u2]){await pool.query("INSERT INTO zencore_users(id,status,role,handover_state) VALUES($1,'active','client','LIVE')",[id]);prefs.set(id,{telegramEnabled:true,verified:true,telegramId:id===u1?'123456':'987654'});pods.set(id,{id:pod,accountFingerprint:fp,lastSeenAt:at});}
  const store={setupForPosition:async(user,podId,symbol,mode,setup)=>setup===cmd.slice(0,20)?{id:cmd,podId,userId:user,payload:{side:'BUY',layers:2,accountFingerprint:fp}}:null,getPodForUser:async id=>pods.get(id),listPositions:async id=>positions.get(id)||[]};
  const alerts={token:'fake-token',get:async id=>prefs.get(id),telegram:async(chat,text)=>{sent.push({chat,text});if(failSend)throw Error('ambiguous network timeout');}};
  const make=()=>new PositionTelegram({pool,store,alerts,now,log:{error:()=>{}}}),one=make(),two=make();await one.init();await two.init();
  const p=(n,edit={})=>({ticket:String(n),positionId:String(n),symbol:'XAUUSD',side:'BUY',origin:'ZENCORE',strategyMode:'TF2_SCALPING',setupId:cmd.slice(0,20),entry:4104,volume:.01,activeSl:4100,tp1:4105.5,openedAt:at-1000,...edit});
  const observe=async(svc,user,ps)=>{positions.set(user,ps);pods.get(user).lastSeenAt=at;await svc.observe({userId:user,podId:pod,accountFingerprint:fp,positions:ps,observedAt:at});};
  await observe(one,u1,[p(1)]);await one.drain();a.equal(sent.length,0,'first layer waits briefly for setup layers');at+=2000;await observe(two,u1,[p(1),p(2)]);await Promise.all([one.drain(),two.drain()]);a.equal(sent.length,1);a.equal(sent[0].chat,'123456');a.match(sent[0].text,/2 • 0\.02 lot/);
  await observe(make(),u1,[p(1),p(2)]);await make().drain();a.equal(sent.length,1,'repeated heartbeat and restart cannot repeat setup');
  await observe(one,u2,[p(3),p(4)]);await two.drain();a.equal(sent.length,2);a.equal(sent[1].chat,'987654');
  const manual=(n,edit={})=>p(n,{origin:'MANUAL',setupId:null,...edit});
  await observe(one,u1,[manual(10)]);positions.set(u1,[]);await one.drain();a.equal(sent.length,2,'position already closed is not announced open');
  await observe(one,u1,[manual(11)]);prefs.get(u1).telegramEnabled=false;await one.drain();a.equal(sent.length,2);prefs.get(u1).telegramEnabled=true;
  await observe(one,u1,[manual(12)]);prefs.get(u1).telegramId='555555';await one.drain();a.equal(sent.length,2,'chat change cannot redirect queued financial notification');prefs.get(u1).telegramId='123456';
  await observe(one,u1,[manual(13)]);await pool.query('UPDATE zencore_users SET handover_generation=1 WHERE id=$1',[u1]);await one.drain();a.equal(sent.length,2,'account reset cancels old recipient generation');
  await observe(one,u1,[manual(14)]);pods.get(u1).accountFingerprint='b'.repeat(64);await one.drain();a.equal(sent.length,2);pods.get(u1).accountFingerprint=fp;
  await observe(one,u1,[manual(15)]);failSend=true;await one.drain();a.equal(sent.length,3);failSend=false;await observe(two,u1,[manual(15)]);await two.drain();a.equal(sent.length,3,'ambiguous send is never replayed');
  prefs.get(u1).telegramId='-100123';await observe(one,u1,[manual(16)]);a.equal((await pool.query('SELECT COUNT(*)::int AS n FROM zencore_position_notifications WHERE data->>\'manualId\'=\'16\'')).rows[0].n,0);prefs.get(u1).telegramId='123456';
  await observe(one,u1,[manual(17)]);await pool.query("UPDATE zencore_users SET status='disabled' WHERE id=$1",[u1]);await one.drain();a.equal(sent.length,3);
  await pool.query("UPDATE zencore_users SET status='active',access_expires_at=$2 WHERE id=$1",[u1,new Date(at-1)]);await observe(one,u1,[manual(18)]);await one.drain();a.equal(sent.length,3);
 }finally{await pool?.end();await db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await db.end();}
});
