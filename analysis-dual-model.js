'use strict';
const SYMBOLS=['XAUUSD'];
function dualAnalysis(markets,symbol,now=Date.now()) {
 if(!SYMBOLS.includes(symbol))throw new Error('INVALID_SYMBOL');
 return {ok:true,symbol,serverTime:now,views:[2,15].map(tf=>{
  const candidates=markets.filter(m=>m.symbol===symbol&&String(m.timeframe).replace(/m$/,'')===String(tf)&&m.strategyNormal?.tf===tf+'m');
  const market=candidates.sort((a,b)=>Number(b.receivedAt)-Number(a.receivedAt))[0]||null;
  const at=Number(market?.receivedAt)||0;
  const ageMs=at?Math.max(0,now-at):null;
  const emitted=Number(market?.signalObservedAt)||0;
  const sourceAgeMs=emitted?Math.max(0,now-emitted):ageMs;
  const transportLagMs=emitted&&at>=emitted?at-emitted:null;
  return {timeframe:tf,label:tf===2?'Scalping':'Intra',confirmationTimeframe:tf===2?3:30,status:!at?'WAITING':at>now+5000||emitted>now+5000?'INVALID_TIME':ageMs>30000||sourceAgeMs>30000?'STALE':'LIVE',ageMs,sourceAgeMs,transportLagMs,market};
 })};
}
module.exports={dualAnalysis,SYMBOLS};
