'use strict';
// Pure offline policy: no broker calls. Bars are executable-price OHLC (BID BUY, ASK SELL).
function tightenPlan(plan,side,factor=.8){
 const sign=side==='BUY'?1:side==='SELL'?-1:0;
 if(!sign||!Number.isFinite(factor)||factor<=0||factor>1||![plan.entry,plan.sl].every(Number.isFinite)||(plan.entry-plan.sl)*sign<=0)throw new Error('INVALID_STOP_PLAN');
 return {...plan,sl:plan.entry+(plan.sl-plan.entry)*factor};
}
function evaluate({state,timeframeMinutes,bars=[],quote,now}){
 if(!state||state.closed)return {state,intent:null};
 if(![2,10].includes(timeframeMinutes)||!Number.isFinite(state.openedAt)||!Number.isFinite(now))throw new Error('ENTRY_TIME_AND_TIMEFRAME_REQUIRED');
 const sign=state.side==='BUY'?1:state.side==='SELL'?-1:0;
 if(!sign||!Number.isFinite(state.plan?.tp1))throw new Error('INVALID_TP1');
 const duration=timeframeMinutes*60000;
 // Partial entry candle is excluded. Missing bars are not invented; repeat bars are deduplicated.
 const seen=new Set(state.completedBarCloses||[]);
 let touched=state.tp1Touched===true||Number(state.lockStage)>0;
 for(const bar of bars){
  if(bar.confirmed!==true||bar.timeframeMinutes!==timeframeMinutes||!Number.isFinite(bar.openAt)||!Number.isFinite(bar.closeAt)||bar.openAt<state.openedAt||bar.closeAt>now||bar.closeAt-bar.openAt!==duration)continue;
  const extreme=sign===1?bar.high:bar.low;
  if(!Number.isFinite(extreme))continue;
  seen.add(bar.closeAt);
  if(sign*(extreme-state.plan.tp1)>=0)touched=true;
 }
 const mark=sign===1?quote?.bid:quote?.ask;
 if(Number.isFinite(mark)&&sign*(mark-state.plan.tp1)>=0)touched=true;
 const next={...state,tp1Touched:touched,completedBarCloses:[...seen].sort((a,b)=>a-b)};
 const intent=seen.size>=3&&!touched?{key:`THREE_CANDLE|${state.setupKey}`,type:'CLOSE_PERCENT',value:100,reason:'TP1_NOT_REACHED_AFTER_3_CANDLES'}:null;
 return {state:next,intent};
}
module.exports={tightenPlan,evaluate};
