const test = require('node:test');
const assert = require('node:assert/strict');
const { transferDemoSlot } = require('../demo-slot-transfer');
const req = {accountId:'5fef90e2-2687-457b-bc14-7ff5231935b0', displacedAccountId:'0e739ab1-5231-4252-a6ba-20b6a386c180',ownerEmail:'nazirhasan811213@gmail.com',sourceSlot:'zencore-mt5-demo-01-s03',targetSlot:'zencore-mt5-demo-01-s01'};
function fixture(options={}) {
 const queries=[];
 const client={release(){queries.push('RELEASE');},async query(sql,args){
 queries.push(sql);
 if(sql.startsWith('SELECT a.id')) return {rows:[{id:req.accountId,user_id:'u1',email:options.wrongOwner?'other@example.com':req.ownerEmail,trade_mode:options.real?'REAL':'DEMO'},{id:req.displacedAccountId,user_id:'u2',email:'other@example.com',trade_mode:'DEMO'}]};
 if(sql.startsWith('SELECT id, host_id')) return {rows:[{id:'s1',host_id:'h',slot_code:req.targetSlot,account_id:options.applied?req.accountId:req.displacedAccountId},{id:'s3',host_id:'h',slot_code:req.sourceSlot,account_id:options.applied?req.displacedAccountId:req.accountId}]};
 if(sql.startsWith('SELECT desired_state'))return {rows:[{desired_state:options.running?'ON':'STOPPED',effective_state:'STOPPED'}]};
 if(sql.startsWith('SELECT ticket'))return {rows:options.positions?[{ticket:'1'}]:[]};
 if(options.failUpdate && sql.startsWith('UPDATE'))throw Error('DATABASE_WRITE_FAILED');
 return {rows:[]};}};
 return {pool:{async connect(){return client;}},queries};
}
test('no request does not touch database',async()=>assert.deepEqual(await transferDemoSlot(null,null),{skipped:true}));
for(const [name,opts] of Object.entries({wrongOwner:{wrongOwner:true},real:{real:true},running:{running:true},positions:{positions:true},failedWrite:{failUpdate:true}})){
 test(name+' rolls back',async()=>{const f=fixture(opts);await assert.rejects(transferDemoSlot(f.pool,req));assert.ok(f.queries.includes('ROLLBACK'));assert.ok(!f.queries.includes('COMMIT'));assert.equal(f.queries.at(-1),'RELEASE');});
}
test('swaps assignments and invalidates leases before commit',async()=>{const f=fixture();assert.deepEqual(await transferDemoSlot(f.pool,req),{transferred:true});assert.ok(f.queries.some(q=>q.includes('lease_id=NULL')));assert.equal(f.queries.filter(q=>q.startsWith('UPDATE zencore_mt5_worker_slots')).length,3);assert.equal(f.queries.at(-2),'COMMIT');});
test('repeat is idempotent and does not invalidate an active connection',async()=>{const f=fixture({applied:true});assert.deepEqual(await transferDemoSlot(f.pool,req),{alreadyApplied:true});assert.ok(!f.queries.some(q=>q.startsWith('UPDATE')));});
