const test = require('node:test');
const assert = require('node:assert/strict');
const {MemoryAutoTradeStore} = require('../auto-trade-store');
const {createAutoTradeService} = require('../auto-trade-service');

test('ENTRY_STOPPED clears false ON, cancels entries and preserves management', async () => {
 const store = new MemoryAutoTradeStore();
 const svc = createAutoTradeService({store,commandSigningKey:'test-key-longer-than-thirty-two-characters',allowDemoExecution:true});
 const userId='11111111-1111-4111-8111-111111111111';
 const pair=await svc.connectLocalEa(userId);
 const pod=await store.getPodForUser(userId);
 await store.setControl(userId,{desiredState:'ON',effectiveState:'ON'});
 for(const [id,type] of [['failed','PLACE_SETUP'],['pending','PLACE_SETUP'],['manage','MANAGE_POSITION']]) {
  await store.createCommand({id,userId,podId:pod.id,type,payload:{},expiresAt:Date.now()+60000});
 }
 await svc.acknowledgeCommand(pair.podToken,'failed',{status:'FAILED',code:'ENTRY_STOPPED'});
 const p=await store.getProfile(userId);
 assert.equal(p.desiredState,'STOPPED');
 assert.equal(p.effectiveState,'ERROR');
 assert.match(p.lastError,/EA entry STOPPED/);
 assert.equal((await store.listOnProfiles()).length,0);
 const commands=await store.listRecentCommands(userId);
 assert.equal(commands.find(c=>c.id==='pending').status,'CANCELLED');
 assert.equal(commands.find(c=>c.id==='manage').status,'PENDING');
});
