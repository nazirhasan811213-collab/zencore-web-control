'use strict';

const number = value => {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

// TradingView time is the opening timestamp in milliseconds. A later delivery
// of an older bar must never roll the market and signal state backwards.
function acceptsSnapshot(previous, incoming) {
  if (!previous) return true;
  const oldTime = number(previous.time), newTime = number(incoming.time);
  if (oldTime !== null && newTime !== null) {
    if (newTime !== oldTime) return newTime > oldTime;
    const oldIndex = number(previous.barIndex), newIndex = number(incoming.barIndex);
    return oldIndex === null || newIndex === null || newIndex >= oldIndex;
  }
  const oldIndex = number(previous.barIndex), newIndex = number(incoming.barIndex);
  return oldIndex === null || newIndex === null || newIndex >= oldIndex;
}

// On the same candle, a versioned realtime bridge owns execution data.
// A legacy chart payload has no current HEMA/event fields and cannot replace it.
function realtimeTf2(snapshot){
  return String(snapshot?.timeframe)==='2'&&snapshot?.feedVersion==='TF2_REALTIME_V1'&&
    snapshot?.hemaConfirmation?.version==='HEMA23_LIVE_V1'&&
    typeof snapshot?.entryEvent==='boolean'&&number(snapshot?.signalObservedAt)>0;
}
function acceptsFeedSource(previous,incoming){
  if(!acceptsSnapshot(previous,incoming))return false;
  if(!previous||number(previous.time)!==number(incoming.time))return true;
  const oldRealtime=realtimeTf2(previous),newRealtime=realtimeTf2(incoming);
  if(oldRealtime||newRealtime){
    if(oldRealtime&&!newRealtime)return false;
    if(oldRealtime&&newRealtime&&number(incoming.signalObservedAt)<number(previous.signalObservedAt))return false;
    return true;
  }
  // Preserve legacy chart plan ownership when neither source is the current bridge.
  return !(previous.feedType!=='MULTI_PAIR_BATCH'&&incoming.feedType==='MULTI_PAIR_BATCH');
}

function effectiveReceivedAt(snapshot) {
  const received = number(snapshot?.receivedAt);
  const bar = number(snapshot?.time);
  const minutes = Math.max(1,number(snapshot?.timeframe) || 3);
  // Only epoch-millisecond source times are comparable to wall clock.
  return bar !== null && bar > 1e12 && bar <= Date.now() + 60000
    ? Math.min(received || 0,bar + minutes * 60000)
    : received;
}

module.exports = {acceptsSnapshot,acceptsFeedSource,realtimeTf2,effectiveReceivedAt};
