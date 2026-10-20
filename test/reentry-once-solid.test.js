'use strict';
const test=require('node:test'),a=require('node:assert/strict'),fs=require('node:fs');
const {notificationKey}=require('../telegram-notification-key');
for(const tf of ['2','15'])for(const side of ['BUY','SELL'])test('one reentry identity per SOLID '+tf+' '+side,()=>{
 const e={kind:'ENTRY',symbol:'XAUUSD',timeframe:tf,side,setupKey:'candidate-A',telegramSop:{cycleKind:'FOLLOWUP',sourceSetupAt:100,triggerAt:101}};
 const key=notificationKey(e);
 a.equal(key,notificationKey({...e,setupKey:'candidate-B',sourceBarTime:999,entryType:'HIGH_REENTRY',telegramPlan:{entry:999},telegramSop:{...e.telegramSop,triggerAt:999,qualifiedAt:1000}}));
 a.notEqual(key,notificationKey({...e,telegramSop:{...e.telegramSop,sourceSetupAt:200}}));
 a.notEqual(key,notificationKey({...e,timeframe:tf==='2'?'15':'2'}));
 a.notEqual(key,notificationKey({...e,telegramSop:{...e.telegramSop,cycleKind:'INITIAL'}}));
 const fallback={...e,telegramSop:{cycleKind:'FOLLOWUP',triggerAt:101}};
 a.equal(notificationKey(fallback),notificationKey({...fallback,setupKey:'retry'}));
});
test('database ledger rejects a second candidate in same SOLID across restart',async()=>{
 const {AnalysisAlerts}=require('../analysis-alert-service');
 const states=new Map(),keys=new Set(),events=[];
 const query=async(sql,args=[])=>{
  if(sql.startsWith('SELECT data FROM zencore_alert_states'))return {rows:states.has(args[0])?[{data:structuredClone(states.get(args[0]))}]:[]};
  if(sql.startsWith('INSERT INTO zencore_alert_states'))states.set(args[0],structuredClone(args[1]));
  if(sql.startsWith('INSERT INTO zencore_notification_keys')){if(keys.has(args[0]))return {rows:[]};keys.add(args[0]);return {rows:[{notification_key:args[0]}]};}
  if(sql.startsWith('INSERT INTO zencore_analysis_alerts')){events.push(structuredClone(args[0]));return {rows:[{id:events.length}]};}
  return {rows:[]};
 };
 const pool={query,connect:async()=>({query,release(){}})},one=new AnalysisAlerts({pool}),two=new AnalysisAlerts({pool});one.ready=two.ready=true;let t=Date.now()-20000;
 const market=(key,source)=>({symbol:'XAUUSD',timeframe:'2',setupKey:key,receivedAt:++t,strategyNormal:{state:'READY',side:'BUY',sop:{cycleKind:'FOLLOWUP',sourceSetupAt:source,triggerAt:source,sopGreen:4,forecast:'BULLISH',marketPower:70,gates:[{pass:true},{pass:true}]},plan:{entry:2000,sl:1990,tp1:2010,tp2:2020,tp3:2030}},positionManagement:{action:'HOLD'}});
 await one.record(market('A',100));await two.record(market('B',100));await two.record(market('C',200));
 const entries=events.filter(e=>e.kind==='ENTRY');a.equal(entries.length,3);
 a.deepEqual(entries.map(e=>e.telegramDuplicate),[false,true,false]);a.equal(entries[0].telegramSop.sourceSetupAt,100);
});
for(const file of ['ZenCore_TF2_ATR8_TP1Max3.pine','ZenCore_TF2_SolidOnly.pine','ZenCore_TF15_SolidOnly.pine','ZenCore_TF15_Intraday.pine'])test(file+' only resets reentry quota on a new native SOLID',()=>{
 const s=fs.readFileSync(file,'utf8');
 a.match(s,/varip bool zc_followup_used = false/);
 a.match(s,/if zc_hold_new_source\n    zc_followup_used := false/);
 a.equal((s.match(/zc_followup_used := false/g)||[]).length,1);
 a.match(s,/bool zc_followup = [^\n]+ and not zc_followup_used/);
 a.match(s,/if zc_followup\n    zc_followup_used := true/);
 a.match(s,/var int zc_chart_reentry_source = na/);
 a.match(s,/if not na\(zc_native_setup\) and \(na\(zc_chart_reentry_source\) or zc_chart_reentry_source != zc_native_setup\)/);
 a.ok(s.includes('        zc_chart_reentry_source := zc_native_setup'));
 a.match(s,/zc_recent_pullback and zc_reentry_momentum/);
});
