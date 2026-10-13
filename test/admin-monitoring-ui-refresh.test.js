'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),S=require('../admin-monitoring-snapshot');
test('monitor renders fresh snapshot despite wrong PC clock; schedules 30s after completion and suppresses overlap',async()=>{
 const nodes=new Map(),callbacks={},timers=[];let calls=0;
 const el=id=>nodes.get(id)||nodes.set(id,{value:id==='filter'?'all':'',setAttribute(){}}).get(id);
 const data={ok:true,observedAt:100000,servedAt:106000,overall:'OK',alerts:[],components:[],accounts:[],workers:[],summary:{},clientsAvailable:true};
 const doc={hidden:false,getElementById:el,addEventListener(k,f){callbacks[k]=f}};
 const context={ZenCoreMonitorSnapshot:S,performance:{now:()=>100},Date:Object.assign(class extends Date{}, {now:()=>999999999}),AbortSignal,document:doc,window:{addEventListener(){}},location:{assign(){}},setInterval(){return 1},clearInterval(){},setTimeout(f,ms){timers.push({f,ms});return timers.length},clearTimeout(){},fetch:async url=>{if(url.includes('notifications'))return {ok:true,json:async()=>({ok:true,enabled:false})};calls++;return {ok:true,status:200,json:async()=>data}}};
 vm.runInNewContext(fs.readFileSync(require.resolve('../admin-monitoring.js'),'utf8'),context);
 await new Promise(resolve=>setImmediate(resolve));assert.equal(el('overall').textContent,'OK');assert.equal(timers.at(-1).ms,30000);assert.equal(calls,1);
 callbacks.visibilitychange();assert.equal(calls,1);
 await Promise.all([el('refresh').onclick(),el('refresh').onclick()]);assert.equal(calls,2);assert.equal(timers.at(-1).ms,30000);
});
