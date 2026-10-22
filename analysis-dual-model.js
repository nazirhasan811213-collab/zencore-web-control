'use strict';
const SYMBOLS=['XAUUSD'];
function dualAnalysis(markets,symbol,now=Date.now()) {
 if(!SYMBOLS.includes(symbol))throw new Error('INVALID_SYMBOL');
 return {ok:true,symbol,serverTime:now,views:[2,15].map(tf=>{
  const candidates=markets.filter(m=>m.symbol===symbol&&String(m.timeframe).replace(/m$/,'')===String(tf)&&m.strategyNormal?.tf===tf+'m');
  const market=candidates.sort((a,b)=>(Number(b.signalObservedAt)||Number(b.receivedAt))-(Number(a.signalObservedAt)||Number(a.receivedAt))||Number(b.receivedAt)-Number(a.receivedAt))[0]||null;
  const at=Number(market?.receivedAt)||0;
  const ageMs=at?Math.max(0,now-at):null;
  const emitted=Number(market?.signalObservedAt)||0;
  const sourceAgeMs=emitted?Math.max(0,now-emitted):ageMs;
  const transportLagMs=emitted&&at>=emitted?at-emitted:null;
  const freshnessLimitMs=tf===2?60000:30000;
  return {timeframe:tf,label:tf===15?'Intra':'Scalping TF2',confirmationTimeframe:tf===15?30:2,mtfTimeframes:tf===15?[15,30,45]:[3,5,10],status:!at?'WAITING':at>now+5000||emitted>now+5000?'INVALID_TIME':ageMs>freshnessLimitMs||sourceAgeMs>freshnessLimitMs?'STALE':'LIVE',ageMs,sourceAgeMs,transportLagMs,freshnessLimitMs,market};
 })};
}
module.exports={dualAnalysis,SYMBOLS};

