'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {CANONICAL,ALIASES,normalizeTf2FeedSource}=require('../tf2-feed-source');
function fixture(source=ALIASES[0]){const row=Array(67).fill(null);row[0]='XAUUSD';row[6]=100;row[66]={entryRuleVersion:'TF2_SOLID_80PCT_LIVE_V2',entryEvent:false};return {source,feedVersion:'TF2_REALTIME_V1',timeframe:'2',schemaVersion:'32.3-EXIT-STEPLOCK',encoding:'zencore-compact-v1',feedChannel:'DASHBOARD',markets:[row]};}
test('both released native labels normalize without modifying market data or credentials',()=>{for(const source of ALIASES){const b=fixture(source);b.authToken='test-token';const n=normalizeTf2FeedSource(b);assert.equal(n.source,CANONICAL);assert.equal(n.authToken,b.authToken);assert.equal(n.markets,b.markets);assert.equal(b.source,source);}});
test('unknown source, wrong TF/schema/channel/row/rule never gain batch recognition',()=>{for(const mutate of [b=>b.source='Other',b=>b.timeframe='15',b=>b.schemaVersion='other',b=>b.feedChannel='OTHER',b=>b.markets[0].pop(),b=>b.markets[0][66].entryRuleVersion='OTHER']){const b=fixture();mutate(b);assert.equal(normalizeTf2FeedSource(b),b);}});
test('TF15 and canonical feeds remain unchanged',()=>{for(const b of [fixture(CANONICAL),{...fixture(),feedVersion:'TF15_REALTIME_V1',timeframe:'15'}])assert.equal(normalizeTf2FeedSource(b),b);});
test('actual captureBody routes the previously ignored native batch through decoder, metadata and broadcasts',()=>{
 const code=fs.readFileSync(require.resolve('../server-v17'),'utf8'),calls=[],ctx={require:require('node:module').createRequire(require.resolve('../server-v17')),feedMetadataDiagnostics:{record:(b,s)=>calls.push(['metadata',b.source,s])},storeSnapshot:d=>{calls.push(['store',d.symbol]);return d.symbol;},broadcastMarkets:()=>calls.push(['markets']),broadcastPrediction:s=>calls.push(['prediction',s])};
 vm.runInNewContext(code.slice(code.indexOf('function expandCompactMarket('),code.indexOf('function storeSnapshot(')),ctx);
 vm.runInNewContext(code.slice(code.indexOf('function captureBody('),code.indexOf('function send(res,',code.indexOf('function captureBody('))),ctx);
 ctx.captureBody(JSON.stringify(fixture()));assert.deepEqual(calls.map(c=>c[0]),['store','metadata','markets','prediction']);assert.equal(calls[0][1],'XAUUSD');assert.equal(calls[1][1],CANONICAL);
});
test('published Pine uses the canonical compact source',()=>{const p=fs.readFileSync(require.resolve('../ZenCore_TF2_SOLID_80PCT_Draft.pine'),'utf8');assert.ok(p.includes('ZenCore Multi-Pair Feed'));assert.ok(!p.includes('\\"source\\":\\"ZenCore Native SOP24 TF2'));});
