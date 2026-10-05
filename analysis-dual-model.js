'use strict';
const SYMBOLS=['XAUUSD','GBPUSD','GBPJPY'];
function dualAnalysis(markets,symbol,now=Date.now()) {
 if(!SYMBOLS.includes(symbol))throw new Error('INVALID_SYMBOL');
 return {ok:true,symbol,serverTime:now,views:[2,15].map(tf=>{
  const candidates=markets.filter(m=>m.symbol===symbol&&String(m.timeframe).replace(/m$/,'')===String(tf)&&m.strategyNormal?.tf===tf+'m');
  const market=candidates.sort((a,b)=>Number(b.receivedAt)-Number(a.receivedAt))[0]||null;
  const at=Number(market?.receivedAt)||0;
  const ageMs=at?Math.max(0,now-at):null;
  return {timeframe:tf,label:tf===2?'Scalping':'Intra',confirmationTimeframe:5,status:!at?'WAITING':at>now+5000?'INVALID_TIME':ageMs>30000?'STALE':'LIVE',ageMs,market};
 })};
}
module.exports={dualAnalysis,SYMBOLS};
