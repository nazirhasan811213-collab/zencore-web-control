const test=require('node:test'),assert=require('node:assert/strict');
const {RETENTION_MS,retained,recent,pruneSnapshots}=require('../market-retention');
test('raw snapshot retention includes exact five-hour boundary and expires older observations',()=>{
 const now=RETENTION_MS+100000;
 assert.equal(retained({receivedAt:now-RETENTION_MS},now),true);
 assert.equal(retained({receivedAt:now-RETENTION_MS-1},now),false);
 assert.equal(retained({},now),false);
 assert.deepEqual(recent([{receivedAt:now},{receivedAt:1}],now),[{receivedAt:now}]);
});
test('database cleanup targets only raw snapshots with a parameterized cutoff',async()=>{
 const calls=[],pool={query:async(sql,args)=>{calls.push({sql,args});return {rowCount:3};}};
 assert.equal(await pruneSnapshots(pool,RETENTION_MS+100000),3);
 assert.equal(calls.length,1);assert.equal(calls[0].sql,'DELETE FROM zencore_snapshots WHERE received_at < $1');
 assert.deepEqual(calls[0].args,[100000]);assert.equal(await pruneSnapshots(null),0);
});
