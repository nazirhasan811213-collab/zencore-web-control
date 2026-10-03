'use strict';

const num=v=>v===null||v===undefined||v===''?null:Number.isFinite(Number(v))?Number(v):null;
const upper=v=>String(v||'').toUpperCase();

function hemaStrength(r={},side,requireConfirmed=false){
  const fast=num(r.fast),slow=num(r.slow),pf=num(r.previousFast),ps=num(r.previousSlow);
  if([fast,slow,pf,ps].some(v=>v===null)||(requireConfirmed&&r.confirmed!==true))
    return {pass:false,state:'WAIT_DATA'};
  const sign=side==='BUY'?1:side==='SELL'?-1:0;
  const aligned=sign!==0&&sign*(fast-slow)>0;
  const fastSlope=fast-pf,slowSlope=slow-ps;
  const pass=aligned&&sign*fastSlope>0&&sign*slowSlope>0;
  const gap=Math.abs(fast-slow),previousGap=Math.abs(pf-ps);
  return {pass,state:pass?'STRONG':aligned?'WEAK':'AGAINST',fastSlope,slowSlope,gap,
    gapState:gap>previousGap?'EXPANDING':gap<previousGap?'CONTRACTING':'FLAT'};
}

function normalEntrySop(d={}){
  const side=upper(d.normal3Side);
  const entry=num(d.normal3Entry),close=num(d.normal3Close),atr=num(d.normal3Atr);
  const flags=[1,2,3,4,5].map(i=>d['normal3Sop'+i]===true);
  const green=flags.filter(Boolean).length;
  const forecast=upper(d.normal3Forecast),power=num(d.normal3MarketPower);
  const forecastFor=direction=>power!==null&&(direction==='BUY'
    ? forecast==='NEUTRAL'&&power>55||forecast==='BULLISH'&&power>50
    : direction==='SELL'&&(forecast==='NEUTRAL'&&power<45||forecast==='BEARISH'&&power>50));
  const forecastPass=forecastFor(side);
  const cross=d.normal3PriceCrossEntry===true;
  const pricePast=d.normal3PricePastEntry===true;
  const m5Position=upper(d.normal5Position);
  const m5Pass=side==='BUY'?m5Position==='ABOVE':side==='SELL'&&m5Position==='BELOW';
  const hema2=hemaStrength(d.hemaConfirmation?.tf2,side);
  const hema3=hemaStrength(d.hemaConfirmation?.tf3,side,true);
  const gates=[
    {key:'timeframe',label:'Chart TF2',pass:String(d.timeframe)==='2'},
    {key:'solid',label:'Solid Entry Signal',pass:d.normal3Solid===true},
    {key:'sop',label:'SOP Dashboard ≥3/5 Green',pass:green>=3,detail:`${green}/5`},
    {key:'forecast',label:'10-Candle Forecast',pass:forecastPass,detail:`${forecast||'WAIT'} ${power===null?'—':power+'%'}`},
    {key:'hema2',label:'HEMA TF2 searah dan bergerak kuat',pass:hema2.pass,detail:hema2.state},
    {key:'hema3',label:'HEMA TF3 confirmed searah dan bergerak kuat',pass:hema3.pass,detail:hema3.state}
  ];
  // Friday 25 Sep Normal entry has no separate re-entry route.
  const reentryType='NONE',reentrySide='WAIT',reentryGates=[],reentryReady=false;
  const standardReady=['BUY','SELL'].includes(side)&&gates.every(g=>g.pass)&&entry!==null&&close!==null&&atr!==null&&atr>0;
  return {version:'SOLID_TF2_3GREEN_HEMA23_V2',hema2,hema3,side,entry,close,atr,flags,green,forecast,power,forecastPass,cross,pricePast,m5Pass,gates,
    standardReady,reentryType,reentrySide,reentryGates,reentryReady};
}

module.exports={normalEntrySop,hemaStrength};
