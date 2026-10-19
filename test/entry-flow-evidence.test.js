'use strict';
const test=require('node:test'),a=require('node:assert/strict');
const {entryFlowEvidence}=require('../entry-flow-evidence');
test('execution evidence preserves a blocked queued order while excluding identity and secrets',()=>{
 const events=[{type:'ENTRY_BLOCKED',createdAt:100,detail:{reason:'WAIT_MT5_CLOSE_CONFIRMATION',timeframe:'2',password:'PRIVATE_SECRET',account:'123456',userId:'private-user'}},{type:'SETTINGS_SAVED',createdAt:90,detail:{password:'PRIVATE_SECRET'}},{type:'COMMAND_ACKNOWLEDGED',createdAt:80,detail:{commandId:'c1',commandType:'PLACE_SETUP',status:'REJECTED',code:'EA_STOPPED',message:'PRIVATE_SECRET'}}];
 const result=entryFlowEvidence(events);a.equal(result.length,2);a.equal(result[0].reason,'WAIT_MT5_CLOSE_CONFIRMATION');a.equal(result[1].status,'REJECTED');a.equal(result[1].commandType,'PLACE_SETUP');a.doesNotMatch(JSON.stringify(result),/PRIVATE_SECRET|123456|private-user|password|message/);
});
test('diagnostics remain bounded, tolerate missing data and exclude nonfinite timing',()=>{
 a.deepEqual(entryFlowEvidence(null),[]);const result=entryFlowEvidence(Array.from({length:100},()=>({type:'ENTRY_DELIVERED',createdAt:100,detail:{reason:'x'.repeat(500),queueToAckMs:Infinity}})));a.equal(result.length,20);a.equal(result[0].reason.length,120);a.equal(result[0].queueToAckMs,undefined);
});
