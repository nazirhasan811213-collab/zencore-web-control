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
