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
  const directionalGates=direction=>{
    const sign=direction==='BUY'?1:direction==='SELL'?-1:0;
    const h20=num(d.hema20),h40=num(d.hema40),w1=num(d.waveTrend1),w2=num(d.waveTrend2);
    const trend=num(d.globalTrend),chop=num(d.chopIndex);
    return [
      {key:'bar3',label:'Candle 3M ditutup',pass:String(d.timeframe)==='3'&&d.confirmed!==false},
      {key:'chop3',label:'Chop 3M bawah 58',pass:chop!==null&&chop<58,detail:chop===null?'—':chop.toFixed(1)},
      {key:'hema3',label:'HEMA 3M searah',pass:sign!==0&&h20!==null&&h40!==null&&(h20-h40)*sign>0},
      {key:'wave3',label:'WaveTrend 3M searah',pass:sign!==0&&w1!==null&&w2!==null&&(w1-w2)*sign>0},
      {key:'trend3',label:'Trend Pine 3M searah',pass:sign!==0&&trend!==null&&trend*sign>0}
    ];
  };
  const gates=[
    {key:'solid',label:'Solid Entry Signal',pass:d.normal3Solid===true},
    {key:'entry',label:'Price Cross Solid Entry Line',pass:cross},
    {key:'sop',label:'SOP Dashboard ≥4/5 Green',pass:green>=4,detail:`${green}/5`},
    {key:'forecast',label:'Forecast mengikut arah',pass:forecastPass,detail:`${forecast||'WAIT'} ${power===null?'—':power+'%'}`},
    ...directionalGates(side)
  ];
  const reentryType=upper(d.normal3ReentrySignal);
  const reentrySide=upper(d.normal3ReentrySide);
  const reentryGates=[
    {key:'reentry',label:'Normal / High Re-Entry',pass:['NORMAL','HIGH'].includes(reentryType)&&['BUY','SELL'].includes(reentrySide)},
    {key:'hema',label:'Candle sepenuhnya di luar HEMA',pass:d.normal3ReentryHemaPass===true},
    {key:'sop',label:'SOP Dashboard ≥4/5 Green',pass:green>=4,detail:`${green}/5`},
    {key:'forecast',label:'Forecast mengikut arah re-entry',pass:forecastFor(reentrySide)},
    ...directionalGates(reentrySide)
  ];
  const reentryReady=reentryGates.every(g=>g.pass)&&close!==null&&atr!==null&&atr>0;
  const standardReady=['BUY','SELL'].includes(side)&&gates.every(g=>g.pass)&&entry!==null&&atr!==null&&atr>0;
  return {side,entry,close,atr,flags,green,forecast,power,forecastPass,cross,gates,
    standardReady,reentryType,reentrySide,reentryGates,reentryReady};
}

module.exports={normalEntrySop};
