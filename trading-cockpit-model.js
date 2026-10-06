'use strict';
const {dualAnalysis,SYMBOLS}=require('./analysis-dual-model');
const {createEntryDecision}=require('./analysis-execution-contract');
function cockpit(markets,now=Date.now()){
 const pairs=SYMBOLS.map(symbol=>dualAnalysis(markets,symbol,now));
 for(const pair of pairs)for(const view of pair.views){
  const observed=Number(view.market?.signalObservedAt),normal=view.market?.strategyNormal;
  const expected=view.timeframe===2?['NORMAL_20261001_TF2_V2','NORMAL_20261001_TF2_SEQ_V3','NORMAL_20261001_TF2_SEQ_ATR40_V4']:
   ['NORMAL_20261001_TF15_V2','NORMAL_20261001_TF15_SEQ_ATR40_V4'];
  view.entryReady=expected.includes(normal?.entrySopVersion)&&view.status==='LIVE'&&Number.isFinite(observed)&&observed<=now+5000&&now-observed<=30000&&!!createEntryDecision(view.market);
  view.displayState=view.status!=='LIVE'?'WAITING':view.entryReady?'READY':normal?.state==='READY'?'WAIT_CONFIRMATION':normal?.state||'WATCH';
 }
 return {ok:true,serverTime:now,pairs,liveFeeds:pairs.flatMap(p=>p.views).filter(v=>v.status==='LIVE').length,readySetups:pairs.flatMap(p=>p.views).filter(v=>v.entryReady).length};
}
module.exports={cockpit};
