'use strict';
const {test}=require('node:test'),a=require('node:assert/strict');
const Safety=require('../tf2-entry-safety'),S=require('../tf2-ribbon-scalping'),Hub=require('../tf2-ribbon-market-hub'),C=require('../analysis-execution-contract');let seq=0;
function fixture(side='BUY'){
 const now=Date.now()+ ++seq,sign=side==='BUY'?1:-1,row=Array(67).fill(null),t=now-180000;
 Object.assign(row,{0:'XAUUSD',1:t,6:4100,13:sign*2,14:sign,16:35,21:4,22:4100,23:4100-sign*3,24:4100-sign*3,25:4100+sign*4,26:4100+sign*8,27:4100+sign*12,28:true,29:side==='BUY',34:side,35:true,36:true,37:true,38:true,39:true,40:true,41:true,42:side==='BUY'?'BULLISH':'BEARISH',43:60,48:'HOLD',49:'HOLD',52:100,56:0,57:'INITIAL',58:'NONE',59:false});
 row[65]={version:'HEMA2_LIVE_V1',tf2:{fast:4100+sign,slow:4100,fastPreviousBar:4100,slowPreviousBar:4100-sign}};
 row[66]={entryRuleVersion:S.RULE,exitLockVersion:S.POLICY.exitLockVersion,entryPolicyVersion:S.POLICY.entryPolicyVersion,planMode:"Fixed R:R",riskPlanVersion:S.RISK,atrPeriod:10,solidSide:side,solidHoldActive:true,solidClosedAt:null,solidTriggeredAt:t,setupAt:t,sourceEntry:4100-sign,solidEligible:true,completedAt:now,completionPrice:4100,riskAtrReference:4,riskStructure:4100-sign*2,riskTick:.01,entryEvent:true,entryAuthorizedAt:now,dashboardAi:{momentum:side==='BUY'?'Bullish 🟢':'Bearish 🔴',mtfScore:sign,dashboard:{mtfTimeframes:['3','5','10']}}};
 return {row,now,batch:{feedVersion:'TF2_REALTIME_V1',timeframe:'2',schemaVersion:'32.3-EXIT-STEPLOCK',feedUpdateVersion:'SPLIT_CHANNEL_BOOTSTRAP_V2',feedChannel:'EXECUTION',confirmed:false,emittedAt:now,markets:[row]}};
}
let clock=100000;
const candle=(open,close,low=Math.min(open,close)-.1,high=Math.max(open,close)+.1)=>({time:clock+=120000,open,close,low,high,confirmed:true});
function chop(){let s=Safety.create();for(const [o,c] of [[100,101],[101,100],[100,101],[101,100],[100,101],[101,100]])s=Safety.step(s,candle(o,c));return s;}
test('six candles three flips block; two same-direction candles within range never release',()=>{
 let s=chop();a.equal(s.event,'CHOP_BLOCK');const zone={...s.zone};
 s=Safety.step(s,candle(100,100.4));s=Safety.step(s,candle(100.4,100.8));a.deepEqual(s.zone,zone);a.equal(Safety.allowed(Safety.evidence(s),'BUY',s.last),false);
});
test('failed breakout and wick back into zone stay blocked; fixed boundaries survive retries',()=>{
 let s=chop(),zone={...s.zone};
 s=Safety.step(s,candle(100.5,101.5));a.equal(s.event,'BREAKOUT_WAIT');
 s=Safety.step(s,candle(101.5,100.8));a.equal(s.event,'BREAKOUT_FAILED');a.deepEqual(s.zone,zone);
 s=Safety.step(s,candle(100.8,101.6));a.equal(s.event,'BREAKOUT_WAIT');
 s=Safety.step(s,candle(101.6,101.8,101,102));a.equal(s.event,'BREAKOUT_FAILED');a.deepEqual(s.zone,zone);
 s=Safety.step(s,candle(101.8,102));a.equal(s.event,'BREAKOUT_WAIT');
 s=Safety.step(s,candle(102,102.3,101.9,102.4));a.equal(s.event,'CHOP_RELEASE');a.equal(s.zone,null);a.equal(Safety.allowed(Safety.evidence(s),'BUY',s.last),true);
});
for(const d of [1,-1])test('strict >6 '+d+' blocks one-direction multi-candle chase until later 40% pullback and momentum',()=>{
 let s=Safety.create();const b=(o,c)=>candle(100+d*o,100+d*c,Math.min(100+d*o,100+d*c),Math.max(100+d*o,100+d*c));
 for(const [o,c] of [[0,2],[2,4],[4,6]])s=Safety.step(s,b(o,c));a.equal(s.legs[d===1?'BUY':'SELL'].big,false,'exactly 6 does not trigger');
 s=Safety.step(s,b(6,7));const side=d===1?'BUY':'SELL';a.equal(s.legs[side].big,true);
 s=Safety.step(s,b(7,6));a.equal(s.legs[side].pulled,false);
 s=Safety.step(s,b(6,4));a.equal(s.legs[side].pulled,true);a.equal(Safety.allowed(Safety.evidence(s),side,s.last),false);
 s=Safety.step(s,b(4,6.5));a.equal(s.legs[side].big,false);a.equal(s.event,'BIG_RELEASE');
});
test('large reversal also blocks the opposite chase; tracks BUY and SELL independently',()=>{
 let s=Safety.create();s=Safety.step(s,candle(100,108,100,108));s=Safety.step(s,candle(108,100,100,108));
 a.deepEqual(Safety.evidence(s).bigSides,['BUY','SELL']);
});
test('intrabar/duplicate/out-of-order snapshots cannot advance or clear the state',()=>{
 let s=chop(),copy=JSON.stringify(s),b=candle(100,103);
 a.equal(JSON.stringify(Safety.step(s,{...b,confirmed:false})),copy);a.equal(JSON.stringify(Safety.step(s,{...b,time:s.last})),copy);
});
test('doji is ignored when counting reversals',()=>{
 let s=Safety.create();for(const [o,c] of [[100,101],[100,100],[100,101],[100,100],[100,101],[100,101]])s=Safety.step(s,candle(o,c));a.equal(s.zone,null);
});
function guarded(){const f=fixture();f.row[1]=f.now-120000;f.batch.confirmed=true;Object.assign(f.row[66],{entryPolicyVersion:S.SOLID_POLICY,decisionTimingVersion:'TF2_BAR_CLOSE_V1',decisionBarCloseAt:f.now,entrySafety:{version:Safety.VERSION,barTime:f.row[1],ready:true,chopBlocked:false,bigBlocked:false,bigSides:[],event:''}});return f;}
for(const kind of ['chop','big','warmup','stale','unknown'])test('full server contract rejects '+kind+' even if READY is forced',()=>{
 delete require.cache[require.resolve('../tf2-ribbon-market-hub')];const H=require('../tf2-ribbon-market-hub'),f=guarded(),e=f.row[66].entrySafety;
 if(kind==='chop')e.chopBlocked=true;if(kind==='big'){e.bigBlocked=true;e.bigSides=['BUY'];}if(kind==='warmup')e.ready=false;if(kind==='stale')e.barTime--;if(kind==='unknown')e.version='unknown';
 const m=H.ingest(f.batch,f.now)[0];a.equal(m.strategyNormal.state,'WAIT');a.equal(C.createEntryDecision({...m,strategyNormal:{...m.strategyNormal,state:'READY'}},f.now),null);
});
test('clear safety keeps SOP and risk plan; a block never suppresses native exit management',()=>{
 delete require.cache[require.resolve('../tf2-ribbon-market-hub')];const H=require('../tf2-ribbon-market-hub'),f=guarded();
 const m=H.ingest(f.batch,f.now)[0];a.ok(C.createEntryDecision(m,f.now));
 const blocked=guarded();Object.assign(blocked.row,{48:'CLOSED',49:'EXIT_ALL',52:0});blocked.row[66].entrySafety.chopBlocked=true;blocked.row[66].nativeExitAll=true;
 const exit=H.ingest(blocked.batch,blocked.now)[0];a.equal(exit.strategyNormal.state,'WAIT');a.equal(exit.nativeChartExitAll,true);a.equal(exit.positionManagement.action,'EXIT_ALL');
});
test('Telegram safety signal uses existing durable notification dedup, execution closed candles only',async()=>{
 const {AnalysisAlerts}=require('../analysis-alert-service'),alerts=new AnalysisAlerts();await alerts.init();
 try{const f=guarded(),m=Hub.ingest(f.batch,f.now)[0];m.setupMeta.entrySafety.event='CHOP_BLOCK';m.setupMeta.entrySafety.chopBlocked=true;m.setupMeta.entrySafety.zone={low:4099,high:4101};
 const e=Safety.signal(m,f.now);a.match(e.guideText,/4099.00 – 4101.00/);await alerts.recordGuide(e);await alerts.recordGuide(e);a.equal(alerts.events.filter(x=>x.notificationKey===e.notificationKey).length,1);
 a.equal(Safety.signal({...m,confirmed:false},f.now),null);a.equal(Safety.signal({...m,feedChannel:'DASHBOARD'},f.now),null);a.equal(Safety.signal(m,f.now+60001),null);
 }finally{clearInterval(alerts.cleanupTimer);}
});
test('all seven signal types render without entry instructions; Pine gates initial and reentry',()=>{
 const s=Safety.evidence(chop());for(const event of ['CHOP_BLOCK','BREAKOUT_WAIT','BREAKOUT_FAILED','CHOP_RELEASE','BIG_BLOCK','PULLBACK_READY','BIG_RELEASE'])a.ok(Safety.message({...s,event}));
 const pine=require('node:fs').readFileSync('ZenCore_TF2_ATR8_TP1Max3.pine','utf8');a.match(pine,/bool zc_followup = zs_pass and barstate.isconfirmed/);a.match(pine,/bool zc_hold_qualify = zs_pass and barstate.isconfirmed/);a.match(pine,/zs_buy_distance > 6.0/);a.match(pine,/zs_sell_distance > 6.0/);a.match(pine,/zs_out == 1 \? low > zs_zone_high : high < zs_zone_low/);
});

test('delivery and Telegram independently reject blocked safety evidence',async()=>{
 delete require.cache[require.resolve('../tf2-ribbon-market-hub')];const H=require('../tf2-ribbon-market-hub'),f=guarded(),m=H.ingest(f.batch,f.now)[0];
 const d=C.createEntryDecision(m,f.now);a.ok(d.snapshot.confirmationEvidence.entrySafety);
 const e=m.strategyNormal.sop.entrySafety;e.chopBlocked=true;
 const delivery=require('../entry-delivery-check').checkEntryDelivery({payload:{side:'BUY',analysisSnapshot:d.snapshot}},m,f.now);a.equal(delivery.reason,'TF2_ENTRY_SAFETY_BLOCKED');
 a.equal(require('../analysis-telegram').entrySopAllowed({timeframe:'2',side:'BUY',telegramSop:{entrySafety:e},telegramMarket:{sourceBarTime:m.sourceBarTime}}),false);
});
