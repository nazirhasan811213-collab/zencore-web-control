'use strict';
const {test}=require('node:test'),a=require('node:assert/strict'),S=require('../admin-vps-setup');
const admin={role:'admin',status:'active'};
test('VPS setup lookup accepts active admin only and exposes no client credentials',async()=>{
 let lookups=0;const store={findUserForLogin:async()=>{lookups++;return {id:'client-id',role:'client',status:'active',handover_state:'ADMIN_SETUP',password_hash:'must-not-leak'};}};
 for(const actor of [{role:'client',status:'active'},{role:'ib',status:'active'},{role:'admin',status:'disabled'}])await a.rejects(S.resolve(actor,store,'ZCuser 11'),e=>e.status===403);
 a.equal(lookups,0);a.deepEqual(await S.resolve(admin,store,'ZCuser 11'),{ok:true,client:{id:'client-id',loginId:'ZCuser 11',state:'ADMIN_SETUP'}});
});
test('admin can pair pending setup without client password; LIVE/profile accounts cannot be silently rebound',async()=>{
 let stage='ADMIN_SETUP',calls=0;const h={row:async()=>({status:'active',handover_state:stage})},service={connectLocalEa:async id=>{calls++;return {id,podToken:'test-only'}}};
 a.equal((await S.connect(admin,h,service,'id')).id,'id');
 for(const next of ['LIVE','USER_PROFILE']){stage=next;await a.rejects(S.connect(admin,h,service,'id'),e=>e.status===409);}
 a.equal(calls,1);
});
