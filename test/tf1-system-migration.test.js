'use strict';
const {test}=require('node:test'),a=require('node:assert/strict'),fs=require('node:fs'),cp=require('node:child_process');
const Hub=require('../tf2-ribbon-market-hub'),Direct=require('../pine-direct-entry'),Core=require('../auto-trade-core');
const S=require('../tf2-ribbon-scalping'),C=require('../analysis-execution-contract');
const {fixture}=require('./tf1-fixture.cjs');
for(const symbol of ['XAUUSD','BTCUSD'])for(const side of ['BUY','SELL'])test(`TF1 ${symbol} ${side}: compact webhook -> analysis -> EA transport keeps direction and timeframe`,()=>{
 const f=fixture(symbol,side),m=Hub.ingest(f.batch,f.now)[0];a.ok(m);a.equal(m.timeframe,'1');a.equal(m.strategyNormal.tf,'1m');a.equal(m.strategyNormal.state,'READY',m.strategyNormal.reason);
 const settings={capitalUsd:1000,lotPerLayer:.01,layers:6,symbols:[symbol],strategyMode:'TF2_SCALPING',riskAcknowledgedAt:1};
 const c=Core.buildSetupCommand(m,settings,null,f.now);a.ok(c);a.equal(c.payload.side,side);a.equal(c.payload.layers,6);a.equal(c.payload.analysisSnapshot.executionTimeframe,'1');a.equal(c.payload.analysisSnapshot.analysisSopVersion,'NORMAL_20261001_TF1_RIBBON_V1');a.equal(c.payload.strategyMode,'TF2_SCALPING');
 const input={id:'00000000-0000-4000-8000-000000000001',type:'PLACE_SETUP',expiresAt:f.now+60000,payload:c.payload};
 const p=cp.spawnSync('python',['-c',"import json,sys;sys.path.insert(0,'ea-local-connector');from protocol import command_fields;print(json.dumps(command_fields(json.load(sys.stdin),{'account':'123','server':'TEST','tradeMode':'DEMO'})))"],{input:JSON.stringify(input),encoding:'utf8'});
 a.equal(p.status,0,p.stderr);const fields=JSON.parse(p.stdout);a.equal(fields.side,side);a.equal(fields.executionTimeframe,'1');a.equal(Number(fields.entry),f.row[22]);a.equal(Number(fields.sl),f.row[23]);
});
for(const side of ['BUY','SELL'])test(`TF1 ${side}: opposite/flat/missing HEMA cannot bypass through direct entry`,()=>{
 for(const kind of ['opposite','flat','missing']){
  const f=fixture('XAUUSD',side),sign=side==='BUY'?1:-1,h=f.row[65].tf1;
  h.fast=kind==='opposite'?4000-sign:kind==='flat'?4000:null;f.row[10]=h.fast;
  const m=Hub.ingest(f.batch,f.now)[0];a.ok(m);a.equal(Direct.decision(m),null);a.equal(m.strategyNormal.state,'WAIT');a.equal(C.createEntryDecision({...m,strategyNormal:{...m.strategyNormal,state:'READY'}}),null);
 }
});
test('TF1 confirms exactly one minute; a two minute timestamp is rejected',()=>{
 const b=require('../tf2-bar-close'),f=fixture(),m=Hub.ingest(f.batch,f.now)[0];a.equal(b.confirmed(m),true);m.setupMeta.decisionBarCloseAt+=60000;a.equal(b.confirmed(m),false);
});
test('old TF2 batches cannot open a new scalping order',()=>{
 const f=fixture();f.batch.timeframe='2';f.batch.feedVersion='TF2_REALTIME_V1';a.deepEqual(Hub.ingest(f.batch,f.now),[]);
 a.equal(Direct.decision({timeframe:'2',entryEvent:true}),null);
});
test('TF1 Dashboard reports analysis but cannot open an order',()=>{
 const f=fixture();f.batch.feedChannel='DASHBOARD';const m=Hub.ingest(f.batch,f.now)[0];a.ok(m);a.equal(Direct.decision(m),null);a.equal(C.createEntryDecision(m),null);
});
test('TF1 entry/exit Telegram and chart history stay in the same timeframe',async()=>{
 const f=fixture(),m=Hub.ingest(f.batch,f.now)[0],A=require('../analysis-alert-service').AnalysisAlerts,T=require('../analysis-telegram'),svc=new A();await svc.init();
 try{await svc.record(m);const e=svc.events.find(e=>e.kind==='ENTRY');a.ok(e);a.equal(e.timeframe,'1');a.equal(T.entrySopAllowed(e),true);a.match(T.telegramMessage(e),/ENTRY TF1/);
 const close={...m,entryEvent:false,receivedAt:f.now+1,signalObservedAt:f.now+1,positionManagement:{action:'EXIT_ALL',reason:'Native close'}};await svc.record(close);a.ok(svc.events.some(e=>e.kind==='CLOSE'&&e.timeframe==='1'));
 a.ok(require('../indicator-chart-history').history.snapshot('1',f.now,'XAUUSD').candles.some(c=>c.time===m.time));
 }finally{clearInterval(svc.cleanupTimer);}
});
test('TF1 + TF15 views remain independent; TF2 is never relabelled as fresh TF1',()=>{
 const f=fixture(),m=Hub.ingest(f.batch,f.now)[0],model=require('../analysis-dual-model');
 const old={...m,timeframe:'2',strategyNormal:{...m.strategyNormal,tf:'2m'}};
 a.equal(model.dualAnalysis([old],'XAUUSD',f.now).views[0].market,null);
 const views=model.dualAnalysis([m,{...m,timeframe:'15',strategyNormal:{...m.strategyNormal,tf:'15m'}}],'XAUUSD',f.now).views;
 a.deepEqual(views.map(v=>v.timeframe),[1,15]);a.equal(views[0].confirmationTimeframe,1);a.equal(views[1].confirmationTimeframe,30);
});
test('dashboard and Auto Trade use real one-minute selectors and matching chart hosts',()=>{
 const read=n=>fs.readFileSync(require.resolve('../'+n),'utf8'),home=read('home.html'),trade=read('auto-trade.html');
 a.match(home,/id="dashboardChart1"/);a.match(home,/id="dashboardBitcoinChart1"/);a.match(home,/data-chart-tf="1"/);a.doesNotMatch(home,/value="2"|data-chart-tf="2"/);
 a.match(read('trading-cockpit.js'),/let chartTf=1/);a.match(trade,/value="1">TF1/);a.match(trade,/id="btcTf1Lot"/);a.match(trade,/id="manualTp1"[^>]*value="2"/);
});
test('manual exit compatibility and saved scalping settings retain their signed storage identities',()=>{
 const result=Core.validateSettings({capitalUsd:900,lotPerLayer:.01,layers:6,symbols:['XAUUSD','BTCUSD'],strategyMode:'BOTH',riskAcknowledged:true});a.equal(result.ok,true);
 a.ok(result.value.modeSettings.TF2_SCALPING);a.equal(result.value.manualExit.version,'MANUAL_TF2_EXIT_V2');
});
test('a confirmed TF1 close continues to protect an already open TF2 setup without changing its levels',()=>{
 const f=fixture(),m=Hub.ingest(f.batch,f.now)[0],built=Core.buildSetupCommand(m,{capitalUsd:1000,lotPerLayer:.01,layers:2,symbols:['XAUUSD'],strategyMode:'TF2_SCALPING'},null,f.now);
 const old=structuredClone(built);old.type='PLACE_SETUP';old.status='EXECUTED';old.id='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
 old.payload.analysisSnapshot.executionTimeframe='2';old.payload.analysisSnapshot.analysisSopVersion='NORMAL_20261001_TF2_RIBBON_V1';
 const original=structuredClone(old.payload);
 const positions=[{symbol:'XAUUSD',strategyMode:'TF2_SCALPING',origin:'ZENCORE',side:'BUY',setupId:old.id.slice(0,20),openedAt:f.now-1000,fillRiskVersion:'MT5_FILL_PLAN_V1'}];
 const native=require('../native-chart-exit'),P=require('../pine-position-plan');
 a.equal(P.valid(old),true);
 const hold=native.forActiveSetup(m,old,positions,'TF2_SCALPING',f.now);a.equal(hold,m);
 const close=native.forActiveSetup({...m,nativeChartExitAll:true,entryEvent:false},old,positions,'TF2_SCALPING',f.now);
 a.equal(close.timeframe,'2');a.equal(close.sourceExecutionTimeframe,'1');
 const managed=P.management(close,positions,old,f.now);a.ok(managed);const decision=C.createManagementDecision(managed);a.ok(decision);
 a.equal(decision.snapshot.entryCommandId,old.id);a.equal(decision.snapshot.analysisSopVersion,'NORMAL_20261001_TF2_RIBBON_V1');a.equal(decision.snapshot.actions[0].percent,100);
 a.deepEqual(old.payload,original);
});
