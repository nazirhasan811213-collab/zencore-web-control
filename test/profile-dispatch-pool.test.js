const test=require('node:test');
const assert=require('node:assert/strict');
const {dispatchProfiles}=require('../profile-dispatch-pool');

test('failed accounts do not skip remaining users and concurrency stays bounded',async()=>{
  let active=0,peak=0;
  const visited=new Set();
  const errors=await dispatchProfiles(Array.from({length:100},(_,i)=>i),async i=>{
    active++;peak=Math.max(peak,active);
    try {
      await new Promise(resolve=>setImmediate(resolve));
      visited.add(i);
      if(i===0||i===50)throw new Error('simulated database error');
    } finally {active--;}
  });
  assert.equal(visited.size,100);
  assert.equal(errors.length,2);
  assert.equal(peak,4);
});
