'use strict';
const test=require('node:test'),a=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const E=require('../tf2-solid-hold-v5'),R=require('../tf2-scalp-range'),C=require('../analysis-execution-contract'),T=require('../analysis-telegram'),M=require('../tf2-live-management');
function data(side='BUY'){
 const t=Date.now(),sign=side==='BUY'?1:-1,p=R.levels(side,4153.22,3.25);
 return {symbol:'XAUUSD',timeframe:'2',receivedAt:t,signalObservedAt:t,entryAuthorizedAt:t,entryEvent:true,feedChannel:'EXECUTION',feedUpdateVersion:'SPLIT_CHANNEL_BOOTSTRAP_V2',price:p.entry,close:p.entry,normal3Close:p.entry,normal3Entry:p.entry,normal3Atr:3.25,initialSl:p.sl,tp1:p.tp1,tp2:p.tp2,tp3:p.tp3,waveTrend1:sign*2,waveTrend2:sign,normal3Sop1:true,normal3Sop2:true,normal3Sop3:true,normal3Sop4:true,normal3Sop5:true,normal3Forecast:side==='BUY'?'BULLISH':'BEARISH',normal3MarketPower:60,hemaConfirmation:{tf2:{fast:4153+sign,slow:4153,fastPreviousBar:4153,slowPreviousBar:4153-sign}},setupMeta:{entryRuleVersion:E.RULE,riskPlanVersion:R.VERSION,solidHoldActive:true,solidClosedAt:null,solidSide:side,solidTriggeredAt:t-240000,setupAt:t-240000,sourceEntry:p.entry-sign*.2,solidEligible:true,completedAt:t,completionPrice:p.entry,riskAtrReference:3.25,dashboardAi:{mtfScore:-sign}}};
}
test('V5 qualifies five of six for both directions while HEMA40 remains mandatory',()=>{
 for(const side of ['BUY','SELL']){const x=data(side),n=E.strategy(x);a.equal(n.sop.passed,5);a.equal(n.state,'READY');a.ok(C.createEntryDecision({...x,strategyNormal:n}));
 const s={...n.sop,version:E.VERSION,tf:'2m',green:5,power:60};a.ok(T.entrySopAllowed({symbol:'XAUUSD',timeframe:'2',side,telegramPlan:n.plan,telegramSop:s}));
 x.hemaConfirmation.tf2.slowPreviousBar=x.hemaConfirmation.tf2.slow;a.equal(E.strategy(x).state,'WAIT');}
});
test('four confirmations, cancelled SOLID and stale data still block V5',()=>{
 for(const mutate of [x=>x.normal3MarketPower=40,x=>x.setupMeta.solidClosedAt=x.signalObservedAt,x=>x.signalObservedAt-=60000]){
 const x=data();mutate(x);a.equal(C.createEntryDecision({...x,strategyNormal:E.strategy(x)}),null);}
});
function packet(action='CLOSE_50_NOW'){
 const row=Array(67).fill(null),t=Date.now();row[0]='XAUUSD';row[22]=4153.22;row[24]=4150;row[34]='BUY';row[48]=action==='CLOSE_50_NOW'?'WAIT_YELLOW':'CLOSED';row[49]=action;row[50]=true;row[52]=action==='CLOSE_50_NOW'?50:0;row[66]={entryRuleVersion:E.RULE,setupAt:t-240000};
 return {row,batch:{timeframe:'2',confirmed:false,emittedAt:t,feedChannel:'EXECUTION',feedUpdateVersion:'SPLIT_CHANNEL_BOOTSTRAP_V2',feedVersion:'TF2_REALTIME_V1',schemaVersion:'32.3-EXIT-STEPLOCK'}};
}
test('fresh intrabar half/full/SL exits survive actual compact receiver into management contract',()=>{
 const code=fs.readFileSync(require.resolve('../server-v17'),'utf8'),ctx={require:require('node:module').createRequire(require.resolve('../server-v17'))};
 vm.runInNewContext(code.slice(code.indexOf('function expandCompactMarket('),code.indexOf('function storeSnapshot(')),ctx);
 for(const action of ['CLOSE_50_NOW','EXIT_ALL','EXIT_REMAINING','EXIT_SL']){const {row,batch}=packet(action),d=ctx.expandCompactMarket(row,batch);a.equal(d.positionExitAction,action);
 const n=E.strategy(data()),decision=C.createManagementDecision({symbol:'XAUUSD',timeframe:'2',receivedAt:Date.now(),setupKey:d.setupKey,strategyNormal:n,positionManagement:{action:d.positionExitAction}});
 a.equal(decision.snapshot.actions[0].percent,action==='CLOSE_50_NOW'?50:100);}
});
test('Dashboard, stale, future, invalid state and wrong timeframe cannot issue intrabar exits',()=>{
 for(const mutate of [p=>p.batch.feedChannel='DASHBOARD',p=>p.batch.emittedAt-=60000,p=>p.batch.emittedAt+=60000,p=>p.row[52]=100,p=>p.batch.timeframe='15',p=>p.row[66].setupAt=null]){
 const p=packet();mutate(p);a.equal(M.allow(p.row,p.batch),false);}
 for(const confirmed of [false,true]){const p=packet();p.batch.feedChannel='DASHBOARD';p.batch.confirmed=confirmed;a.equal(M.block(p.row,p.batch),true);}
});
test('management commands deduplicate by setup and action across receipts and retain TF isolation',()=>{
 const x=data(),m={symbol:'XAUUSD',timeframe:'2',receivedAt:Date.now(),setupKey:'TF2|XAUUSD|BUY|one',strategyNormal:E.strategy(x),positionManagement:{action:'CLOSE_50_NOW'}};
 const first=C.createManagementDecision(m);a.equal(C.createManagementDecision({...m,receivedAt:m.receivedAt+1000}).managementKey,first.managementKey);
 a.notEqual(C.createManagementDecision({...m,setupKey:'TF2|XAUUSD|BUY|two'}).managementKey,first.managementKey);
 a.notEqual(C.createManagementDecision({...m,positionManagement:{action:'EXIT_REMAINING'}}).managementKey,first.managementKey);
});
test('Telegram entry prices use exactly two decimals; exit messages label half and all',()=>{
 const x=data('SELL'),n=E.strategy(x),msg=T.telegramMessage({kind:'ENTRY',id:1,time:Date.now(),timeframe:'2',symbol:'XAUUSD',side:'SELL',telegramPlan:n.plan,telegramSop:{...n.sop,version:E.VERSION,tf:'2m',green:5,power:60}});
 for(const key of ['Entry','SL','TP1','TP2','TP3'])a.match(msg,new RegExp(String.raw`${key}: [0-9,]+\.[0-9]{2}(?=\s|$)`));
 a.doesNotMatch(msg,/[0-9]+\\.[0-9]{3,}/);
 for(const percent of [50,100])a.match(T.telegramMessage({kind:'CLOSE',percent,timeframe:'2',symbol:'XAUUSD',time:Date.now(),id:2,message:'Chart exit'}),percent===50?/CLOSE SEPARUH/:/CLOSE ALL/);
});
test('Pine half exit comes from original chart label; opposite colour exit waits for confirmed next candle',()=>{
 const s=fs.readFileSync(require.resolve('../ZenCore_Original_Full_TF2_Scalp_Caps.pine'),'utf8');
 a.match(s,/else if current_condition == 2\s+zc_partial_pulse := true/);
 a.match(s,/bool xc_partial = zc_partial_pulse and zc_partial_buy == xc_buy/);
 a.match(s,/xc_half and barstate.isconfirmed and bar_index > xc_half_bar and xc_opposite_colour/);
 a.match(s,/is_bar_bearish or/);a.match(s,/is_bar_bullish or/);
 a.match(s,/zc24_completed and not xc_full_event_sent/);a.ok(s.includes('zc24_completed ? "IDLE" : zc24_half_armed'));a.match(s,/zc24_half_armed and not xc_half_event_sent/);
 a.match(s,/if zc24_channel == "Execution"\s+if zc24_exit_action == "CLOSE_50_NOW"/);
 a.equal((s.match(/array.push\(zc24_parts,/g)||[]).length,67);
});
