'use strict';
const {test}=require('node:test'),a=require('node:assert/strict');
const {MemoryAutoTradeStore}=require('../auto-trade-store'),{createAutoTradeService}=require('../auto-trade-service');
const {AccountHandover}=require('../account-handover');
const settings={capitalUsd:200,lotPerLayer:.01,layers:2,symbols:['XAUUSD'],riskAcknowledged:true};
const hb={accountMask:'****1234',serverMask:'****Demo',brokerMask:'****MT5',tradeMode:'DEMO',terminalTradeAllowed:true,accountTradeAllowed:true,expertTradeAllowed:true,demoExecutionUnlocked:true,connectorVersion:'1.4.0-ea-local',accountFingerprint:'a'.repeat(64),positions:[]};
test('master stop is signed, disables entry and manual adoption, locks ON/settings and leaves other clients intact',async()=>{
 const store=new MemoryAutoTradeStore(),service=createAutoTradeService({store,commandSigningKey:'test-signing-key-more-than-32-characters',allowDemoExecution:true,allowedDemoSymbols:['XAUUSD']});
 const first=await service.connectLocalEa('one'),second=await service.connectLocalEa('two');
 for(const [id,token]of [['one',first.podToken],['two',second.podToken]]){await service.heartbeat(token,hb);await service.saveSettings(id,settings);await store.setControl(id,{desiredState:'ON',effectiveState:'ON'});}
 const stopped=await service.stop('one',{generation:3,closeAllAccount:true});a.equal(stopped.control.desiredState,'STOPPED');
 const command=(await service.nextCommand(first.podToken)).command;a.equal(command.type,'SYSTEM_STOP');a.equal(command.payload.masterResetVersion,'MASTER_RESET_FORCE_V2');a.equal(command.payload.masterResetGeneration,3);
 a.equal(JSON.parse(Buffer.from(command.signedEnvelope,'base64url')).payload.masterResetVersion,'MASTER_RESET_FORCE_V2');
 await a.rejects(service.turnOn('one',{}),{code:'MASTER_RESET_PENDING'});await a.rejects(service.saveSettings('one',settings),{code:'MASTER_RESET_PENDING'});
 a.equal((await store.getProfile('two')).desiredState,'ON');a.equal((await store.getProfile('one')).manualExit.enabled,false);
 await service.acknowledgeCommand(first.podToken,command.id,{status:'EXECUTED',code:'MASTER_RESET_FORCE_READY'});
 await a.rejects(service.turnOn('one',{}),{code:'MASTER_RESET_PENDING'});
 a.equal((await store.masterResetCommand('two')),null);
});
test('forced master reset queues account-wide close with live positions and never clears them before EA proof',async()=>{
 const store=new MemoryAutoTradeStore(),service=createAutoTradeService({store,commandSigningKey:'test-signing-key-more-than-32-characters',allowDemoExecution:true});
 const paired=await service.connectLocalEa('one');await service.heartbeat(paired.podToken,hb);
 await store.replacePositions('one',[{ticket:'123',symbol:'XAUUSD',side:'BUY',volume:.01,entry:100}],Date.now());
 await a.rejects(service.stop('one',{generation:0}),{code:'MASTER_RESET_CONFIRMATION_REQUIRED'});
 await service.stop('one',{generation:0,closeAllAccount:true});
 const command=(await service.nextCommand(paired.podToken)).command;
 a.equal(command.payload.masterResetVersion,'MASTER_RESET_FORCE_V2');a.equal(command.payload.masterResetScope,'ALL_ACCOUNT');
 a.equal((await store.listPositions('one')).length,1,'only broker reports may clear positions');
 await service.acknowledgeCommand(paired.podToken,command.id,{status:'FAILED',code:'MASTER_RESET_CLOSE_FAILED'});
 await a.rejects(service.turnOn('one',{}),{code:'MASTER_RESET_PENDING'},'partial/failed reset cannot silently resume entry');
});
test('only confirmed active admin can invoke master reset',async()=>{
 const h=new AccountHandover({pool:{query:()=>{throw Error('must not query')}}});
 for(const role of ['client','ib'])await a.rejects(h.masterReset({role,status:'active'},'id',{confirmation:'RESET'}),e=>e.status===403);
 await a.rejects(h.masterReset({role:'admin',status:'active'},'id',{}),e=>e.status===400);
 await a.rejects(h.masterReset({role:'admin',status:'active'},'id',{confirmation:'RESET'}),e=>e.status===400,'old cached confirmation cannot authorize liquidation');
});

