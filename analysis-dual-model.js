'use strict';
const SYMBOLS=['XAUUSD'];
function dualAnalysis(markets,symbol,now=Date.now()) {
 if(!SYMBOLS.includes(symbol))throw new Error('INVALID_SYMBOL');
 return {ok:true,symbol,serverTime:now,views:([2,15].concat(markets.some(m=>m.strategyNormal?.entrySopVersion==='NORMAL_20261001_TF3_RIBBON_V1'&&String(m.timeframe)==='3')?[3]:[])).map(tf=>{
  const candidates=markets.filter(m=>m.symbol===symbol&&String(m.timeframe).replace(/m$/,'')===String(tf)&&m.strategyNormal?.tf===tf+'m');
  const market=candidates.sort((a,b)=>Number(b.receivedAt)-Number(a.receivedAt))[0]||null;
  const at=Number(market?.receivedAt)||0;
  const ageMs=at?Math.max(0,now-at):null;
  const emitted=Number(market?.signalObservedAt)||0;
  const sourceAgeMs=emitted?Math.max(0,now-emitted):ageMs;
  const transportLagMs=emitted&&at>=emitted?at-emitted:null;
  return {timeframe:tf,label:tf===15?'Intra':tf===3?'Scalping TF3':'TF2 lama',confirmationTimeframe:tf===15?30:tf===3?5:3,status:!at?'WAITING':at>now+5000||emitted>now+5000?'INVALID_TIME':ageMs>30000||sourceAgeMs>30000?'STALE':'LIVE',ageMs,sourceAgeMs,transportLagMs,market};
 })};
}
module.exports={dualAnalysis,SYMBOLS};

