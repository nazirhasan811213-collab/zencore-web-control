const test=require('node:test'),assert=require('node:assert/strict');
const {createCoalescingDispatcher}=require('../coalescing-dispatcher');
test('market received during dispatch is refreshed immediately without overlapping orders',async()=>{
 let release,latest='old',active=0,max=0;const seen=[];
 const wait=new Promise(r=>release=r);
 const tick=createCoalescingDispatcher(async()=>{active++;max=Math.max(max,active);seen.push(latest);if(seen.length===1)await wait;active--;});
 const first=tick();latest='fresh';await tick();latest='newest';await tick();release();await first;
 assert.deepEqual(seen,['old','newest']);assert.equal(max,1);
});
test('dispatch failure retains pending fresh snapshot and recovers',async()=>{
 let release,calls=0;const errors=[];const wait=new Promise(r=>release=r);
 const tick=createCoalescingDispatcher(async()=>{calls++;if(calls===1){await wait;throw Error('temporary');}},e=>errors.push(e.message));
 const first=tick();await tick();release();await first;assert.equal(calls,2);assert.deepEqual(errors,['temporary']);
 await tick();assert.equal(calls,3);
});
