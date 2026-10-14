'use strict';
// Rebased orders must never consume price-based exits from the original chart.
function rebasedManagement(market,positions,command){
 if(command?.payload?.analysisSnapshot?.entryAnchor==='FILL_PRICE_ATR_V1'){
  const p=command.payload,own=positions.filter(x=>x.origin!=='MANUAL'&&x.symbol===p.symbol&&(x.strategyMode||'TF2_SCALPING')===p.strategyMode);
  if(!own.length)return {rebased:false,market};
  if(!own.every(x=>x.side===p.side&&x.setupId===command.id.slice(0,20)&&x.fillRiskVersion==='FILL_PRICE_ATR_V1'))return {rebased:true,market:null};
  // Each ticket has its own fill/targets. EA performs local TP StepLock/partial.
  // Fresh direction-based advisory exits remain allowed, chart-price exits do not.
  const fresh=market.signalObservedAt>=Math.max(...own.map(x=>x.openedAt));
  const source=market.positionManagement||{},action=fresh&&['EXIT_ALL','CLOSE_50_NOW'].includes(source.action)?source.action:
    fresh&&source.oppositeYellow===true&&source.action==='EXIT_REMAINING'&&own.every(x=>p.side==='BUY'?x.activeSl>=x.entry:x.activeSl<=x.entry)?'EXIT_REMAINING':'HOLD';
  return {rebased:true,market:{...market,positionManagement:{...source,slMoveTriggered:false,action,
    entryAnchor:'FILL_PRICE_ATR_V1',entryCommandId:command.id}}};
 }
 if(command?.payload?.analysisSnapshot?.entryAnchor!=='LIVE_SIGNAL_PRICE_V1')return {rebased:false,market};
 const p=command.payload,own=positions.filter(x=>x.origin!=='MANUAL'&&x.symbol===p.symbol&&(x.strategyMode||'TF2_SCALPING')===p.strategyMode);
 if(!own.length)return {rebased:false,market};
 // Do not attribute a new command to an older still-open batch.
 if(!own.every(x=>x.side===p.side&&['tp1','tp2','tp3'].every(k=>Number.isFinite(x[k])&&Math.abs(x[k]-p[k])<=.00002)))return {rebased:false,market};
 const sign=p.side==='BUY'?1:-1,prices=own.map(x=>x.currentPrice);
 if(prices.some(x=>!Number.isFinite(x)||x<=0)||own.some(x=>!Number.isFinite(x.entry)||x.entry<=0))return {rebased:true,market:null};
 const price=sign>0?Math.min(...prices):Math.max(...prices);
 const hit=n=>sign*(price-p['tp'+n])>=0;
 const pm={action:'HOLD',slMoveTriggered:false,entryAnchor:'LIVE_SIGNAL_PRICE_V1',entryCommandId:command.id,reason:'LIVE ENTRY LEVELS — chart price exits ignored'};
 // Keep the existing StepLock sequence and TP1 half-close; EA persists half-close state.
 if(hit(3)){pm.slMoveTriggered=true;pm.slMoveAction='MOVE_SL_TP2';pm.activeSl=p.tp2;pm.slLockLabel='TP2_LOCKED';}
 else if(hit(2)){pm.slMoveTriggered=true;pm.slMoveAction='MOVE_SL_TP1';pm.activeSl=p.tp1;pm.slLockLabel='TP1_LOCKED';}
 else if(hit(1)){pm.slMoveTriggered=true;pm.slMoveAction='MOVE_SL_ENTRY';pm.activeSl=sign>0?Math.min(...own.map(x=>x.entry)):Math.max(...own.map(x=>x.entry));pm.slLockLabel='BREAKEVEN';pm.action='CLOSE_50_NOW';}
 const observed=Number(market.signalObservedAt||market.receivedAt);
 const opened=Math.max(...own.map(x=>Number(x.openedAt)||0));
 if(opened>0&&observed>=opened&&market.positionManagement?.oppositeYellow===true&&market.positionManagement?.action==='EXIT_REMAINING'&&own.every(x=>sign*(x.activeSl-x.entry)>=0))pm.action='EXIT_REMAINING';
 return {rebased:true,market:{...market,positionManagement:pm}};
}
module.exports={rebasedManagement};
