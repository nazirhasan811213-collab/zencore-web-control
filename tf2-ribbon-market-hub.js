'use strict';
const S=require('./tf2-ribbon-scalping');
function decode(row,batch){
  if(!Array.isArray(row)||row.length<61)return null;
  const versionedManagement=String(batch.timeframe)==='2'&&batch.feedUpdateVersion==='SPLIT_CHANNEL_BOOTSTRAP_V2'&&[S.RULE].includes(row[66]?.entryRuleVersion);
  const managementBlocked=versionedManagement?require('./tf2-ribbon-live-management').block(row,batch):batch.confirmed===false;
  const [symbol,time,barIndex,open,high,low,close,ema9,ema20,ema50,hema20,hema40,basis,waveTrend1,waveTrend2,rsi,chopIndex,relativeVolume,globalTrend,setupProbability,confluenceStars,atr,entry,initialSl,activeSl,tp1,tp2,tp3,tradeActive,tradeIsBuy,tp1Hit,tp2Hit,tp3Hit,slHit,normal3Side,normal3Solid,normal3PricePastEntry,normal3Sop1,normal3Sop2,normal3Sop3,normal3Sop4,normal3Sop5,normal3Forecast,normal3MarketPower,normal5Position,normal5Close,normal5Hema20,normal5Hema40,positionExitStage,positionExitAction,exitPartialArmed,exitOppositeYellow,exitRemainingPct,exitYellowType,exitCloseType,exitReason,slLockStage,slLockLabel,slMoveAction,slMoveTriggered,action,normal3PriceCrossEntry,normal3ReentrySignal,normal3ReentrySide,normal3ReentryHemaPass]=row;
  return{
    schemaVersion:batch.schemaVersion||'32.3-EXIT-STEPLOCK',
    ...(['HEMA2_LIVE_V1'].includes(row[65]?.version)?{hemaConfirmation:row[65]}:{}),
    source:'ZenCore AI Dashboard Pro + Alerts',feedUpdateVersion:batch.feedUpdateVersion,feedChannel:batch.feedChannel,entryAuthorizedAt:row[66]?.entryAuthorizedAt,entryDeliveryVersion:row[66]?.entryDeliveryVersion,feedVersion:batch.feedVersion,feedType:'MULTI_PAIR_BATCH',confirmed:batch.confirmed!==false,entryEvent:row[66]?.entryEvent,setupMeta:row[66],nativeChartExitAll:!managementBlocked&&batch.feedChannel==='EXECUTION'&&[S.POLICY.entryPolicyVersion,'PINE_3TRIGGERS_4OF5_V2','PINE_3TRIGGERS_3OF4_FORECAST45_V4','PINE_SOLID_3OF4_FORECAST45_V5'].includes(row[66]?.entryPolicyVersion)&&row[66]?.nativeExitAll===true,setupKey:row[66]?.setupAt?`TF2|${symbol}|${normal3Side}|${row[66].setupAt}`:null,signalObservedAt:Number(batch.emittedAt)||null,tpMode:batch.tpMode,
    symbol,timeframe:String(batch.timeframe||'2'),time,barIndex,open,high,low,close,ema9,ema20,ema50,
    hemaFast:hema20,hemaSlow:hema40,hema20,hema40,basis,waveTrend1,waveTrend2,rsi,
    chopIndex,relativeVolume,globalTrend,setupProbability,confluenceStars,atr,action,
    entry,sl:initialSl,initialSl,activeSl,tp1,tp2,tp3,tradeActive,tradeIsBuy,tp1Hit,tp2Hit,tp3Hit,slHit,
    normalSopVersion:row.length>=65&&batch.schemaVersion==='32.3-EXIT-STEPLOCK'?'32.4':'32.0',normal3Side,normal3Solid,normal3PricePastEntry,normal3PriceCrossEntry,normal3ReentrySignal,normal3ReentrySide,normal3ReentryHemaPass,
    normal3Sop1,normal3Sop2,normal3Sop3,normal3Sop4,normal3Sop5,
    normal3Forecast,normal3MarketPower,normal3Entry:entry,normal3Close:close,normal3Atr:atr,
    normal5Position,normal5Close,normal5Hema20,normal5Hema40,
    positionExitStage,positionExitAction:managementBlocked?'IDLE':positionExitAction,exitPartialArmed,exitOppositeYellow,exitRemainingPct,
    exitYellowType,exitCloseType,exitReason,slLockStage,slLockLabel,slMoveAction,slMoveTriggered:managementBlocked?false:slMoveTriggered
  };
}

const entries=new Map(), channels=new Map();
function ingest(batch,now=Date.now()){
 const out=[];
 if(batch?.feedVersion!=='TF2_REALTIME_V1'||String(batch.timeframe)!=='2'||batch.schemaVersion!=='32.3-EXIT-STEPLOCK'||batch.feedUpdateVersion!=='SPLIT_CHANNEL_BOOTSTRAP_V2'||!['EXECUTION','DASHBOARD'].includes(batch.feedChannel)||!Array.isArray(batch.markets)||!Number.isFinite(batch.emittedAt)||now-batch.emittedAt>60000||now-batch.emittedAt< -5000)return out;
 for(const row of batch.markets){
  if(!Array.isArray(row)||row.length!==67||row[0]!=='XAUUSD'||row[65]?.version!=='HEMA2_LIVE_V1'||row[66]?.entryRuleVersion!==S.RULE)continue;
  const d=decode(row,batch);if(!d||!Number.isFinite(d.time)||!Number.isFinite(d.close))continue;
  const channelKey=d.symbol+'|'+batch.feedChannel;
  const prev=channels.get(channelKey);if(prev&&(d.time<prev.sourceBarTime||d.signalObservedAt<=prev.signalObservedAt))continue;
  d.receivedAt=now;
  const n=S.strategy(d,now);
  const m={...d,price:d.close,sourceBarTime:d.time,feedMode:batch.confirmed?'BAR-CLOSE':'INTRABAR',strategyNormal:n,positionManagement:{action:d.nativeChartExitAll?'EXIT_ALL':d.positionExitAction,reason:d.nativeChartExitAll?'Native chart close signal':d.exitReason,slMoveTriggered:d.slMoveTriggered,slMoveAction:d.slMoveAction,activeSl:d.activeSl,slLockLabel:d.slLockLabel}};
  require('./indicator-chart-history').history.observe(m,now);
  channels.set(channelKey,m);
  const current=entries.get(d.symbol);
  // A separate Dashboard instance can complete the same source at another tick.
  // Never replace the execution identity/plan with its independently timed copy.
  if(!current||(m.feedChannel==='EXECUTION'&&(current.feedChannel!=='EXECUTION'||m.signalObservedAt>=current.signalObservedAt))||(current.feedChannel!=='EXECUTION'&&m.signalObservedAt>=current.signalObservedAt))entries.set(d.symbol,m);
  out.push(m);
 }
 return out;
}
function markets(){return [...entries.values()].filter(m=>Date.now()-m.receivedAt<=18000000);}
// Analysis can follow either channel; order dispatch retains markets()' execution cache.
function analysisMarkets(now=Date.now()){
 const latest=new Map();
 for(const m of channels.values()){
  if(now-m.receivedAt>18000000)continue;
  const old=latest.get(m.symbol);
  if(!old||m.signalObservedAt>old.signalObservedAt||m.signalObservedAt===old.signalObservedAt&&m.receivedAt>old.receivedAt)latest.set(m.symbol,m);
 }
 return [...latest.values()];
}
module.exports={ingest,markets,analysisMarkets};
