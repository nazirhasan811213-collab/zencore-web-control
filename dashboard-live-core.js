(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.ZenCoreDashboardLive=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const number=v=>v===null||v===undefined||v===''?null:Number.isFinite(Number(v))?Number(v):null;
 function fresh(view,now=Date.now()){
  const m=view?.market,received=number(m?.receivedAt),observed=number(m?.signalObservedAt)??received;
  return view?.status==='LIVE'&&received>0&&observed>0&&now-received>=-5000&&now-received<=30000&&now-observed>=-5000&&now-observed<=30000;
 }
 function quote(views,now=Date.now()){
  return views.filter(v=>fresh(v,now)&&number(v.market?.price)>0).sort((a,b)=>(number(b.market.signalObservedAt)??number(b.market.receivedAt))-(number(a.market.signalObservedAt)??number(a.market.receivedAt))||Number(a.timeframe)-Number(b.timeframe))[0]||null;
 }
 function createTape(){let samples=[];return {
  push(view){const price=number(view?.market?.price),at=number(view?.market?.signalObservedAt)??number(view?.market?.receivedAt);if(!(price>0&&at>0))return null;
   const last=samples.at(-1);if(last&&at<=last.at)return null;
   const point={price,at,timeframe:view.timeframe,delta:last?price-last.price:null};samples.push(point);samples=samples.slice(-60);return point;
  },points(){return samples.slice();}
 };}
 function sparkline(points,width=620,height=150){
  if(points.length<2)return '';
  const min=Math.min(...points.map(p=>p.price)),max=Math.max(...points.map(p=>p.price)),range=max-min;
  const start=points[0].at,end=points.at(-1).at;
  return points.map((p,i)=>`${i?'L':'M'}${(12+(p.at-start)/Math.max(1,end-start)*(width-24)).toFixed(2)},${(range?height-12-(p.price-min)/range*(height-24):height/2).toFixed(2)}`).join(' ');
 }
 return {fresh,quote,createTape,sparkline};
});
