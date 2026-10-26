'use strict';
const test=require('node:test'),a=require('node:assert/strict');
const {MemoryAutoTradeStore}=require('../auto-trade-store');
const {createAutoTradeService}=require('../auto-trade-service');
const {createEntryCycleReset}=require('../entry-cycle-reset');
const {notificationKey}=require('../telegram-notification-key');
const version='TF2_BROKER_CLOSE_CYCLES_V1';
const position={symbol:'XAUUSD',origin:'ZENCORE',strategyMode:'TF2_SCALPING'};
function event(at,after,side='BUY'){
 const sign=side==='BUY'?1:-1;
 return {kind:'ENTRY',symbol:'XAUUSD',timeframe:'2',side,setupKey:'TF2|XAUUSD|'+side+'|'+at,
 telegramSop:{reentryPolicyVersion:version,lifecycleVersion:'PULLBACK_REQUALIFY_V1',entryPolicyVersion:'PINE_SOLID_3OF4_FORECAST45_V5',cycleKind:'FOLLOWUP',sourceSetupAt:100,triggerAt:100,qualifiedAt:at,signalObservedAt:at,
 atrReference:2,sourceEntry:100,price:100+sign*3,hema2:{fast:100+sign*2,slow:100+sign,waveTrend1:sign*4,waveTrend2:sign},
 reentryContext:{parentQualifiedAt:after-100,fastPrevious:100+sign,slowPrevious:100+sign*.5,wtGapPrevious:2,previousHigh:102,previousLow:98,
 pricePath:[[after+100,100],[after+200,100+sign],[after+300,100+sign*.5],[at,100+sign*3]]}}};
}
for(const side of ['BUY','SELL'])test('same SOLID re-arms after every full broker close, never after a partial close: '+side,async()=>{
 let clock=10000;const store=new MemoryAutoTradeStore();
 const pod={id:'p',userId:'u',ownershipMode:'TRADER_OWNED_EA_LOCAL',lastSeenAt:clock,tradeMode:'DEMO',terminalTradeAllowed:true,accountTradeAllowed:true,expertTradeAllowed:true,demoExecutionUnlocked:true,connectorVersion:'1.2.0-ea-local'};
 store.podsByUser.set('u',pod);
 const gate=createEntryCycleReset(store);
 const svc=createAutoTradeService({store,now:()=>clock,scalpingTimeframe:'2',localEaExecutionUserIds:['u'],commandSigningKey:'test-cycle-signal-key-longer-than-32-bytes'});
 store.commands.set('p',[]);
 const fill=(id,at)=>store.commands.get('p').push({id,userId:'u',podId:'p',type:'PLACE_SETUP',status:'EXECUTED',acknowledgedAt:at,payload:{symbol:'XAUUSD',strategyMode:'TF2_SCALPING'}});
 for(let i=0;i<3;i++){
  const close=1000+i*2000,at=close+1000;fill('fill-'+i,close-500);
  let e=event(at,close,side);
  store.positions.set('u',[position,position]);
  a.equal(await svc.reentrySignalAllowed('u',e),false);
  await gate.observe('u','p',[position,position],[position],close-10);
  store.positions.set('u',[position]);a.equal(await svc.reentrySignalAllowed('u',e),false,'one layer is still open');
  await gate.observe('u','p',[position],[],close);store.positions.set('u',[]);
  // New service reads the durable reset as it would after a restart.
  const restarted=createAutoTradeService({store,now:()=>clock,scalpingTimeframe:'2',localEaExecutionUserIds:['u'],commandSigningKey:'test-cycle-signal-key-longer-than-32-bytes'});
  const allowed=await restarted.reentrySignalAllowed('u',e);a.equal(allowed.allowed,true);
  a.equal(allowed.cycleKey,['p','fill-'+i,close].join('|'));
  const later=event(at+500,close,side);
  a.equal(notificationKey({...e,brokerCycle:allowed.cycleKey}),notificationKey({...later,brokerCycle:allowed.cycleKey}),'one Telegram signal for the same actual broker-close cycle');
  a.equal(await restarted.reentrySignalAllowed('u',event(close-1,close-1000,side)),false,'old candidate cannot cross the close boundary');
 }
 pod.lastSeenAt=1;clock=100000;a.equal(await svc.reentrySignalAllowed('u',event(90000,80000,side)),false,'offline empty cache cannot authorize');
});
test('fresh cycles notify separately but retries retain the exact notification identity',()=>{
 const first=event(5000,3000),second=event(9000,7000);
 a.notEqual(notificationKey(first),notificationKey(second));
 a.equal(notificationKey(first),notificationKey({...first,setupKey:'arrival-changed',time:99999,telegramSop:{...first.telegramSop,signalObservedAt:5500}}));
 const legacy=e=>({...e,telegramSop:{...e.telegramSop,reentryPolicyVersion:undefined}});
 a.equal(notificationKey(legacy(first)),notificationKey(legacy(second)),'legacy and TF15 retain once-per-SOLID deduplication');
});
test('Telegram delivery suppresses open cycles and sends once per confirmed close across restart',async()=>{
 const {AnalysisAlerts}=require('../analysis-alert-service');
 const S=require('../tf2-ribbon-scalping');
 const m={symbol:'XAUUSD',timeframe:'2',setupKey:'initial',receivedAt:Date.now(),
 strategyNormal:{state:'READY',side:'BUY',sop:{reentryPolicyVersion:version,sopGreen:4,forecast:'BULLISH',marketPower:70,gates:[{pass:true},{pass:true}]},plan:{entry:103,sl:101,tp1:105,tp2:107,tp3:109}},positionManagement:{action:'HOLD'}};
 const alerts=new AnalysisAlerts();await alerts.init();await alerts.record(m);
 clearInterval(alerts.cleanupTimer);
 const base=alerts.events.find(e=>e.kind==='ENTRY');a.ok(base);
 a.equal(base.telegramSop.reentryPolicyVersion,version);
 const at=Date.now(),events=[0,1,2,3].map(i=>({...base,time:at,telegramSop:{...base.telegramSop,...event(at-100+i,at-1000).telegramSop,version:S.VERSION,tf:'2m',solid:true,solidHoldActive:true,solidClosedAt:null,gates:[{pass:true},{pass:true}],green:4,forecast:'BULLISH',power:70},telegramMarket:{signalObservedAt:at,entryAuthorizedAt:at}}));
 // Keep re-entry momentum/path proof while using a matching validated plan.
 for(const e of events){e.telegramSop.planMode='Fixed R:R';e.telegramSop.riskAtrReference=2;e.telegramPlan={entry:103,sl:101,tp1:105,tp2:107,tp3:109};}
 const claims=new Set(),sent=[],statuses=[];let batch=[];
 const pool={query:async(sql,args)=>{
  if(sql.startsWith("UPDATE zencore_telegram_deliveries SET status='sending'")){const rows=batch;batch=[];return {rows};}
  if(sql.startsWith('SELECT status,role'))return {rows:[{status:'active',role:'admin'}]};
  if(sql.startsWith('SELECT data FROM zencore_analysis_alerts'))return {rows:[{data:events[args[0]-1]}]};
  if(sql.startsWith('INSERT INTO zencore_telegram_chat_claims'))return {rows:[{}]};
  if(sql.startsWith('INSERT INTO zencore_telegram_signal_claims')){const key=args.join('|');if(claims.has(key))return {rows:[]};claims.add(key);return {rows:[{}]};}
  if(sql.startsWith('UPDATE zencore_telegram_deliveries SET status=$2')){statuses.push(args[1]);return {rows:[]};}
  throw Error(sql);
 }};
 let cycle=false;
 const service=()=>{const s=new AnalysisAlerts({pool,reentryAllowed:async()=>cycle});s.get=async()=>({telegramEnabled:true,verified:true,telegramId:'chat'});s.telegram=async(_,text)=>sent.push(text);return s;};
 for(let i=0;i<4;i++){
  cycle=i===0?false:{allowed:true,cycleKey:i===3?'close-2':'close-1'};
  batch=[{id:i+1,event_id:i+1,user_id:'u'}];await service().deliver();
 }
 a.deepEqual(statuses,['skipped','sent','skipped','sent']);a.equal(sent.length,2);
});
