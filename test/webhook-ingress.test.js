'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createWebhookIngress}=require('../webhook-ingress');
const secret='test-only-webhook-secret-at-least-32-characters',at=1791000000000;
test('verified ingress rejects missing/wrong secret, stale/future timestamps and malformed JSON',()=>{
 const gate=createWebhookIngress({secret,now:()=>at});
 for(const body of ['text','{}',JSON.stringify({authToken:'wrong',emittedAt:at}),JSON.stringify({authToken:secret,emittedAt:at-30001}),JSON.stringify({authToken:secret,emittedAt:at+5001})])assert.throws(()=>gate.validate(body));
 const body=JSON.parse(gate.validate(JSON.stringify({authToken:secret,emittedAt:at,markets:[]})));assert.equal('authToken' in body,false);assert.equal(body.emittedAt,at);assert.equal(gate.enforced,true);
});
test('payload limit and valid-feed burst limit remain bounded and reset',()=>{
 let clock=at;const gate=createWebhookIngress({secret,now:()=>clock,maxBytes:200,maxPerMinute:2});
 assert.throws(()=>gate.validate('x'.repeat(201)),{code:'WEBHOOK_TOO_LARGE'});
 const body=()=>JSON.stringify({authToken:secret,emittedAt:clock});gate.validate(body());gate.validate(body());assert.throws(()=>gate.validate(body()),{code:'WEBHOOK_RATE_LIMITED'});clock+=60000;assert.doesNotThrow(()=>gate.validate(body()));
});
test('migration compatibility is explicit and secrets never reach legacy ingress',()=>{
 const gate=createWebhookIngress();assert.equal(gate.enforced,false);assert.equal(gate.validate('legacy text'),'legacy text');assert.equal(gate.validate('{"authToken":"do-not-persist","action":"WAIT"}'),'{"action":"WAIT"}');assert.throws(()=>createWebhookIngress({secret:'weak'}),{code:'WEBHOOK_SECRET_INVALID'});
});
