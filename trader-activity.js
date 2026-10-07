'use strict';
const at=v=>{const n=typeof v==='number'?v:Date.parse(v);return Number.isFinite(n)&&n>0?n:null;};
function activityView(summary,positions,now=Date.now()){
 const openPositions=positions.length,lastOpenAt=Math.max(0,...positions.map(p=>at(p.openedAt)||0));
 const lastTradeAt=Math.max(at(summary?.lastTradeAt)||0,lastOpenAt)||null;
 const status=openPositions?'POSITION_OPEN':lastTradeAt&&now-lastTradeAt<=7*86400000?'ACTIVE_7D':lastTradeAt?'INACTIVE_7D':'NO_RECORDED_TRADE';
 return {status,lastTradeAt,openPositions,executedSetups7d:Number(summary?.executedSetups7d)||0,executedSetups30d:Number(summary?.executedSetups30d)||0};
}
module.exports={activityView};