test('unconfirmed release needs explicit admin fallback consent and a current generation',async()=>{
 const h=new AccountHandover({pool:{query:()=>{throw Error('must not query')}}});
 const actor={role:'admin',status:'active'};
 for(const extra of [{resetGeneration:0},{allowUnconfirmedDisconnect:true},{allowUnconfirmedDisconnect:true,resetGeneration:-1}])
  await a.rejects(h.masterReset(actor,'one',{confirmation:'RESET',closeAllAccount:true,resetPolicy:'MASTER_RESET_RELEASE_V3',...extra}),e=>e.status===400);
});
test('expired/unresponsive commands may release only logical state and V2 never silently falls back',async()=>{
 const at=1791000000000,actor={role:'admin',status:'active'},id='11111111-1111-4111-8111-111111111111',commandId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 let status='PENDING',expires=at-1,created=at-1000,resetCalls=0;
 const pool={query:async sql=>{
  if(sql.includes('FROM zencore_account_resets'))return {rows:[]};
  if(sql.startsWith('SELECT * FROM zencore_users'))return {rows:[{id,role:'client',handover_generation:0}]};
  if(sql.startsWith('SELECT * FROM zencore_mt5_secure_pods'))return {rows:[{id:'pod',ownership_mode:'TRADER_OWNED_EA_LOCAL',last_seen_at:new Date(at)}]};
  if(sql.startsWith('SELECT * FROM zencore_autotrade_commands'))return {rows:[{id:commandId,status,created_at:new Date(created),expires_at:new Date(expires),payload:{masterResetVersion:'MASTER_RESET_FORCE_V2',masterResetScope:'ALL_ACCOUNT',masterResetGeneration:0}}]};
  throw Error('unexpected query');
 }};
 const h=new AccountHandover({pool,now:()=>at});h.reset=async(actor,user,input,release)=>{resetCalls++;a.equal(typeof release.key,'symbol');a.equal(release.generation,0);a.equal(release.podId,'pod');return {ok:true,brokerCloseConfirmed:false};};
 const body={confirmation:'RESET',closeAllAccount:true,resetPolicy:'MASTER_RESET_FORCE_V2',commandId};
 await a.rejects(h.masterReset(actor,id,body),/Arahan luput/);a.equal(resetCalls,0);
 const fallback={...body,resetPolicy:'MASTER_RESET_RELEASE_V3',allowUnconfirmedDisconnect:true,resetGeneration:0};
 a.equal((await h.masterReset(actor,id,fallback)).brokerCloseConfirmed,false);a.equal(resetCalls,1);
 expires=at+120000;created=at-20000;
 a.equal((await h.masterReset(actor,id,fallback)).brokerCloseConfirmed,false);a.equal(resetCalls,2);
 status='DELIVERED';a.equal((await h.masterReset(actor,id,fallback)).pending,true);a.equal(resetCalls,2);
 created=at-31000;a.equal((await h.masterReset(actor,id,fallback)).brokerCloseConfirmed,false);a.equal(resetCalls,3);
});
test('replayed old-generation offline release returns its receipt without touching a newer client setup',async()=>{
 let queries=0;
 const pool={query:async(sql,args)=>{queries++;if(sql.startsWith('SELECT * FROM zencore_users'))return {rows:[{id:'one',role:'client',handover_generation:1}]};if(sql.includes('FROM zencore_account_resets'))return {rows:[{generation:1,broker_close_confirmed:false}]};throw Error('must not inspect/revoke new pod');}};
 const h=new AccountHandover({pool});const out=await h.masterReset({role:'admin',status:'active'},'one',{confirmation:'RESET',closeAllAccount:true,resetPolicy:'MASTER_RESET_RELEASE_V3',allowUnconfirmedDisconnect:true,resetGeneration:0});
 a.equal(out.completed,true);a.equal(out.brokerCloseConfirmed,false);a.match(out.message,/BROKER BELUM DISAHKAN/);a.equal(queries,2);
});
test('slot reset binding refuses an old token epoch before touching current client settings',async()=>{
 const store=new MemoryAutoTradeStore(),service=createAutoTradeService({store,commandSigningKey:'test-signing-key-more-than-32-characters',allowDemoExecution:true});
 const p=await service.connectLocalEa('one');await service.heartbeat(p.podToken,hb);await service.saveSettings('one',settings);
 const before=await store.getProfile('one');await a.rejects(service.stop('one',{generation:0,closeAllAccount:true,expectedPodTokenHash:'f'.repeat(64)}),{code:'ACCOUNT_BINDING_CHANGED'});
 a.deepEqual(await store.getProfile('one'),before);a.equal(await store.masterResetCommand('one'),null);
});
