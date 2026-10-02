'use strict';
const number=value=>value===null||value===undefined||value===''?null:Number.isFinite(Number(value))?Number(value):null;
// Preserve the precise levels drawn by Pine; do not recalculate ATR or Fibonacci on the server.
function chartTradePlan(snapshot={},side=''){
  const direction=side==='BUY'?1:side==='SELL'?-1:0;
  const entry=number(snapshot.entry),sl=number(snapshot.initialSl);
  const tp1=number(snapshot.tp1),tp2=number(snapshot.tp2),tp3=number(snapshot.tp3);
  if(!direction||[entry,sl,tp1,tp2,tp3].some(value=>value===null))return null;
  const risk=(entry-sl)*direction;
  if(risk<=0||(tp1-entry)*direction<=0||(tp2-tp1)*direction<=0||(tp3-tp2)*direction<=0)return null;
  const mode=snapshot.tpMode==='Fibonacci'?'Fibonacci':'Fixed R:R';
  return{side,entry,sl,tp1,tp2,tp3,riskDistance:risk,
    rr1:Math.abs(tp1-entry)/risk,rr2:Math.abs(tp2-entry)/risk,rr3:Math.abs(tp3-entry)/risk,tpMode:mode,
    condition:'PINE SOP NORMAL',planType:`NORMAL SCALPING ${snapshot.timeframe||'3'}M — PINE `+mode};
}
module.exports={chartTradePlan};
