(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.ZenCoreDashboardLive=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const number=v=>v===null||v===undefined||v===''?null:Number.isFinite(Number(v))?Number(v):null;
 function fresh(view,now=Date.now()){
  const m=view?.market,received=number(m?.receivedAt),observed=number(m?.signalObservedAt)??received,limit=Number(view?.timeframe)===2?60000:30000;
  return view?.status==='LIVE'&&received>0&&observed>0&&now-received>=-5000&&now-received<=limit&&now-observed>=-5000&&now-observed<=limit;
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
 function pineAnalysis(view,now=Date.now()){
  if(!fresh(view,now))return ['Menunggu data Pine segar.'];
  const m=view.market,n=m.strategyNormal||{},s=n.sop||{},side=['BUY','SELL'].includes(n.side)?n.side:'—';
  const open=number(m.open),close=number(m.close),fast=number(m.hemaFast??m.hema20),slow=number(m.hemaSlow??m.hema40);
  const candle=open===null||close===null?'—':close>open?'bullish':close<open?'bearish':'doji';
  const hema=fast===null||slow===null?'—':fast>slow?'hijau':fast<slow?'merah':'mendatar';
  const rsi=number(m.rsi),score=number(s.marketPower),forecast=s.forecast||'—';
  return ['SOLID '+side+' '+(n.solid===true?'aktif':n.solid===false?'tidak aktif':'—')+' • Candle '+candle+' • HEMA '+hema,
   'RSI '+(rsi===null?'—':rsi.toFixed(1))+' • Momentum '+(typeof m.momentum==='string'&&m.momentum.trim()?m.momentum:'—'),
   'Forecast '+forecast+' • Skor '+(score!==null&&score>=0&&score<=100?score+'/100':'—')];
 }
 function accountOverview(a,now=Date.now()){
  const last=a?.pod?.lastSeenAt??a?.hostedAccount?.lastSeenAt;
  const live=Number.isFinite(last)&&now-last>=-5000&&now-last<=15000&&a?.connection?.online===true&&Array.isArray(a.positions);
  const positions=live?a.positions:null;
  const sum=key=>positions&&positions.every(p=>typeof p[key]==='number'&&Number.isFinite(p[key]))?positions.reduce((n,p)=>n+p[key],0):null;
  return {account:a?.pod?.accountMask||a?.hostedAccount?.accountMask||'—',server:a?.pod?.serverMask||a?.hostedAccount?.serverMask||'Belum dipautkan',
   count:positions?positions.length:null,lot:sum('volume'),floating:sum('profitUsd'),lastSeen:live?last:null,
   tf2:positions?positions.filter(p=>(p.strategyMode||'TF2_SCALPING')==='TF2_SCALPING').length:null,
   tf15:positions?positions.filter(p=>p.strategyMode==='TF15_INTRA').length:null};
 }
 return {fresh,quote,createTape,sparkline,accountOverview,pineAnalysis};
});
