'use strict';
const MAX_AGE={'2':60000,'15':30000};
const finite=x=>typeof x==='number'&&Number.isFinite(x);
function fresh(time,at,maximum){return finite(time)&&time>0&&at-time>=-5000&&at-time<=maximum;}
function validPlan(side,p){
 const sign=side==='BUY'?1:side==='SELL'?-1:0;
 return !!sign&&p&&['entry','sl','tp1','tp2','tp3'].every(k=>finite(p[k])&&p[k]>0)&&
  sign*(p.entry-p.sl)>0&&sign*(p.tp1-p.entry)>0&&sign*(p.tp2-p.tp1)>0&&sign*(p.tp3-p.tp2)>0;
}
function allowed(e,at=Date.now()){
 const maximum=MAX_AGE[String(e.timeframe)];
 if(e.telegramProgressVersion!==1||e.symbol!=='XAUUSD'||!maximum||!validPlan(e.side,e.telegramPlan)||
  !fresh(e.time,at,maximum)||!fresh(e.observedAt,at,maximum)||!finite(e.currentPrice)||e.currentPrice<=0||!e.setupKey)return false;
 const sign=e.side==='BUY'?1:-1;
 if(e.kind==='TP_HIT')return [1,2,3].includes(e.targetNumber)&&sign*(e.currentPrice-e.telegramPlan['tp'+e.targetNumber])>=0;
 if(e.kind==='PULLBACK')return Number.isInteger(e.pullbackStage)&&e.pullbackStage>=0&&e.pullbackStage<=3&&
  finite(e.atrReference)&&e.atrReference>0&&finite(e.bestPrice)&&
  sign*(e.bestPrice-e.telegramPlan.entry)>=0&&sign*(e.bestPrice-e.currentPrice)>=e.atrReference*.25;
 return false;
}
function progress(previous,next,market,events,at=Date.now()){
 const tf=String(next.timeframe),maximum=MAX_AGE[tf];
 if(tf==='2'&&require('./tf2-bar-close').applies(market)&&!require('./tf2-bar-close').confirmed(market)){next.telegramProgress=previous?.telegramProgress||null;return [];}
 const opened=events.find(e=>e.kind==='ENTRY'&&!e.telegramDuplicate);
 const closed=events.some(e=>e.kind==='CLOSE'&&e.percent===100);
 const active=opened?{side:opened.side,setupKey:opened.setupKey,plan:opened.telegramPlan,atrReference:opened.telegramSop?.riskAtrReference||opened.telegramSop?.atrReference}:previous?.activePlan;
 let state=previous?.telegramProgress?{...previous.telegramProgress,hits:[...(previous.telegramProgress.hits||[])],warned:[...(previous.telegramProgress.warned||[])]}:null;
 if(!maximum||next.symbol!=='XAUUSD'||!active||!validPlan(active.side,active.plan)){
  next.telegramProgress=closed?null:state;return [];
 }
 const key=active.setupKey||['PLAN',tf,active.side,...['entry','sl','tp1','tp2','tp3'].map(k=>active.plan[k])].join('|');
 if(!state||state.setupKey!==key)state={setupKey:key,side:active.side,plan:{...active.plan},atrReference:active.atrReference||null,bestPrice:active.plan.entry,hits:[],warned:[],observedAt:0};
 const observed=market.signalObservedAt,price=market.price;
 if(!fresh(next.time,at,maximum)||!fresh(observed,at,maximum)||observed<=state.observedAt||!finite(price)||price<=0){
  next.telegramProgress=closed?null:state;return [];
 }
 const sign=state.side==='BUY'?1:-1;
 state.observedAt=observed;
 state.bestPrice=sign*price>sign*state.bestPrice?price:state.bestPrice;
 const base={symbol:next.symbol,timeframe:tf,time:next.time,side:state.side,setupKey:key,telegramPlan:{...state.plan},telegramProgressVersion:1,observedAt:observed,currentPrice:price};
 const result=[];
 for(const targetNumber of [1,2,3])if(!state.hits.includes(targetNumber)&&sign*(price-state.plan['tp'+targetNumber])>=0){
  state.hits.push(targetNumber);result.push({...base,kind:'TP_HIT',targetNumber,message:`${next.symbol} • TF${tf} • TP${targetNumber} DILEPASI • ${state.side}`});
 }
 const stage=state.hits.length?Math.max(...state.hits):0;
 if(!closed&&finite(state.atrReference)&&state.atrReference>0&&!state.warned.includes(stage)&&sign*(state.bestPrice-price)>=state.atrReference*.25){
  state.warned.push(stage);result.push({...base,kind:'PULLBACK',pullbackStage:stage,atrReference:state.atrReference,bestPrice:state.bestPrice,message:`${next.symbol} • TF${tf} • HATI-HATI PULLBACK • ${state.side}`});
 }
 next.telegramProgress=closed?null:state;
 return result;
}
module.exports={progress,allowed};
