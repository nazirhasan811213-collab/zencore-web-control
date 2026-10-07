'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createReadiness}=require('../service-readiness');
function fixture(query=async()=>({rows:[{alive:1}]})){
 const at=1791000000000,auth={ready:true,store:{pool:{query}}},trading={ready:true,dispatchLastSuccessAt:at};
 return {auth,trading,now:()=>at,webhook:{enforced:true},deadlineMs:15,cacheMs:0};
}
test('readiness performs a real bounded database query; rejects failed and hung pools',async()=>{
 assert.equal((await createReadiness(fixture()).snapshot()).ok,true);
 for(const query of [async()=>{throw Error('PRIVATE_DATABASE_PASSWORD');},()=>new Promise(()=>{})]){
  const result=await createReadiness(fixture(query)).snapshot();assert.equal(result.ok,false);assert.equal(result.database,'UNAVAILABLE');assert.equal(JSON.stringify(result).includes('PRIVATE_DATABASE_PASSWORD'),false);
 }
});
test('readiness rejects stale, future and missing dispatcher heartbeats and unready authentication',async()=>{
 for(const timestamp of [0,1791000000000-30000,1791000000000+1]){const d=fixture();d.trading.dispatchLastSuccessAt=timestamp;assert.equal((await createReadiness(d).snapshot()).ok,false);}
 const d=fixture();d.auth.ready=false;assert.equal((await createReadiness(d).snapshot()).ok,false);
});
test('parallel health probes coalesce and production never substitutes memory for missing database',async()=>{
 let calls=0;const d=fixture(async()=>{calls++;await Promise.resolve();return {};});const check=createReadiness(d);await Promise.all([check.snapshot(),check.snapshot()]);assert.equal(calls,1);
 d.auth.store={};assert.equal((await createReadiness(d).snapshot()).database,'UNAVAILABLE');
 d.allowMemoryDatabase=true;d.webhook.enforced=false;const result=await createReadiness(d).snapshot();assert.equal(result.ok,true);assert.equal(result.webhook,'LEGACY_UNVERIFIED');
});
