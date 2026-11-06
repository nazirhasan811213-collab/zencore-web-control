'use strict';const {test}=require('node:test'),a=require('node:assert/strict'),H=require('../account-handover'),A=require('../account-access');
test('handover permits pairing during admin setup but blocks client app/entry until profile is complete',()=>{
 for(const state of ['ADMIN_SETUP','USER_PROFILE']){const u={status:'active',role:'client',handover_state:state,access_expires_at:new Date(0)};a.equal(A.expired(u),false);a.equal(H.canTrade(u),false);a.equal(H.allowedPath('/app',state),false);a.equal(H.allowedPath('/api/auto-trade/on',state),false);a.equal(H.allowedPath('/api/auto-trade/settings',state),false);a.equal(H.allowedPath('/api/account/handover',state),true);}
 a.equal(H.allowedPath('/api/auto-trade/ea-connect','ADMIN_SETUP'),true);a.equal(H.allowedPath('/api/auto-trade/ea-connect','USER_PROFILE'),false);
 a.equal(H.canTrade({role:'client',handover_state:'LIVE'}),true);a.equal(H.canTrade({role:'client'}),true);a.equal(H.canTrade({role:'ib',handover_state:'ADMIN_SETUP'}),true);
});
test('only an active admin may release or reset; resetting requires explicit typed confirmation',async()=>{const h=new H.AccountHandover({pool:{connect:()=>{throw Error('must not connect')}}});for(const actor of [{role:'client',status:'active'},{role:'ib',status:'active'},{role:'admin',status:'disabled'}]){await a.rejects(h.release(actor,'id'),e=>e.status===403);await a.rejects(h.reset(actor,'id',{confirmation:'RESET'}),e=>e.status===403);}await a.rejects(h.reset({role:'admin',status:'active'},'id',{confirmation:''}),e=>e.status===400);});

test('Errante admin cannot release without verified local VPS setup',async()=>{
 const c={query:async sql=>sql.startsWith('SELECT * FROM zencore_users')?{rows:[{role:'client',status:'active',handover_state:'ADMIN_SETUP'}]}:{rows:[]},release(){}};
 const h=new H.AccountHandover({pool:{connect:async()=>c},requireVps:true,tradingState:async()=>({connection:{ready:true},setupConnection:{ready:false},pod:{}})});
 await a.rejects(h.release({role:'admin',status:'active'},'id'),e=>e.status===409&&/Connector dan EA/.test(e.message));
});
test('Errante hands off only Auto Trade without changing existing login or access expiry',async()=>{
 const u={role:'client',status:'active',handover_state:'ADMIN_SETUP',display_name:'Trader Lama',email:'client@example.test',password_hash:'unchanged',access_expires_at:new Date(2000000000000)};
 const writes=[];
 const query=async sql=>{
  if(sql.startsWith('SELECT * FROM zencore_users'))return {rows:[u]};
  if(sql.startsWith('UPDATE')){writes.push(sql);u.handover_state='LIVE';}
  return {rows:[]};
 };
 const h=new H.AccountHandover({pool:{query,connect:async()=>({query,release(){}})},requireVps:true,now:()=>1790000000000,tradingState:async()=>({setupConnection:{ready:true},pod:{},positions:[],control:{effectiveState:'STOPPED',desiredState:'STOPPED'},settings:{capitalUsd:200,lotPerLayer:.01,layers:2,symbols:['XAUUSD'],strategyMode:'TF2_SCALPING',riskAcknowledged:true,riskAcknowledgedAt:1}})});
 for(const stage of ['ADMIN_SETUP','USER_PROFILE']){
  a.equal(H.allowedVpsAutoTrade('/api/auto-trade/settings',stage,'PUT'),false);
 }
 a.equal(H.allowedVpsAutoTrade('/api/auto-trade/ea-connect','ADMIN_SETUP','POST'),true);
 a.equal((await h.release({role:'admin',status:'active'},'id')).state,'LIVE');
 a.equal(H.allowedVpsAutoTrade('/api/auto-trade/settings',u.handover_state,'PUT'),true);
 a.equal(writes.length,1);
 a.doesNotMatch(writes[0],/password_hash|access_expires_at|display_name|email/);
 await a.rejects(h.complete('id',{}),{status:405});
});
