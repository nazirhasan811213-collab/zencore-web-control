'use strict';

const num=v=>v===null||v===undefined||v===''?null:Number.isFinite(Number(v))?Number(v):null;
const upper=v=>String(v||'').toUpperCase();

function normalEntrySop(d={}){
  const side=upper(d.normal3Side);
  const entry=num(d.normal3Entry),close=num(d.normal3Close),atr=num(d.normal3Atr);
  const flags=[1,2,3,4,5].map(i=>d['normal3Sop'+i]===true);
  const green=flags.filter(Boolean).length;
  const forecast=upper(d.normal3Forecast),power=num(d.normal3MarketPower);
  const forecastFor=direction=>power!==null&&(direction==='BUY'
    ? (forecast==='NEUTRAL'||forecast==='BULLISH')&&power>50
    : direction==='SELL'&&(forecast==='NEUTRAL'&&power<50||forecast==='BEARISH'&&power>50));
  const forecastPass=forecastFor(side);
  const cross=d.normal3PriceCrossEntry===true;
  const pricePast=d.normal3PricePastEntry===true;
  const m5Position=upper(d.normal5Position);
  const m5Pass=side==='BUY'?m5Position==='ABOVE':side==='SELL'&&m5Position==='BELOW';
  const gates=[
    {key:'solid',label:'Solid Entry Signal',pass:d.normal3Solid===true},
    {key:'entry',label:'Price Lepas Entry Line',pass:pricePast},
    {key:'sop',label:'SOP Dashboard ≥4/5 Green',pass:green>=4,detail:`${green}/5`},
    {key:'forecast',label:'Forecast mengikut arah',pass:forecastPass,detail:`${forecast||'WAIT'} ${power===null?'—':power+'%'}`},
    {key:'m5',label:'Current 5m vs HEMA Ribbon',pass:m5Pass,detail:m5Position||'WAIT'}
  ];
  // Friday 25 Sep Normal entry has no separate re-entry route.
  const reentryType='NONE',reentrySide='WAIT',reentryGates=[],reentryReady=false;
  const standardReady=['BUY','SELL'].includes(side)&&gates.every(g=>g.pass)&&entry!==null&&close!==null&&atr!==null&&atr>0;
  return {side,entry,close,atr,flags,green,forecast,power,forecastPass,cross,pricePast,m5Pass,gates,
    standardReady,reentryType,reentrySide,reentryGates,reentryReady};
}

module.exports={normalEntrySop};
