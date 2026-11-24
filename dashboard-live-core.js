(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.ZenCoreDashboardLive=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const number=v=>v===null||v===undefined||v===''?null:Number.isFinite(Number(v))?Number(v):null;
 function fresh(view,now=Date.now()){
  const m=view?.market,received=number(m?.receivedAt),observed=number(m?.signalObservedAt)??received,limit=Number(view?.timeframe)===1?60000:30000;
  return view?.status==='LIVE'&&received>0&&observed>0&&now-received>=-5000&&now-received<=limit&&now-observed>=-5000&&now-observed<=limit;
 }
 function available(view,now=Date.now()){
  const m=view?.market,received=number(m?.receivedAt),observed=number(m?.signalObservedAt)??received;
  return !!m&&received>0&&observed>0&&now-received>=-5000&&now-observed>=-5000&&
   now-received<=180000&&now-observed<=180000&&view.status!=='INVALID_TIME';
 }
 function latestView(polled,pushed){
  if(!pushed?.market)return polled;
  if(!polled?.market)return {...polled,...pushed,entryReady:pushed.entryReady===true};
  const at=view=>number(view.market.signalObservedAt)??number(view.market.receivedAt)??0;
  return at(pushed)>at(polled)?{...polled,...pushed,entryReady:pushed.entryReady===true}:polled;
 }
 function context(view,now=Date.now()){
  if(!available(view,now))return null;
  const m=view.market,n=m.strategyNormal||{},s=n.sop||{},advisor={...m.dashboard,...s.advisor};
  const wt1=number(m.waveTrend1),wt2=number(m.waveTrend2);
  const fast=number(m.hemaFast??m.hema20),slow=number(m.hemaSlow??m.hema40);
  const momentum=m.momentum||advisor.momentum||(wt1===null||wt2===null?'—':wt1>wt2?'Bullish':wt1<wt2?'Bearish':'Mendatar');
  const trend=m.marketStructure||advisor.trend||advisor.dashboard?.structure||
   (fast===null||slow===null?'—':fast>slow?'Bullish':fast<slow?'Bearish':'Mendatar');
  const reason=n.reason||'Tunggu pengesahan setup Pine.';
  const coach=typeof advisor.aiCoach==='string'?advisor.aiCoach.match(/\[NASIHAT\]\s*:[ \t]*([^\r\n]+)/i)?.[1]:null;
  const forecast=s.forecast||'—';
  const ageSeconds=Math.max(0,Math.floor((now-(number(m.signalObservedAt)??number(m.receivedAt)))/1000));
  const pineScore=number(m.setupMeta?.entryQuality?.score);
  return {momentum,trend,ageSeconds,
   score:pineScore!==null&&pineScore>=0&&pineScore<=100?pineScore:null,
   guide:m.proTip||advisor.proTip||reason,
   summary:advisor.mtfSummary||('SOLID '+(n.side||'—')+' · HEMA '+trend+' · Momentum '+momentum+' · Forecast '+forecast),
   advice:advisor.advice||coach||reason};
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
  const account=a?.hostedAccount??a?.pod;
  const last=account?.lastSeenAt;
  const serverNow=Number.isFinite(a?.generatedAt)?a.generatedAt:now;
  const age=Number.isFinite(last)&&last>0?serverNow-last:null;
  const recent=age!==null&&age>=-5000&&age<=30000&&a?.connection?.online===true;
  const positions=recent&&Array.isArray(a.positions)?a.positions:null;
  const snapshotStatus=positions?(age<=15000?'FRESH':'DELAYED'):!a?'UNAVAILABLE':
   age!==null&&!recent?'STALE':'WAITING';
  const sum=key=>positions&&positions.every(p=>typeof p[key]==='number'&&Number.isFinite(p[key]))?positions.reduce((n,p)=>n+p[key],0):null;
  return {account:account?.accountMask||'—',server:account?.serverMask||'Belum dipautkan',
   count:positions?positions.length:null,lot:sum('volume'),floating:sum('profitUsd'),lastSeen:age===null?null:last,
   ageSeconds:age===null?null:Math.max(0,Math.floor(age/1000)),snapshotStatus,
   tf1:positions?positions.filter(p=>(p.strategyMode||'TF2_SCALPING')==='TF2_SCALPING').length:null,
   tf15:positions?positions.filter(p=>p.strategyMode==='TF15_INTRA').length:null};
 }
 return {fresh,available,latestView,context,quote,createTape,sparkline,accountOverview,pineAnalysis};
});
