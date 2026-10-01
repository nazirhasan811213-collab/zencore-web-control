const test=require('node:test');const assert=require('node:assert/strict');
const {PostgresAutoTradeStore}=require('../auto-trade-store');
test('Postgres command preserves signed millisecond timestamp instead of database clock',async()=>{
 const store=Object.create(PostgresAutoTradeStore.prototype);
 const createdAt=1790000000123, expiresAt=createdAt+120000;
 store.pool={query:async(sql,args)=>{
  assert.match(sql,/expires_at, created_at/);assert.match(sql,/\$9, \$10/);
  assert.equal(args[9].getTime(),createdAt);
  return {rows:[{id:args[0],user_id:args[1],pod_id:args[2],command_type:args[3],payload:JSON.parse(args[4]),signature:args[5],signed_envelope:args[6],expires_at:args[8],created_at:args[9]}]};
 }};
 const result=await store.createCommand({id:'command',userId:'user',podId:'pod',type:'SYSTEM_ON',payload:{},signature:'signature',signedEnvelope:'envelope',createdAt,expiresAt});
 assert.equal(result.command.createdAt,createdAt);assert.equal(result.command.expiresAt,expiresAt);
});
