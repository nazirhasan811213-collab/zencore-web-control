'use strict';
const {test}=require('node:test'),a=require('node:assert/strict'),crypto=require('node:crypto'),{Pool}=require('pg'),{PostgresAuthStore}=require('../auth-store'),{PostgresAutoTradeStore}=require('../auto-trade-store'),{createAuthService}=require('../auth-service'),{createAutoTradeService}=require('../auto-trade-service'),{AnalysisAlerts}=require('../analysis-alert-service'),{hashPassword,verifyPassword}=require('../auth-core'),{AccountHandover,canTrade}=require('../account-handover'),M=require('../managed-vps-accounts'),A=require('../account-access');
const url=process.env.ZENCORE_ALERT_TEST_DATABASE_URL;
test('real handover lifecycle, onboarding atomicity and safe account reset preserve other users',{skip:!url,timeout:30000},async()=>{
 const schema='handover_'+crypto.randomBytes(8).toString('hex'),db=new Pool({connectionString:url});let store,alerts;
 try{
  await db.query(`CREATE SCHEMA ${schema}`);store=new PostgresAuthStore(url);await store.pool.end();store.pool=new Pool({connectionString:url,options:`-c search_path=${schema}`});await store.init();const pool=store.pool;
  const admin=await store.createUser({displayName:'Admin',email:'admin@example.test',role:'admin',passwordHash:await hashPassword('Admin2026!')}),legacy=await store.createUser({displayName:'Legacy',email:'legacy@example.test',passwordHash:await hashPassword('Legacy2026!')});
  await M.bootstrap(pool,{batch:M.BATCH});const tradeStore=new PostgresAutoTradeStore(url);await tradeStore.pool.end();tradeStore.pool=pool;await tradeStore.init();alerts=new AnalysisAlerts({pool});await alerts.init();
  const service=createAutoTradeService({store:tradeStore,commandSigningKey:'test-signing-key-more-than-32-characters',allowDemoExecution:true,allowedDemoOwnershipModes:['TRADER_OWNED_EA_LOCAL'],entryAccessAllowed:async id=>{const u=await store.findUserByIdForLogin(id);return A.allowed(u)&&canTrade(u);}});
  const ten=await M.findUser(store,'ZCuser 10');for(const uid of [ten.id,legacy.id])await pool.query("INSERT INTO zencore_autotrade_profiles(user_id,desired_state,effective_state) VALUES($1,'ON','ON')",[uid]);const h=new AccountHandover({pool,tradingState:id=>service.state(id)});await h.init();a.equal((await tradeStore.getProfile(ten.id)).desiredState,'STOPPED');a.equal((await tradeStore.getProfile(legacy.id)).desiredState,'ON');const u=await M.findUser(store,'ZCuser 1'),id=u.id,auth=createAuthService({store,secureCookies:false});
  a.equal((await h.status(id)).state,'ADMIN_SETUP');a.equal((await h.status(legacy.id)).state,'LIVE');
  const complete={generation:0,displayName:'New Trader',email:'newtrader@example.test',phone:'0123456789',newPassword:'NewTrader2026!',confirmPassword:'NewTrader2026!'};
  await a.rejects(h.complete(id,complete),e=>e.status===409);await a.rejects(h.release(admin,id),e=>e.status===409);
  const paired=await service.connectLocalEa(id),podToken=paired.podToken;
  const beat={accountMask:'****1234',serverMask:'****Demo',brokerMask:'****Stellar',tradeMode:'DEMO',terminalTradeAllowed:true,accountTradeAllowed:true,expertTradeAllowed:true,demoExecutionUnlocked:true,connectorVersion:'1.3.0-ea-local',positions:[]};
  const lease=await service.heartbeat(podToken,beat);a.equal(lease.desiredState,'STOPPED');
  await service.saveSettings(id,{capitalUsd:200,lotPerLayer:.01,layers:2,symbols:['XAUUSD'],strategyMode:'TF2_SCALPING',riskAcknowledged:true});
  a.equal((await service.state(id)).control.canTurnOn,false);await a.rejects(service.turnOn(id,{confirmation:'AKTIFKAN DEMO'}),{code:'ACCOUNT_NOT_LIVE'});
  a.equal((await h.release(admin,id)).state,'USER_PROFILE');const old=await auth.login({email:'ZCuser 1',password:'zc123'}),oldCookie=auth.createCookie(old.token);
  const podBefore=await tradeStore.getPodForUser(id);await a.rejects(h.complete(id,{...complete,newPassword:'zc123',confirmPassword:'zc123'}),e=>e.status===400);
  await h.complete(id,complete);a.equal(await auth.sessionFromRequest({headers:{cookie:oldCookie}}),null);a.equal((await tradeStore.getPodForUser(id)).id,podBefore.id);a.equal((await h.status(id)).state,'LIVE');await h.init();a.equal((await h.status(id)).state,'LIVE');
  await a.rejects(auth.login({email:'ZCuser 1',password:'zc123'}),{code:'INVALID_CREDENTIALS'});a.equal((await auth.login({email:'ZCuser 1',password:'NewTrader2026!'})).user.id,id);const fresh=await M.findUser(store,'ZCuser 1');a.equal(+new Date(fresh.access_expires_at)-(+new Date(fresh.access_activated_at)),A.DURATION_MS);
  await alerts.put(id,{verified:true,telegramEnabled:true,telegramId:'123456'});await alerts.put(legacy.id,{verified:true,telegramEnabled:true,telegramId:'987654'});
  await pool.query("INSERT INTO zencore_mt5_positions(user_id,ticket,data) VALUES($1,'test','{}')",[id]);await a.rejects(h.reset(admin,id,{confirmation:'RESET'}),e=>e.status===409&&/posisi/.test(e.message));await pool.query('DELETE FROM zencore_mt5_positions WHERE user_id=$1',[id]);
  await pool.query("UPDATE zencore_mt5_secure_pods SET last_seen_at=NOW()-INTERVAL '1 minute' WHERE user_id=$1",[id]);await a.rejects(h.reset(admin,id,{confirmation:'RESET'}),e=>e.status===409&&/offline/.test(e.message));await pool.query('UPDATE zencore_mt5_secure_pods SET last_seen_at=NOW() WHERE user_id=$1',[id]);
  await pool.query("UPDATE zencore_autotrade_profiles SET desired_state='ON' WHERE user_id=$1",[id]);await a.rejects(h.reset(admin,id,{confirmation:'RESET'}),e=>e.status===409&&/STOP/.test(e.message));await pool.query("UPDATE zencore_autotrade_profiles SET desired_state='STOPPED' WHERE user_id=$1",[id]);
  const cmd=crypto.randomUUID();await pool.query("INSERT INTO zencore_autotrade_commands(id,user_id,pod_id,command_type,signature,signed_envelope,expires_at) VALUES($1,$2,$3,'PLACE_SETUP',$4,'{}',NOW()+INTERVAL '1 minute')",[cmd,id,podBefore.id,'a'.repeat(64)]);await a.rejects(h.reset(admin,id,{confirmation:'RESET'}),e=>e.status===409&&/arahan/.test(e.message));await pool.query('DELETE FROM zencore_autotrade_commands WHERE id=$1',[cmd]);
  await pool.query('UPDATE zencore_mt5_secure_pods SET last_seen_at=NOW() WHERE user_id=$1',[id]);const reset=await h.reset(admin,id,{confirmation:'RESET'});a.equal(reset.state,'ADMIN_SETUP');const row=await M.findUser(store,'ZCuser 1');a.equal(row.display_name,'ZCuser 1');a.equal(row.phone,null);a.equal(row.ic_number,null);a.equal(row.handover_generation,1);a.ok(await verifyPassword('zc123',row.password_hash));a.equal(await tradeStore.getProfile(id),null);a.equal((await alerts.get(id)).verified,false);a.equal((await alerts.get(legacy.id)).verified,true);a.equal((await store.findUserForLogin(legacy.email)).display_name,'Legacy');
  await a.rejects(service.heartbeat(podToken,beat));a.equal((await pool.query('SELECT * FROM zencore_account_resets WHERE user_id=$1',[id])).rowCount,1);await a.rejects(h.complete(id,complete),e=>e.status===409);
  // One admin action waits for a reset-aware EA before clearing the client account.
  const client2=await M.findUser(store,'ZCuser 2'),id2=client2.id,h2=new AccountHandover({pool,tradingState:id=>service.state(id),stopTrading:(id,reset)=>service.stop(id,reset)});
  await h2.init();const pair2=await service.connectLocalEa(id2);await service.heartbeat(pair2.podToken,beat);
  await service.saveSettings(id2,{capitalUsd:200,lotPerLayer:.01,layers:2,symbols:['XAUUSD'],strategyMode:'TF2_SCALPING',riskAcknowledged:true});
  await pool.query("UPDATE zencore_autotrade_profiles SET desired_state='ON',effective_state='ON' WHERE user_id=$1",[id2]);
  await service.heartbeat(pair2.podToken,{...beat,positions:[{ticket:'987654',symbol:'XAUUSD',side:'BUY',volume:.01,entry:2500}]});
  let job=await h2.masterReset(admin,id2,{confirmation:'RESET',closeAllAccount:true,resetPolicy:'MASTER_RESET_FORCE_V2'});a.equal(job.pending,true);
  await a.rejects(service.turnOn(id2,{}),{code:'MASTER_RESET_PENDING'});
  let resetCommand=(await service.nextCommand(pair2.podToken)).command;a.equal(resetCommand.type,'SYSTEM_STOP');a.equal(resetCommand.payload.masterResetVersion,'MASTER_RESET_FORCE_V2');
  await service.acknowledgeCommand(pair2.podToken,resetCommand.id,{status:'EXECUTED',code:'STOPPED'});
  await a.rejects(h2.masterReset(admin,id2,{confirmation:'RESET',closeAllAccount:true,resetPolicy:'MASTER_RESET_FORCE_V2',commandId:job.commandId}),/EA 2.19/);
  a.ok(await tradeStore.getPodForUser(id2),'old EA cannot trigger account wipe');
  job=await h2.masterReset(admin,id2,{confirmation:'RESET',closeAllAccount:true,resetPolicy:'MASTER_RESET_FORCE_V2'});resetCommand=(await service.nextCommand(pair2.podToken)).command;
  await service.acknowledgeCommand(pair2.podToken,resetCommand.id,{status:'EXECUTED',code:'MASTER_RESET_FORCE_READY'});
  await service.heartbeat(pair2.podToken,beat);
  const completed=await h2.masterReset(admin,id2,{confirmation:'RESET',closeAllAccount:true,resetPolicy:'MASTER_RESET_FORCE_V2',commandId:job.commandId});a.equal(completed.completed,true);a.equal((await M.findUser(store,'ZCuser 2')).display_name,'ZCuser 2');
  await a.rejects(service.heartbeat(pair2.podToken,beat),{code:'INVALID_POD_TOKEN'});
  await pool.query("UPDATE zencore_users SET display_name='Next Client' WHERE id=$1",[id2]);
  a.equal((await h2.masterReset(admin,id2,{confirmation:'RESET',closeAllAccount:true,resetPolicy:'MASTER_RESET_FORCE_V2',commandId:job.commandId})).completed,true);a.equal((await M.findUser(store,'ZCuser 2')).display_name,'Next Client','replayed completion cannot reset next owner');

  // Offline/expired reset is explicitly a logical disconnect, never a broker-close claim.
  const third=await M.findUser(store,'ZCuser 3'),id3=third.id,pair3=await service.connectLocalEa(id3);
  await service.heartbeat(pair3.podToken,beat);await service.saveSettings(id3,{capitalUsd:200,lotPerLayer:.01,layers:2,symbols:['XAUUSD'],strategyMode:'TF2_SCALPING',riskAcknowledged:true});
  await pool.query("UPDATE zencore_autotrade_profiles SET desired_state='ON',effective_state='ON' WHERE user_id=$1",[id3]);
  await pool.query("INSERT INTO zencore_mt5_positions(user_id,ticket,data) VALUES($1,'unconfirmed','{}')",[id3]);
  await a.rejects(h2.reset(admin,id3,{confirmation:'RESET',abandonExecution:true,release:true}),/STOP/,'JSON cannot bypass normal reset guards');
  const expired=crypto.randomUUID(),pod3=await tradeStore.getPodForUser(id3);
  await pool.query("INSERT INTO zencore_autotrade_commands(id,user_id,pod_id,command_type,payload,signature,signed_envelope,expires_at) VALUES($1,$2,$3,'SYSTEM_STOP',$4::jsonb,$5,'{}',NOW()-INTERVAL '1 minute')",[expired,id3,pod3.id,JSON.stringify({masterResetVersion:'MASTER_RESET_FORCE_V2',masterResetScope:'ALL_ACCOUNT',masterResetGeneration:0}),'a'.repeat(64)]);
  await pool.query("UPDATE zencore_mt5_secure_pods SET last_seen_at=NOW()-INTERVAL '5 minutes' WHERE user_id=$1",[id3]);
  const releaseRequest={confirmation:'RESET',closeAllAccount:true,resetPolicy:'MASTER_RESET_RELEASE_V3',allowUnconfirmedDisconnect:true,resetGeneration:0};
  const released=await h2.masterReset(admin,id3,releaseRequest);a.equal(released.completed,true);a.equal(released.brokerCloseConfirmed,false);a.match(released.message,/BROKER BELUM DISAHKAN/);a.equal(released.generation,1);
  a.equal((await pool.query('SELECT 1 FROM zencore_autotrade_commands WHERE user_id=$1',[id3])).rowCount,0);a.equal((await store.findUserForLogin(legacy.email)).display_name,'Legacy');
  a.equal((await store.findUserForLogin('zcuser3@managed.zencore.invalid')).display_name,'ZCuser 3');a.equal(await tradeStore.getProfile(id3),null);a.equal((await tradeStore.listPositions(id3)).length,0);
  await a.rejects(service.heartbeat(pair3.podToken,beat),{code:'INVALID_POD_TOKEN'});await a.rejects(service.connectLocalEa(id3),{code:'LINK_RESET_WAIT'});
  // A new setup is accepted after lease drain; an old request cannot erase it.
  await pool.query("UPDATE zencore_mt5_secure_pods SET revoked_at=NOW()-INTERVAL '31 seconds' WHERE user_id=$1",[id3]);
  const new3=await service.connectLocalEa(id3);await service.heartbeat(new3.podToken,beat);await service.saveSettings(id3,{capitalUsd:500,lotPerLayer:.02,layers:1,symbols:['XAUUSD'],strategyMode:'TF2_SCALPING',riskAcknowledged:true});
  a.equal((await h2.masterReset(admin,id3,releaseRequest)).brokerCloseConfirmed,false);a.equal((await tradeStore.getProfile(id3)).capitalUsd,500);a.equal((await tradeStore.getPodForUser(id3)).id,new3.podId);
  a.equal((await h2.masterReset(admin,id3,{...releaseRequest,commandId:expired})).brokerCloseConfirmed,false);

 }finally{if(alerts){clearInterval(alerts.timer);clearInterval(alerts.cleanupTimer);}await store?.close();await db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await db.end();}
});
