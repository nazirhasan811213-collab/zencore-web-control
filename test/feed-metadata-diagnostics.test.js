'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createFeedMetadataDiagnostics}=require('../feed-metadata-diagnostics');
function batch(rule=true,channel='DASHBOARD'){
 const row=Array(67).fill(null);row[0]='XAUUSD';row[65]={version:'HEMA23_LIVE_V1'};
 row[66]={entryEvent:false,...(rule?{entryRuleVersion:'TF2_3GREEN_TP1_HEMAGAP_V1',pendingEntryReturn:true}:{})};
 return {timeframe:'2',feedChannel:channel,feedVersion:'TF2_REALTIME_V1',emittedAt:1000,markets:[row],authToken:'NEVER_EXPOSE',password:'NEVER_EXPOSE'};
}
test('distinguishes mixed revised and unversioned ingress from state rejection',()=>{
 const d=createFeedMetadataDiagnostics({now:()=>1250});d.record(batch(),['XAUUSD']);d.record(batch(false));
 const c=d.snapshot().channels[0];assert.equal(c.count,2);assert.equal(c.revisedCount,1);assert.equal(c.unversionedCount,1);
 assert.equal(c.latest.rule,null);assert.equal(c.latest.accepted,false);assert.equal(c.lastRevised.accepted,true);
 assert.equal(c.lastRevised.transportLagMs,250);assert.equal(c.lastRevised.hasLiveHema,true);
 assert.equal(JSON.stringify(c).includes('NEVER_EXPOSE'),false);
});
test('separates channels and refuses unknown identifiers without unbounded storage',()=>{
 const d=createFeedMetadataDiagnostics();d.record(batch());d.record(batch(true,'EXECUTION'));
 for(let i=0;i<30;i++)d.record({...batch(),feedChannel:`UNKNOWN${i}`});
 d.record({...batch(),timeframe:'3'});d.record({...batch(),markets:[]});
 assert.equal(d.snapshot().channels.length,2);
});
test('records missing metadata without pretending revised SOP was received',()=>{
 const b=batch();b.markets[0].length=65;const d=createFeedMetadataDiagnostics();d.record(b);
 const c=d.snapshot().channels[0];assert.equal(c.latest.rowLength,65);assert.equal(c.latest.hasEntryMetadata,false);assert.equal(c.revisedCount,0);
});
