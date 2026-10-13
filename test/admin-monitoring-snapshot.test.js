'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),S=require('../admin-monitoring-snapshot');
const raw=()=>({ok:true,observedAt:100000,servedAt:106000,components:[],accounts:[],alerts:[],workers:[],summary:{}});
test('snapshot age uses server age plus monotonic receipt time, independent of device clock',()=>{const s=S.receive(raw(),500);assert.equal(S.stale(s,30500),false);assert.equal(S.stale(s,69500),false);assert.equal(S.stale(s,70501),true);});
test('old, future and malformed snapshots cannot claim current status',()=>{assert.throws(()=>S.receive({...raw(),servedAt:200000},0));assert.throws(()=>S.receive({...raw(),observedAt:120000},0));assert.throws(()=>S.receive({...raw(),alerts:null},0));});
