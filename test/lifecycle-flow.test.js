'use strict';
const test=require('node:test'),a=require('node:assert/strict');
const {MemoryAutoTradeStore}=require('../auto-trade-store'),{createAutoTradeService,tokenHash}=require('../auto-trade-service'),L=require('../setup-lifecycle');
function frame(tf,side,at,parent,path){
 const sign=side==='BUY'?1:-1,S=require(tf==='2'?'../tf2-ribbon-scalping':tf==='3'?'../tf3-scalping':'../tf15-intraday');
 const row=Array(67).fill(null),entry=parent?4100+sign*3:4100,source=at-900000;
 Object.assign(row,{0:'XAUUSD',1:at-900000,6:entry,13:sign*4,14:sign,16:35,21:4,22:entry,23:entry-sign*(tf==='2'?3:4),24:entry-sign*(tf==='2'?3:4),25:entry+sign*4,26:entry+sign*8,27:entry+sign*12,28:true,29:side==='BUY',34:side,35:true,36:true,37:true,38:true,39:true,40:true,41:true,42:side==='BUY'?'BULLISH':'BEARISH',43:70,48:'HOLD',49:'HOLD',52:100,56:0,57:'INITIAL',58:'NONE',59:false});
 row[65]={version:`HEMA${tf}_LIVE_V1`,['tf'+tf]:{fast:4100+sign*2,slow:4100+sign,fastPreviousBar:4100+sign,slowPreviousBar:4100+sign*.5}};
 row[66]={entryRuleVersion:S.RULE,exitLockVersion:S.POLICY.exitLockVersion,entryPolicyVersion:S.POLICY.entryPolicyVersion,planMode:'Fixed R:R',riskPlanVersion:S.RISK,atrPeriod:tf==='2'?10:14,solidSide:side,solidHoldActive:true,solidClosedAt:null,solidTriggeredAt:source,sourceSetupAt:source,setupAt:parent?at:source,sourceEntry:4100-sign,solidEligible:true,completedAt:at,completionPrice:entry,riskAtrReference:4,riskTick:.01,entryEvent:true,entryAuthorizedAt:at,entryDeliveryVersion:'FIXED_EVENT_RETRY_V1',lifecycleVersion:L.VERSION,cycleKind:parent?'FOLLOWUP':'INITIAL',reentryContext:{parentQualifiedAt:parent||null,previousHigh:4102,previousLow:4098,fastPrevious:4100+sign,slowPrevious:4100+sign*.5,wtGapPrevious:2,pricePath:path||[]},dashboardAi:{momentum:side==='BUY'?'Bullish 🟢':'Bearish 🔴',mtfScore:sign,dashboard:{mtfTimeframes:S.POLICY.mtf,htfRibbonTimeframe:tf}}};
 const batch={feedVersion:`TF${tf}_REALTIME_V1`,timeframe:tf,schemaVersion:'32.3-EXIT-STEPLOCK',feedUpdateVersion:'SPLIT_CHANNEL_BOOTSTRAP_V2',feedChannel:'EXECUTION',confirmed:false,emittedAt:at,markets:[row]};
 return {row,batch};
}
for(const tf of ['2','3','15'])for(const side of ['BUY','SELL'])test(`TF${tf} ${side}: actual close -> post-close pullback -> strong SOP -> one fresh full-layer entry`,async()=>{
 const hubPath=tf==='2'?'../tf2-ribbon-market-hub':tf==='3'?'../tf3-market-hub':'../tf15-market-hub';delete require.cache[require.resolve(hubPath)];const hub=require(hubPath);
 let at=Date.now()+100,current;const initialAt=at,store=new MemoryAutoTradeStore(),user='flow-'+tf+side,token='zcpod_'+(side==='BUY'?'a':'b').repeat(48),hash=tokenHash(token);
 const pod={id:user,userId:user,tokenHash:hash,ownershipMode:'TRADER_OWNED_EA_LOCAL',lastSeenAt:at,tradeMode:'DEMO',terminalTradeAllowed:true,accountTradeAllowed:true,expertTradeAllowed:true,demoExecutionUnlocked:true,connectorVersion:'1.4.0-ea-local',symbolSpecs:{}};store.podsByUser.set(user,pod);store.podsByToken.set(hash,pod);
 const svc=createAutoTradeService({store,now:()=>at,scalpingTimeframe:tf==='2'?'2':'3',allowLocalEaExecution:true,commandSigningKey:'test-signing-key-more-than-thirty-two-bytes',getLatestMarket:()=>current});
 await svc.saveSettings(user,{capitalUsd:1000,lotPerLayer:.01,layers:2,symbols:['XAUUSD'],strategyMode:tf==='15'?'TF15_INTRA':'TF2_SCALPING',riskAcknowledged:true,tradingSchedule:{enabled:false,skipNews:false}});await store.setControl(user,{desiredState:'ON',effectiveState:'ON'});
 current=hub.ingest(frame(tf,side,at).batch,at)[0];a.equal(current.strategyNormal.state,'READY');a.equal((await svc.dispatchMarkets([current])).queued,1);
 const first=(await svc.nextCommand(token)).command;a.ok(first);await svc.acknowledgeCommand(token,first.id,{status:'EXECUTED',code:'SETUP_OPENED'});
 const hb={accountMask:'****1234',serverMask:'****Demo',brokerMask:'****MT5',tradeMode:'DEMO',terminalConnected:true,terminalTradeAllowed:true,accountTradeAllowed:true,expertTradeAllowed:true,demoExecutionUnlocked:true,connectorVersion:'1.4.0-ea-local',accountFingerprint:'c'.repeat(64),positions:[],symbolSpecs:[]};
 at+=10;await svc.heartbeat(token,{...hb,positions:[{ticket:'123456',symbol:'XAUUSD',side,volume:.01,entry:4100,strategyMode:tf==='15'?'TF15_INTRA':'TF2_SCALPING',setupId:first.id.slice(0,20)}]});
 at+=10;await svc.heartbeat(token,hb);const closedAt=at,sign=side==='BUY'?1:-1;
 at+=10;let f=frame(tf,side,at,initialAt,[[initialAt+1,4100],[initialAt+2,4100+sign],[initialAt+3,4100+sign*.5],[initialAt+4,4100+sign*3]]);current=hub.ingest(f.batch,at)[0];a.equal(current.strategyNormal.state,'READY');a.equal((await svc.dispatchMarkets([current])).queued,0);
 at+=10;f=frame(tf,side,at,initialAt,[[closedAt+1,4100],[closedAt+2,4100+sign],[closedAt+3,4100+sign*.5],[at,4100+sign*3]]);current=hub.ingest(f.batch,at)[0];a.equal(current.strategyNormal.state,'READY');a.equal((await svc.dispatchMarkets([current])).queued,1);a.equal((await svc.dispatchMarkets([current])).queued,0);
 const next=(await svc.nextCommand(token)).command;a.ok(next);a.equal(next.payload.layers,2);a.equal(next.payload.side,side);a.equal(next.payload.analysisSnapshot.cycleKind,'FOLLOWUP');a.notEqual(next.payload.analysisSnapshot.setupKey,first.payload.analysisSnapshot.setupKey);a.notEqual(next.payload.entry,first.payload.entry);
 const audit=await store.listAudit(user,100);a.ok(audit.some(x=>x.type==='ENTRY_BLOCKED'&&x.detail.reason==='WAIT_PULLBACK_MOMENTUM_AFTER_CLOSE'));a.ok(audit.some(x=>x.type==='MT5_POSITION_OBSERVED'));a.ok(audit.some(x=>x.type==='ENTRY_DELIVERED'));a.ok(audit.some(x=>x.type==='SETUP_QUEUED'&&Number.isFinite(x.detail.sopToWebhookMs)));
 const alerts=new (require('../analysis-alert-service').AnalysisAlerts)();await alerts.init();
 try{await alerts.record(current);const event=alerts.events.find(x=>x.kind==='ENTRY');a.ok(event);const t=require('../analysis-telegram');a.equal(t.entrySopAllowed(event),true);a.match(t.telegramMessage(event),new RegExp('RE-ENTRY TF'+tf));const msg=t.telegramMessage(event);a.match(msg,/Guna pelan baharu/);a.match(msg,/semua posisi TF[0-9]+ disahkan tutup/);a.match(msg,/Guna pelan baharu/);a.ok(msg.includes('Entry: '+new Intl.NumberFormat('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}).format(next.payload.entry)));}finally{clearInterval(alerts.cleanupTimer);}
 current.strategyNormal.sop.reentryContext.wtGapPrevious=10;a.equal(require('../entry-delivery-check').checkEntryDelivery(next,current,at).reason,'REENTRY_MOMENTUM_CHANGED');
 // The actual re-entry gets its own exit plan even when Pine moves to another candidate.
 await svc.acknowledgeCommand(token,next.id,{status:'EXECUTED',code:'SETUP_OPENED'});
 at+=10;const own={ticket:'654321',symbol:'XAUUSD',side,volume:.01,entry:next.payload.entry+sign*.05,currentPrice:next.payload.tp1,activeSl:next.payload.sl,openedAt:at-1,strategyMode:next.payload.strategyMode,setupId:next.id.slice(0,20)};
 await svc.heartbeat(token,{...hb,positions:[own]});
 const rejected={id:'ffffffff-ffff-4fff-8fff-ffffffffffff',userId:user,podId:pod.id,type:'PLACE_SETUP',payload:next.payload,createdAt:at,expiresAt:at+60000};
 await store.createCommand(rejected);await store.ackCommand(pod.id,rejected.id,'REJECTED',{code:'BROKER_ENTRY_REJECTED'});
 current={...current,receivedAt:at,signalObservedAt:at,entryEvent:false,setupKey:'NEW-UNEXECUTED-CANDIDATE',positionManagement:{action:'HOLD'}};
 await svc.dispatchMarkets([current]);
 const locked=(await svc.nextCommand(token)).command;a.ok(locked);a.equal(locked.type,'MANAGE_POSITION');a.equal(locked.payload.analysisSnapshot.entryCommandId,next.id);
 a.equal(locked.payload.actions[0].activeSl,next.payload.entry+(tf==='15'?0:sign*1.50));
 const view=await svc.state(user);a.equal(view.positions[0].exitPlan.entryKind,'RE-ENTRY');a.equal(view.positions[0].exitPlan.tp1,next.payload.tp1);a.equal(view.positions[0].exitPlan.sl,next.payload.sl);a.equal(view.positions[0].entry,own.entry);
 // An old management command cannot act on the next cycle once MT5 is flat.
 at+=10;await svc.heartbeat(token,hb);a.equal((await svc.nextCommand(token)).command,null);

});
test('expired original event is WAIT while SOLID is still held, and new Pine source includes lifecycle evidence',()=>{
 const f=frame('3','BUY',Date.now()-61000);const hub=require('../tf3-market-hub');const d=hub.decode?hub.decode(f.row,f.batch):null;
 const S=require('../tf3-scalping');const h=require('../tf3-market-hub'); // Decode through a fresh current transport snapshot.
 f.batch.emittedAt=Date.now();f.row[66].entryEvent=false;delete require.cache[require.resolve('../tf3-market-hub')];const m=require('../tf3-market-hub').ingest(f.batch)[0];a.ok(m);a.equal(m.strategyNormal.solid,true);a.equal(m.strategyNormal.state,'WAIT');a.equal(m.strategyNormal.lifecycleState,'EVENT_EXPIRED');
 for(const tf of ['3','15']){const text=require('fs').readFileSync(`ZenCore_TF${tf}_${tf==='3'?'Scalp':'Intraday'}.pine`,'utf8');a.match(text,/string htf_sop = timeframe.period/);a.match(text,/zc_seq_bar := timenow/);a.match(text,/array.size\(zc_path_times\) > 120/);a.match(text,/zc_reentry_momentum/);}
});
test('TF15 missed position transition: disconnected/truncated snapshots never recover; fresh full MT5 snapshots do',async()=>{
 let at=Date.now(),current;const store=new MemoryAutoTradeStore(),user='missed-flow',token='zcpod_'+'r'.repeat(48),hash=tokenHash(token);
 const pod={id:'missed-pod',userId:user,tokenHash:hash,ownershipMode:'TRADER_OWNED_EA_LOCAL',lastSeenAt:at,tradeMode:'DEMO',demoExecutionUnlocked:true,terminalTradeAllowed:true,accountTradeAllowed:true,expertTradeAllowed:true,connectorVersion:'1.4.0-ea-local',symbolSpecs:{}};
 store.podsByUser.set(user,pod);store.podsByToken.set(hash,pod);
 const svc=createAutoTradeService({store,now:()=>at,scalpingTimeframe:'3',allowLocalEaExecution:true,commandSigningKey:'test-signing-key-more-than-thirty-two-bytes',getLatestMarket:()=>current});
 await svc.saveSettings(user,{capitalUsd:1000,lotPerLayer:.01,layers:1,symbols:['XAUUSD'],strategyMode:'TF15_INTRA',riskAcknowledged:true,tradingSchedule:{enabled:false,skipNews:false}});await store.setControl(user,{desiredState:'ON',effectiveState:'ON'});
 const hubPath='../tf15-market-hub';delete require.cache[require.resolve(hubPath)];const hub=require(hubPath);
 current=hub.ingest(frame('15','BUY',at).batch,at)[0];a.equal((await svc.dispatchMarkets([current])).queued,1);
 const first=(await svc.nextCommand(token)).command;await svc.acknowledgeCommand(token,first.id,{status:'EXECUTED',code:'SETUP_OPENED'});
 at+=20000;current=hub.ingest(frame('15','BUY',at).batch,at)[0];a.equal((await svc.dispatchMarkets([current])).queued,0);
 const hb={accountMask:'****1234',serverMask:'****Demo',brokerMask:'****MT5',tradeMode:'DEMO',terminalConnected:true,terminalTradeAllowed:true,accountTradeAllowed:true,expertTradeAllowed:true,demoExecutionUnlocked:true,connectorVersion:'1.4.0-ea-local',accountFingerprint:'d'.repeat(64),positions:[],symbolSpecs:[]};
 await svc.heartbeat(token,{...hb,terminalConnected:false});at+=6000;await svc.heartbeat(token,{...hb,terminalConnected:false});a.equal(await store.lastStrategyCycleReset(user,pod.id,'TF15_INTRA'),null);
 const many=Array.from({length:50},(_,i)=>({ticket:String(1000+i),symbol:'XAUUSD',side:'BUY',volume:.01,entry:4100,origin:'MANUAL'}));
 await svc.heartbeat(token,{...hb,positions:many});at+=6000;await svc.heartbeat(token,{...hb,positions:many});a.equal(await store.lastStrategyCycleReset(user,pod.id,'TF15_INTRA'),null);
 at+=100;await svc.heartbeat(token,hb);a.equal(await store.lastStrategyCycleReset(user,pod.id,'TF15_INTRA'),null);
 at+=5000;await svc.heartbeat(token,hb);const reset=await store.lastStrategyCycleReset(user,pod.id,'TF15_INTRA');a.equal(reset.source,'CONFIRMED_FLAT_SNAPSHOTS');a.equal(reset.closedAt,at);
 a.equal((await svc.dispatchMarkets([current])).queued,0,'old chart entry cannot be replayed');
 const profile=await store.getProfile(user);a.equal(profile.desiredState,'ON');a.equal(profile.effectiveState,'ON');
 a.equal(await store.lastStrategyCycleReset(user,pod.id,'TF2_SCALPING'),null);
});
for(const tf of ['3','15'])test(`TF${tf} fresh native SOLID after old close can queue normal entry without FOLLOWUP momentum`,async()=>{
 let at=Date.now()+100;const store=new MemoryAutoTradeStore(),user='native-'+tf,token='zcpod_'+'n'.repeat(48),hash=tokenHash(token);
 const pod={id:user,userId:user,tokenHash:hash,ownershipMode:'TRADER_OWNED_EA_LOCAL',lastSeenAt:at,tradeMode:'DEMO',demoExecutionUnlocked:true,terminalTradeAllowed:true,accountTradeAllowed:true,expertTradeAllowed:true,connectorVersion:'1.4.0-ea-local',symbolSpecs:{}};store.podsByUser.set(user,pod);store.podsByToken.set(hash,pod);
 const svc=createAutoTradeService({store,now:()=>at,scalpingTimeframe:'3',allowLocalEaExecution:true,commandSigningKey:'test-signing-key-more-than-thirty-two-bytes'});
 await svc.saveSettings(user,{capitalUsd:1000,lotPerLayer:.01,layers:2,symbols:['XAUUSD'],strategyMode:tf==='15'?'TF15_INTRA':'TF2_SCALPING',riskAcknowledged:true,tradingSchedule:{enabled:false,skipNews:false}});await store.setControl(user,{desiredState:'ON',effectiveState:'ON'});
 await store.appendAudit(user,'STRATEGY_CYCLE_RESET',{podId:pod.id,mode:tf==='15'?'TF15_INTRA':'TF2_SCALPING',closedAt:at-172800000});
 const f=frame(tf,'BUY',at);f.row[66].sourceSetupAt=at-180000;f.row[66].solidTriggeredAt=at-179000;
 a.equal(L.momentum('BUY',{reentryContext:{}}),false);
 const path=tf==='3'?'../tf3-market-hub':'../tf15-market-hub';delete require.cache[require.resolve(path)];const current=require(path).ingest(f.batch,at)[0];a.equal(current.strategyNormal.state,'READY');
 a.equal((await svc.dispatchMarkets([current])).queued,1);a.equal((await svc.dispatchMarkets([current])).queued,0);
 const command=(await store.listRecentCommands(user))[0];a.equal(command.type,'PLACE_SETUP');a.equal(command.payload.layers,2);a.equal(command.payload.analysisSnapshot.cycleKind,'INITIAL');
});

for(const tf of ['2','15'])test(`TF${tf}: queued entry is cancelled when heartbeat reveals a remaining layer before delivery; settings stay unchanged`,async()=>{
 let at=Date.now()+100,current;
 const store=new MemoryAutoTradeStore(),user='delivery-race-'+tf,token='zcpod_'+'s'.repeat(48),hash=tokenHash(token);
 const pod={id:user,userId:user,tokenHash:hash,ownershipMode:'TRADER_OWNED_EA_LOCAL',lastSeenAt:at,tradeMode:'DEMO',demoExecutionUnlocked:true,terminalTradeAllowed:true,accountTradeAllowed:true,expertTradeAllowed:true,connectorVersion:'1.4.0-ea-local',symbolSpecs:{}};
 store.podsByUser.set(user,pod);store.podsByToken.set(hash,pod);
 const svc=createAutoTradeService({store,now:()=>at,scalpingTimeframe:'2',allowLocalEaExecution:true,commandSigningKey:'test-signing-key-more-than-thirty-two-bytes',getLatestMarket:()=>current});
 await svc.saveSettings(user,{capitalUsd:1000,lotPerLayer:.01,layers:2,symbols:['XAUUSD'],strategyMode:tf==='15'?'TF15_INTRA':'TF2_SCALPING',riskAcknowledged:true,tradingSchedule:{enabled:false,skipNews:false}});
 await store.setControl(user,{desiredState:'ON',effectiveState:'ON'});
 const settings=await store.getProfile(user);
 const hubPath=tf==='2'?'../tf2-ribbon-market-hub':'../tf15-market-hub';delete require.cache[require.resolve(hubPath)];
 current=require(hubPath).ingest(frame(tf,'BUY',at).batch,at)[0];
 a.equal((await svc.dispatchMarkets([current])).queued,1);
 const hb={accountMask:'****1234',serverMask:'****Demo',brokerMask:'****MT5',tradeMode:'DEMO',terminalConnected:true,terminalTradeAllowed:true,accountTradeAllowed:true,expertTradeAllowed:true,demoExecutionUnlocked:true,connectorVersion:'1.4.0-ea-local',accountFingerprint:'a'.repeat(64),positions:[{ticket:'123456',symbol:'XAUUSD',side:'BUY',volume:.01,entry:4100,strategyMode:tf==='15'?'TF15_INTRA':'TF2_SCALPING'}],symbolSpecs:[]};
 at+=10;await svc.heartbeat(token,hb);
 a.equal((await svc.nextCommand(token)).command,null);
 a.equal((await svc.dispatchMarkets([current])).queued,0);
 const after=await store.getProfile(user);
 for(const key of ['capitalUsd','lotPerLayer','layers','modeSettings','strategyExitPolicies','tradingSchedule','desiredState','effectiveState'])a.deepEqual(after[key],settings[key],key+' remains unchanged');
});
