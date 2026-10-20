'use strict';
const Core=require('./indicator-chart-core');
// A bounded, read-only projection of accepted Pine feed candles. Never writes
// to a market object, a user setting, a trade decision or an execution queue.
class ChartHistory {
 constructor(){this.rows=new Map();}
 observe(m,now=Date.now()){
  const p=Core.point(m);if(!p)return;
  this.rows.set(p.timeframe,Core.merge(this.rows.get(p.timeframe),p,p.timeframe,now));
 }
 snapshot(tf,now=Date.now()){
  tf=String(tf);const candles=Core.merge(this.rows.get(tf),null,tf,now);
  this.rows.set(tf,candles);
  return {ok:true,symbol:'XAUUSD',timeframe:tf,source:'PINE_FEED',retentionHours:5,
    historyScope:'SINCE_SERVER_START',candles};
 }
}
module.exports={ChartHistory,history:new ChartHistory()};
