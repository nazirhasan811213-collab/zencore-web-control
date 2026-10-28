'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{createAnalysisReader}=require('../analysis-live-read');
const frame=tf=>({symbol:'XAUUSD',timeframe:String(tf),signalObservedAt:1000,receivedAt:2000,strategyNormal:{tf:tf+'m'}});
test('current Pine hub snapshots bypass legacy HTTP without copying or refreshing timestamps',async()=>{
 const tf2=frame(2),tf15=frame(15);let calls=0;
 const read=createAnalysisReader({readTF2:()=>[tf2],readTF15:()=>[tf15],readFallback:()=>{calls++;return new Promise(()=>{});}});
 const result=await read();assert.equal(calls,0);assert.equal(result[0],tf2);assert.equal(result[1],tf15);assert.equal(result[0].signalObservedAt,1000);assert.equal(result[0].receivedAt,2000);
});
test('a missing TF never delays or borrows a present TF; wrong-channel and legacy TFs are excluded',async()=>{
 let calls=0;const tf2=frame(2),tf15=frame(15);
 const read=createAnalysisReader({readTF2:()=>[tf2,frame(3),tf15],readTF15:()=>[frame(2)],readFallback:()=>{calls++;throw Error('legacy must not run');}});
 assert.deepEqual(await read(),[tf2]);assert.equal(calls,0);
});
test('cold modern caches retain the existing authenticated legacy fallback',async()=>{
 const expected=[frame(2)];let calls=0;
 const read=createAnalysisReader({readTF2:()=>[],readTF15:()=>[],readFallback:async()=>{calls++;return expected;}});
 assert.equal(await read(),expected);assert.equal(calls,1);
});
