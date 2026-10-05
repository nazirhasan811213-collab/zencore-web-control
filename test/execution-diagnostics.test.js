const test = require('node:test');
const assert = require('node:assert/strict');
const { MemoryAutoTradeStore, PostgresAutoTradeStore } = require('../auto-trade-store');
const { createAutoTradeService, canonicalCommand } = require('../auto-trade-service');
test('execution diagnostics scope commands to owner, report mismatches, and exclude secrets', async () => {
  const store = new MemoryAutoTradeStore();
  const service = createAutoTradeService({store, commandSigningKey:'test-key-longer-than-thirty-two-bytes'});
  const command = {id:'00000000-0000-0000-0000-000000000001',userId:'owner',podId:'pod',type:'SYSTEM_STOP',payload:{token:'private-token'},createdAt:Date.now(),expiresAt:Date.now()+15000};
  command.signature=service.signCommand(command);
  command.signedEnvelope=Buffer.from(canonicalCommand(command)).toString('base64url');
  store.commands.set('pod',[{...command,status:'REJECTED',result:{code:'COMMAND_VALIDATION_FAILED',message:'private-message'}}]);
  store.commands.set('other',[{...command,userId:'other'}]);
  let result=await service.executionDiagnostics('owner');
  assert.equal(result.commands.length,1);assert.deepEqual(result.commands[0].checks,[]);
  for(const secret of ['private-token','private-message',command.signature,command.signedEnvelope])assert.ok(!JSON.stringify(result).includes(secret));
  store.commands.get('pod')[0].createdAt++;
  result=await service.executionDiagnostics('owner');assert.deepEqual(result.commands[0].checks,['ENVELOPE_MISMATCH_CREATEDAT']);
});
test('Postgres diagnostic lookup is constrained to session user and bounded',async()=>{
 const store=Object.create(PostgresAutoTradeStore.prototype);
 store.pool={query:async(sql,args)=>{assert.match(sql,/WHERE user_id = \$1/);assert.deepEqual(args,['owner',20]);return {rows:[]};}};
 assert.deepEqual(await store.listRecentCommands('owner',1000),[]);
});
