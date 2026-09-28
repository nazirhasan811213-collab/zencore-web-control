'use strict';

const num=v=>v===null||v===undefined||v===''?null:Number.isFinite(Number(v))?Number(v):null;
const upper=v=>String(v||'').toUpperCase();

function normalEntrySop(d={}){
  const side=upper(d.normal3Side);
  const entry=num(d.normal3Entry),close=num(d.normal3Close),atr=num(d.normal3Atr);
  const flags=[1,2,3,4,5].map(i=>d['normal3Sop'+i]===true);
  const green=flags.filter(Boolean).length;
  const forecast=upper(d.normal3Forecast),power=num(d.normal3MarketPower);
  const forecastPass=power!==null&&(side==='BUY'
    ? (forecast==='NEUTRAL'||forecast==='BULLISH')&&power>50
    : side==='SELL'&&(forecast==='NEUTRAL'&&power<50||forecast==='BEARISH'&&power>50));
  const cross=d.normal3PriceCrossEntry===true;
  const gates=[
    {key:'solid',label:'Solid Entry Signal',pass:d.normal3Solid===true},
    {key:'entry',label:'Price Cross Solid Entry Line',pass:cross},
    {key:'sop',label:'SOP Dashboard ≥4/5 Green',pass:green>=4,detail:`${green}/5`},
    {key:'forecast',label:'Forecast mengikut arah',pass:forecastPass,detail:`${forecast||'WAIT'} ${power===null?'—':power+'%'}`}
  ];
  const reentryType=upper(d.normal3ReentrySignal);
  const reentrySide=upper(d.normal3ReentrySide);
  const reentryGates=[
    {key:'reentry',label:'Normal / High Re-Entry',pass:['NORMAL','HIGH'].includes(reentryType)&&['BUY','SELL'].includes(reentrySide)},
    {key:'hema',label:'Candle sepenuhnya di luar HEMA',pass:d.normal3ReentryHemaPass===true}
  ];
  const reentryReady=reentryGates.every(g=>g.pass)&&close!==null&&atr!==null&&atr>0;
  const standardReady=['BUY','SELL'].includes(side)&&gates.every(g=>g.pass)&&entry!==null&&atr!==null&&atr>0;
  return {side,entry,close,atr,flags,green,forecast,power,forecastPass,cross,gates,
    standardReady,reentryType,reentrySide,reentryGates,reentryReady};
}

module.exports={normalEntrySop};
