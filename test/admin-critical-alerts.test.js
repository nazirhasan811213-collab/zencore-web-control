'use strict';
const {test}=require('node:test'),a=require('node:assert/strict'),{criticalAlerts}=require('../admin-critical-alerts');
test('red alerts are scoped to actual flow faults and dedup across affected users',()=>{
 const c={id:'feed2',label:'TF2',status:'WARNING',detail:'Data lama'};
 const out=criticalAlerts({observedAt:100,components:[c,c,{id:'telegram',status:'WARNING'},{id:'webhook',status:'WARNING'}],accounts:[{userId:'u',transport:'EA_LOCAL',ready:false,state:'OFFLINE',control:{desiredState:'ON'}}]});
 a.equal(out.length,2);a.ok(out.every(x=>x.severity==='error'&&x.observedAt===100));a.equal(out[0].timeframe,2);
});
test('PAUSED and stopped/unlinked accounts do not generate entry flow alarms; confirmed recovery clears faults',()=>{
 a.deepEqual(criticalAlerts({paused:true,components:[{id:'feed2',status:'ERROR'},{id:'orders',status:'WARNING'}]}),[]);
 for(const desiredState of ['STOPPED','OFF','UNKNOWN'])a.deepEqual(criticalAlerts({accounts:[{transport:'EA_LOCAL',ready:false,control:{desiredState}}]}),[]);
 a.deepEqual(criticalAlerts({components:[{id:'feed2',status:'OK'}],accounts:[{transport:'EA_LOCAL',ready:true,control:{desiredState:'ON'}}]}),[]);
});
