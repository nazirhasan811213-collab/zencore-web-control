'use strict';
// Analysis-only projection. Never changes the execution cache or freshness rules.
function createAnalysisReader({readTF2,readTF15,readFallback}){
 return async function read(){
  const current=[...readTF2().filter(m=>String(m?.timeframe)==='2'),...readTF15().filter(m=>String(m?.timeframe)==='15')].filter(m=>m?.symbol==='XAUUSD'&&['2','15'].includes(String(m.timeframe))&&m.strategyNormal?.tf===String(m.timeframe)+'m');
  // A missing timeframe remains missing; do not delay the available feed while
  // asking the legacy HTTP endpoint for a substitute.
  return current.length?current:readFallback();
 };
}
module.exports={createAnalysisReader};
