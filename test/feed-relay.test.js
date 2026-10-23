'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http');
const {createFeedRelay,signature,DESTINATION,MAX_AGE}=require('../feed-relay');
const secret='test-relay-key-only-not-a-production-secret-12345';
const body=(at=Date.now(),tf='2')=>JSON.stringify({timeframe:tf,feedVersion:`TF${tf}_REALTIME_V1`,emittedAt:at,markets:[['XAUUSD',at,4100]]});
const headers=(text,at=Date.now(),id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')=>({'x-zencore-relay-at':String(at),'x-zencore-relay-id':id,'x-zencore-relay-signature':signature(secret,at,id,text)});
const quiet={log(){}};
test('receiver preserves source identity and timeframe; rejects forged, replayed, stale or unsanitized feeds',()=>{
 let at=1792000000000;const r=createFeedRelay({receive:true,secret,now:()=>at});
 for(const tf of ['2','15']){
  const text=body(at,tf),h=headers(text,at,tf==='2'?'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa':'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
  assert.equal(r.accept(text,h).body,text);r.applied(at,200);
  assert.throws(()=>r.accept(text,h),/RELAY_REPLAY/);
 }
 assert.equal(r.status().applied,2);
 const text=body(at);assert.throws(()=>r.accept(text,{...headers(text,at),'x-zencore-relay-signature':'0'.repeat(64)}),/UNAUTHORIZED/);
 const stale=body(at-MAX_AGE-1);assert.throws(()=>r.accept(stale,headers(stale,at)),/SOURCE_STALE/);
 const unsafe=JSON.stringify({...JSON.parse(text),authToken:'original-token-must-not-leave'});
 assert.throws(()=>r.accept(unsafe,headers(unsafe,at)),/UNSANITIZED/);
 at+=MAX_AGE+1;assert.throws(()=>r.accept(text,headers(text,at-40000)),/UNAUTHORIZED/);
 assert.throws(()=>createFeedRelay().accept(text,{}),/DISABLED/);
});
test('target is pinned and missing credentials fail closed',()=>{
 assert.throws(()=>createFeedRelay({target:'https://example.com/webhook',secret}),/TARGET_INVALID/);
 assert.throws(()=>createFeedRelay({target:DESTINATION}),/SECRET_INVALID/);
 assert.equal(createFeedRelay().send(body()),false);
});
async function listen(t,handler){
 const server=http.createServer(handler);await new Promise(r=>server.listen(0,'127.0.0.1',r));
 t.after(()=>new Promise(r=>{server.close(r);server.closeAllConnections();}));
 return `http://127.0.0.1:${server.address().port}/relay/webhook`;
}
async function until(fn){const end=Date.now()+4000;while(!fn()){if(Date.now()>end)throw Error('test wait expired');await new Promise(r=>setTimeout(r,5));}}
test('real HTTP relay delivers both TFs unchanged, uses keep-alive and measures source age',async t=>{
 const receiver=createFeedRelay({receive:true,secret});const received=[],ports=[];
 const target=await listen(t,(req,res)=>{let text='';ports.push(req.socket.remotePort);req.on('data',c=>text+=c);req.on('end',()=>{
  const receipt=receiver.accept(text,req.headers);received.push(receipt.body);receiver.applied(receipt.sourceAt,200);res.end('{"ok":true}');
 });});
 const relay=createFeedRelay({target,secret,transport:http,allowTestTarget:true,log:quiet});t.after(()=>relay.close());
 for(const tf of ['2','15']){const text=body(Date.now()-100,tf);assert.equal(relay.send(text),true);await until(()=>relay.status().delivered===received.length&&received.length===(tf==='2'?1:2));assert.equal(received.at(-1),text);}
 assert.equal(ports[0],ports[1]);assert.equal(receiver.status().received,2);assert(relay.status().lastSourceAgeMs>=100);assert.equal(relay.status().inFlight,0);
});
test('a stalled target never holds original processing; work is bounded and times out without replay',async t=>{
 const target=await listen(t,()=>{});const r=createFeedRelay({target,secret,transport:http,allowTestTarget:true,log:quiet});t.after(()=>r.close());
 const start=performance.now();for(let i=0;i<4;i++)assert.equal(r.send(body()),true);
 let originalHandled=true;assert.equal(r.send(body()),false);assert(originalHandled);assert(performance.now()-start<200);
 assert.equal(r.status().inFlight,4);assert.equal(r.status().dropped,1);
 await until(()=>r.status().inFlight===0);assert.equal(r.status().failed,4);assert.equal(r.status().sent,4);assert.equal(r.status().delivered,0);
});
test('downstream HTTP failure cannot affect the caller and stale data is never queued',async t=>{
 const target=await listen(t,(req,res)=>{req.resume();res.writeHead(503);res.end();});
 const r=createFeedRelay({target,secret,transport:http,allowTestTarget:true,log:quiet});t.after(()=>r.close());
 assert.equal(r.send(body(Date.now()-MAX_AGE-1)),false);assert.equal(r.send(body()),true);
 await until(()=>r.status().failed===1);assert.equal(r.status().lastError,'RELAY_HTTP_503');assert.equal(r.status().sent,1);
});
