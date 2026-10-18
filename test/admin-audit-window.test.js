'use strict';
const test=require('node:test'),a=require('node:assert/strict');
const {MemoryAutoTradeStore,PostgresAutoTradeStore}=require('../auto-trade-store');
test('audit time filters apply before the row limit and preserve inclusive boundaries',async()=>{
 const s=new MemoryAutoTradeStore();s.audit.set('u',[100,200,300,400].map(at=>({id:at,type:'ENTRY_BLOCKED',createdAt:at})));
 a.deepEqual((await s.listAdminAudit(2,{after:100,before:300})).map(x=>x.id),[300,200]);
 a.deepEqual((await s.listAdminAudit(1,{before:100})).map(x=>x.id),[100]);
 a.equal((await s.listAdminAudit(300)).length,4);
});
test('PostgreSQL admin audit binds optional time bounds as parameters',async()=>{
 let captured;const fake={pool:{query:async(sql,values)=>{captured={sql,values};return {rows:[]};}}};
 await PostgresAutoTradeStore.prototype.listAdminAudit.call(fake,500,{after:1000,before:2000});
 a.equal(captured.values[0],300);a.equal(captured.values[1].getTime(),1000);a.equal(captured.values[2].getTime(),2000);
 a.match(captured.sql,/a.created_at >= \$2/);a.match(captured.sql,/a.created_at <= \$3/);
});
