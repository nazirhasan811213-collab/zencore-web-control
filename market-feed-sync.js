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

function effectiveReceivedAt(snapshot) {
  const received = number(snapshot?.receivedAt);
  const bar = number(snapshot?.time);
  const minutes = Math.max(1,number(snapshot?.timeframe) || 3);
  // Only epoch-millisecond source times are comparable to wall clock.
  return bar !== null && bar > 1e12 && bar <= Date.now() + 60000
    ? Math.min(received || 0,bar + minutes * 60000)
    : received;
}

module.exports = {acceptsSnapshot,effectiveReceivedAt};
