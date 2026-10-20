'use strict';
function ingestMarket(alerts,market){
 if(!alerts)return;
 // Dashboard may display/manage a setup, but only execution data can announce
 // an authorized TF2 entry. Do not suppress legitimate execution READY state.
 const input=String(market.timeframe)==='2'&&market.feedChannel!=='EXECUTION'
  ?{...market,strategyNormal:{...market.strategyNormal,state:'WAIT'}}:market;
 return alerts.ingest(input);
}
module.exports={ingestMarket};
