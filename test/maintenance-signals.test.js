'use strict';
const {test}=require('node:test'),a=require('node:assert/strict'),{AnalysisAlerts}=require('../analysis-alert-service');
test('maintenance suppresses scheduled guides and live popup delivery without changing stored settings',async()=>{
 const previous=process.env.ZENCORE_ANALYSIS_SIGNALS_PAUSED;process.env.ZENCORE_ANALYSIS_SIGNALS_PAUSED='true';
 const s=new AnalysisAlerts();await s.init();
 try{
  const event={id:1,kind:'ENTRY',symbol:'XAUUSD',time:Date.now()};s.events=[event];s.sequence=1;
  const before=JSON.stringify([...s.prefs]);
  a.equal(await s.recordGuide({kind:'GUIDE'}),false);a.deepEqual((await s.feed('0')),{events:[],cursor:'1'});a.equal(JSON.stringify([...s.prefs]),before);a.deepEqual(s.events,[event]);
  process.env.ZENCORE_ANALYSIS_SIGNALS_PAUSED='false';a.deepEqual((await s.feed('0')).events,[event]);
 }finally{clearInterval(s.timer);clearInterval(s.cleanupTimer);if(previous===undefined)delete process.env.ZENCORE_ANALYSIS_SIGNALS_PAUSED;else process.env.ZENCORE_ANALYSIS_SIGNALS_PAUSED=previous;}
});
test('maintenance drains pending analysis notifications as skipped and never calls Telegram',async()=>{
 const previous=process.env.ZENCORE_ANALYSIS_SIGNALS_PAUSED;process.env.ZENCORE_ANALYSIS_SIGNALS_PAUSED='true';const queries=[];let sent=0;
 const s=new AnalysisAlerts({pool:{query:async sql=>{queries.push(sql);return {rows:[]};}},token:'test-only',fetchFn:async()=>{sent++;throw Error('must not send')}});
 try{await s.deliver();a.equal(sent,0);a.equal(queries.length,1);a.match(queries[0],/status='skipped'.*status='pending'/);a.doesNotMatch(queries[0],/DELETE|zencore_users|autotrade_profiles/);}
 finally{if(previous===undefined)delete process.env.ZENCORE_ANALYSIS_SIGNALS_PAUSED;else process.env.ZENCORE_ANALYSIS_SIGNALS_PAUSED=previous;}
});
