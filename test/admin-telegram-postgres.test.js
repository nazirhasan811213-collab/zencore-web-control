'use strict';
const {test}=require('node:test'),a=require('node:assert/strict'),crypto=require('node:crypto'),{Pool}=require('pg');
const {AdminTelegram}=require('../admin-telegram-service');
const url=process.env.ZENCORE_ALERT_TEST_DATABASE_URL;
test('admin messages freeze recipients, queue once, recheck preferences and survive interruptions',{skip:!url},async()=>{
 const schema='admin_tg_'+crypto.randomBytes(8).toString('hex'),db=new Pool({connectionString:url});let pool;
 try{
  await db.query(`CREATE SCHEMA ${schema}`);pool=new Pool({connectionString:url,options:`-c search_path=${schema}`});
  await pool.query(`CREATE TABLE zencore_users(id uuid PRIMARY KEY,display_name text,email text,role text,status text,access_expires_at timestamptz,ib_referrer_id uuid);
   CREATE TABLE zencore_ib_referrers(id uuid PRIMARY KEY,code text,display_name text,user_id uuid);
   CREATE TABLE zencore_alert_preferences(user_id uuid PRIMARY KEY,data jsonb);`);
  const ids=Array.from({length:8},()=>crypto.randomUUID()),actor={id:ids[0],role:'admin',status:'active'},ibId=crypto.randomUUID();
  for(let i=0;i<ids.length;i++){
   await pool.query('INSERT INTO zencore_users VALUES($1,$2,$3,$4,$5,$6,$7)',[ids[i],'User '+i,i+'@test.invalid',i===0?'admin':i===1?'ib':'client',i===4?'disabled':'active',i===4?new Date(0):null,i>1?ibId:null]);
   await pool.query('INSERT INTO zencore_alert_preferences VALUES($1,$2)',[ids[i],{verified:true,telegramEnabled:true,telegramId:String(123450+i)}]);
  }
  await pool.query('INSERT INTO zencore_ib_referrers VALUES($1,$2,$3,$4)',[ibId,'testib','IB',ids[1]]);
  const calls=[],alerts={token:'TEST_ONLY',telegram:async(chat,text)=>{calls.push({chat,text});if(chat==='123455')throw Error('simulated ambiguous timeout');}};
  const svc=new AdminTelegram({pool,alerts});await svc.init({start:false});
  const p=await svc.preview(actor,{mode:'MULTI',userIds:[ids[2],ids[3],ids[4]],message:'Test only'});
  a.equal(p.ready,3);a.equal(JSON.stringify(p).includes('123452'),false);
  await a.rejects(svc.send({...actor,id:ids[1]},p.draftId),{status:404});
  const queued=await Promise.all([svc.send(actor,p.draftId),svc.send(actor,p.draftId)]);a.equal(queued.filter(x=>x.alreadyQueued).length,1);
  a.equal((await pool.query('SELECT * FROM zencore_admin_telegram_targets')).rowCount,3);
  await pool.query("UPDATE zencore_alert_preferences SET data=data||'{\"telegramEnabled\":false}'::jsonb WHERE user_id=$1",[ids[3]]);
  const other=new AdminTelegram({pool,alerts});await Promise.all([svc.drain(),other.drain()]);
  a.equal(calls.length,2);a.ok(calls.some(c=>c.chat==='123454'),'disabled/expired user receives admin notice');
  let h=(await svc.history(actor)).jobs[0];a.equal(h.sent,2);a.equal(h.skipped,1);a.equal(h.pending,0);
  const detail=await svc.details(actor,p.draftId);a.equal(detail.recipients.length,3);a.equal(JSON.stringify(detail).includes('chat_id'),false);
  // Scope changes after preview must exclude the user at delivery; new members are never added.
  const ib=await svc.preview(actor,{mode:'IB',ibId,ibScope:'CLIENTS',message:'IB notice'});
  await pool.query('UPDATE zencore_users SET ib_referrer_id=NULL WHERE id=$1',[ids[2]]);
  await svc.send(actor,ib.draftId);await svc.drain();await svc.drain();
  const ibDetails=(await svc.details(actor,ib.draftId)).recipients;
  a.equal(ibDetails.find(x=>x.user_id===ids[2]).status,'skipped');a.equal(ibDetails.find(x=>x.user_id===ids[5]).status,'failed');
  const count=calls.length;await svc.drain();a.equal(calls.length,count,'ambiguous sends are not retried');
  // A process dying after claiming a delivery leaves an explicit unknown result, never a retry.
  const interrupted=await svc.preview(actor,{mode:'SINGLE',userIds:[ids[6]],message:'Interrupt'});await svc.send(actor,interrupted.draftId);
  await pool.query("UPDATE zencore_admin_telegram_targets SET status='sending',updated_at=NOW()-INTERVAL '3 minutes' WHERE job_id=$1",[interrupted.draftId]);await svc.drain();
  a.equal((await svc.details(actor,interrupted.draftId)).recipients[0].status,'unknown');a.equal(calls.length,count);
  const disabled=await svc.preview(actor,{mode:'SINGLE',userIds:[ids[6]],message:'Sender disabled'});await svc.send(actor,disabled.draftId);
  await pool.query("UPDATE zencore_users SET status='disabled' WHERE id=$1",[actor.id]);await svc.drain();a.equal(calls.length,count);a.equal((await svc.details(actor,disabled.draftId)).recipients[0].result,'ADMIN_DISABLED');
  const expired=await svc.preview(actor,{mode:'SINGLE',userIds:[ids[6]],message:'Expired preview'});await pool.query("UPDATE zencore_admin_telegram_jobs SET expires_at=NOW()-INTERVAL '1 second' WHERE id=$1",[expired.draftId]);await a.rejects(svc.send(actor,expired.draftId),{status:409});
 }finally{await pool?.end();await db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await db.end();}
});
