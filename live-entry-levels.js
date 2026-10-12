'use strict';
// Translate signed distances to the supplied price. The server supplies a live
// signal price, not a guaranteed MT5 fill; the unchanged EA keeps its own rules.
function levelsAtFill(plan,fill){
 const keys=['entry','sl','tp1','tp2','tp3'];
 if(!plan||keys.some(k=>typeof plan[k]!=='number'||!Number.isFinite(plan[k]))||typeof fill!=='number'||!Number.isFinite(fill)||fill<=0)throw new Error('INVALID_PRICE');
 const sign=plan.side==='BUY'?1:plan.side==='SELL'?-1:0;
 if(!sign||sign*(plan.entry-plan.sl)<=0||sign*(plan.tp1-plan.entry)<=0||sign*(plan.tp2-plan.tp1)<=0||sign*(plan.tp3-plan.tp2)<=0)throw new Error('INVALID_PLAN');
 const shift=fill-plan.entry;
 const result={side:plan.side,entry:fill};
 for(const key of ['sl','tp1','tp2','tp3'])result[key]=plan[key]+shift;
 if(Object.values(result).some(v=>typeof v==='number'&&v<=0))throw new Error('INVALID_PRICE');
 return result;
}
module.exports={levelsAtFill};
