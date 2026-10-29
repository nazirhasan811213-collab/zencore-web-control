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
const candle=(open,close,atr=3)=>({time:clock+=120000,open,close,low:Math.min(open,close)-.1,high:Math.max(open,close)+.1,atr,confirmed:true});
const two=[[100,101],[101,102],[102,101],[101,100],[100,101],[101,102]];
function replay(atr,rows=two){let s=Safety.create();for(const [o,c] of rows)s=Safety.step(s,candle(o,c,atr));return s;}
for(const [atr,blocked] of [[4.5001,true],[4.5,false],[3,false],[1.5,false],[1.4999,true]])test('only two requested combinations ATR '+atr,()=>{
 const s=replay(atr);a.equal(s.flips,2);a.equal(s.blocked,blocked);a.equal(Safety.allowed(Safety.evidence(s),'BUY',s.last),!blocked);a.equal(Safety.allowed(Safety.evidence(s),'SELL',s.last),!blocked);
});
for(const atr of [1,5])test('ATR '+atr+' without two reversals remains unblocked',()=>{
 const s=replay(atr,[[100,101],[101,102],[102,103],[103,104],[104,105],[105,106]]);a.equal(s.blocked,false);
});
test('many reversals at normal ATR and >6 price movement no longer block',()=>{
 const s=replay(3,[[100,108],[108,100],[100,108],[108,100],[100,108],[108,100]]);a.equal(s.flips,5);a.equal(s.blocked,false);a.equal(Safety.allowed(Safety.evidence(s),'BUY',s.last),true);
});
test('ATR returning inside band releases immediately on close without breakout or pullback',()=>{
 for(const atr of [1,5]){let s=replay(atr);a.equal(s.blocked,true);s=Safety.step(s,candle(101,101.2,3));a.equal(s.blocked,false);a.equal(s.event,'CHOP_RELEASE');a.equal(Safety.allowed(Safety.evidence(s),'BUY',s.last),true);}
});
test('reversals rolling below two release even if ATR remains outside band',()=>{
 let s=replay(5);for(let i=0;i<6;i++)s=Safety.step(s,candle(102+i,103+i,5));a.equal(s.flips,0);a.equal(s.blocked,false);
});
test('intrabar, duplicate and out-of-order input cannot clear a block; doji adds no reversal',()=>{
 const s=replay(1),b=candle(101,102,3);a.deepEqual(Safety.step(s,{...b,confirmed:false}),s);a.deepEqual(Safety.step(s,{...b,time:s.last}),s);
 const doji=replay(5,[[100,101],[101,101],[101,102],[102,102],[102,103],[103,104]]);a.equal(doji.flips,0);a.equal(doji.blocked,false);
});
test('transition signal does not repeat each candle; reason identifies ATR high/low',()=>{
 let s=replay(5);a.equal(s.event,'CHOP_BLOCK');a.match(Safety.message(Safety.evidence(s)),/ATR tinggi/);s=Safety.step(s,candle(102,101,5));a.equal(s.event,null);
 a.match(Safety.message(Safety.evidence(replay(1))),/ATR rendah/);
});
function guarded(){const f=fixture();f.row[1]=f.now-120000;f.batch.confirmed=true;Object.assign(f.row[66],{entryPolicyVersion:S.SOLID_POLICY,decisionTimingVersion:'TF2_BAR_CLOSE_V1',decisionBarCloseAt:f.now,entrySafety:{version:Safety.VERSION,barTime:f.row[1],ready:true,chopBlocked:false,atr:3,flips:2,event:''}});return f;}
for(const kind of ['high','low','warmup','stale','unknown','forged'])test('server contract rejects '+kind+' even if READY forced',()=>{
 delete require.cache[require.resolve('../tf2-ribbon-market-hub')];const H=require('../tf2-ribbon-market-hub'),f=guarded(),e=f.row[66].entrySafety;
 if(['high','low','forged'].includes(kind)){e.atr=kind==='low'?1:5;e.chopBlocked=kind!=='forged';}if(kind==='warmup')e.ready=false;if(kind==='stale')e.barTime--;if(kind==='unknown')e.version='unknown';
 const m=H.ingest(f.batch,f.now)[0];a.equal(m.strategyNormal.state,'WAIT');a.equal(C.createEntryDecision({...m,strategyNormal:{...m.strategyNormal,state:'READY'}},f.now),null);
});
test('clear safety allows original SOP and blocked safety preserves native exit management',()=>{
 delete require.cache[require.resolve('../tf2-ribbon-market-hub')];const H=require('../tf2-ribbon-market-hub'),f=guarded();const m=H.ingest(f.batch,f.now)[0];a.ok(C.createEntryDecision(m,f.now));
 const blocked=guarded();Object.assign(blocked.row,{48:'CLOSED',49:'EXIT_ALL',52:0});Object.assign(blocked.row[66].entrySafety,{chopBlocked:true,atr:5});blocked.row[66].nativeExitAll=true;
 const exit=H.ingest(blocked.batch,blocked.now)[0];a.equal(exit.strategyNormal.state,'WAIT');a.equal(exit.nativeChartExitAll,true);a.equal(exit.positionManagement.action,'EXIT_ALL');
});
test('Telegram closed Execution only, fresh and deduplicated; delivery independently checks evidence',async()=>{
 const {AnalysisAlerts}=require('../analysis-alert-service'),alerts=new AnalysisAlerts();await alerts.init();try{
 const f=guarded(),m=Hub.ingest(f.batch,f.now)[0],d=C.createEntryDecision(m,f.now);a.ok(d);
 Object.assign(m.strategyNormal.sop.entrySafety,{chopBlocked:true,atr:5,event:'CHOP_BLOCK'});
 const e=Safety.signal(m,f.now);a.match(e.guideText,/ATR tinggi/);await alerts.recordGuide(e);await alerts.recordGuide(e);a.equal(alerts.events.filter(x=>x.notificationKey===e.notificationKey).length,1);
 a.equal(Safety.signal({...m,confirmed:false},f.now),null);a.equal(Safety.signal({...m,feedChannel:'DASHBOARD'},f.now),null);a.equal(Safety.signal(m,f.now+60001),null);
 a.equal(require('../entry-delivery-check').checkEntryDelivery({payload:{side:'BUY',analysisSnapshot:d.snapshot}},m,f.now).reason,'TF2_ENTRY_SAFETY_BLOCKED');
 a.equal(require('../analysis-telegram').entrySopAllowed({timeframe:'2',side:'BUY',telegramSop:{entrySafety:m.setupMeta.entrySafety},telegramMarket:{sourceBarTime:m.sourceBarTime}}),false);
 }finally{clearInterval(alerts.cleanupTimer);}
});
test('Pine has only ATR reversal trigger; obsolete safety states removed',()=>{
 const pine=require('node:fs').readFileSync('ZenCore_TF2_ATR8_TP1Max3.pine','utf8');a.match(pine,/zs_flips >= 2 and \(atr > 4.5 or atr < 1.5\)/);a.doesNotMatch(pine,/zs_zone|zs_buy_big|zs_sell_big|BIG_BLOCK|BREAKOUT_WAIT|PULLBACK_READY/);a.match(pine,/bool zc_followup = zs_pass and barstate.isconfirmed/);a.match(pine,/bool zc_hold_qualify = zs_pass and barstate.isconfirmed/);
});
