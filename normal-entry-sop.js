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

// Direction means ribbon alignment, independent of slope and candle-close state.
function hemaMode(r={},side){
  const fast=num(r.fast),slow=num(r.slow);
  const mode=fast===null||slow===null?'WAIT_DATA':fast>slow?'BUY':fast<slow?'SELL':'NEUTRAL';
  return {mode,state:mode,pass:['BUY','SELL'].includes(side)&&mode===side};
}

// Width uses one shared price-volatility reference (ATR TF2), independent of chart zoom.
function hemaWidthMode(r={},side,atrReference){
 const x=hemaMode(r,side),fast=num(r.fast),slow=num(r.slow),atr=num(atrReference);
 const gap=fast!==null&&slow!==null?Math.abs(fast-slow):null;
 const wide=gap!==null&&atr!==null&&atr>0&&gap>atr*.10;
 return {...x,fast,slow,gap,atrReference:atr,gapAtr:gap!==null&&atr>0?gap/atr:null,
  state:atr===null||atr<=0||gap===null?'WAIT_DATA':wide?x.mode:'SIDEWAYS',pass:x.pass&&wide};
}

// Verified production snapshot: 284b98d, 2026-10-01 21:43 MYT.
// October 1 baseline plus current-direction HEMA2/3 or HEMA15/30; no candle-close/slope gate.
// TF2 and TF15 price-vs-HEMA5 gate removed on 5 October; five-item checklist remains intact.
function evaluateEntrySop(d={},timeframe='2'){
  const atrPullback=d.normal3SetupPolicy==='SEQUENTIAL_ATR40_V1';
  const sequential=atrPullback||String(timeframe)==='2'&&d.normal3SetupPolicy==='TF2_SEQUENTIAL_V1';
  const entryExpired=d.normal3EntryExpired===true;
  const solid=!entryExpired&&(sequential?d.normal3SetupArmed===true:d.normal3Solid===true);
  const revisedTf2=String(timeframe)==='2'&&(d.setupMeta||d.tf2SetupMeta)?.entryRuleVersion==='TF2_3GREEN_TP2_HEMAGAP_V1';
  const version=revisedTf2?(atrPullback?'NORMAL_20261001_TF2_SEQ_ATR40_TP2_HEMAGAP_V5':sequential?'NORMAL_20261001_TF2_SEQ_TP2_HEMAGAP_V5':'NORMAL_20261001_TF2_TP2_HEMAGAP_V5'):(atrPullback?`NORMAL_20261001_TF${timeframe}_SEQ_ATR40_V4`:sequential?'NORMAL_20261001_TF2_SEQ_V3':`NORMAL_20261001_TF${timeframe}_V2`);
  const side=upper(d.normal3Side);
  const entry=num(d.normal3Entry),close=num(d.normal3Close),atr=num(d.normal3Atr);
  const flags=[1,2,3,4,5].map(i=>d['normal3Sop'+i]===true);
  const green=flags.filter(Boolean).length;
  const forecast=upper(d.normal3Forecast),power=num(d.normal3MarketPower);
  const forecastFor=direction=>power!==null&&(direction==='BUY'
    ? (forecast==='NEUTRAL'&&power>50||forecast==='BULLISH'&&power>(revisedTf2?40:50))
    : direction==='SELL'&&(forecast==='NEUTRAL'&&power<50||forecast==='BEARISH'&&power>(revisedTf2?40:50)));
  const forecastPass=forecastFor(side);
  const cross=d.normal3PriceCrossEntry===true;
  const pricePast=sequential&&entry!==null&&close!==null?(side==='BUY'?close>entry:side==='SELL'&&close<entry):d.normal3PricePastEntry===true;
  const m5Position=upper(d.normal5Position);
  const m5Pass=side==='BUY'?m5Position==='ABOVE':side==='SELL'&&m5Position==='BELOW';
  const higherTf=String(timeframe)==='15'?'30':'3';
  const currentHema=d.hemaConfirmation?.version===(String(timeframe)==='15'?'HEMA1530_V1':'HEMA23_LIVE_V1')?d.hemaConfirmation:null;
  const ownHema=revisedTf2?hemaWidthMode(currentHema?.tf2,side,atr):hemaMode(currentHema?.['tf'+timeframe],side);
  const higherHema=revisedTf2?hemaWidthMode(currentHema?.tf3,side,atr):hemaMode(currentHema?.['tf'+higherTf],side);
  const minimumGreen=revisedTf2?3:4;
  const entryLimit=num(d[revisedTf2?'tp2':'tp1']);
  const sign=side==='BUY'?1:side==='SELL'?-1:0;
  const entryWindowPass=!revisedTf2||entryLimit===null||close!==null&&sign*(entryLimit-close)>0;
  const gates=[
    {key:'solid',label:entryExpired?(revisedTf2?'TP2 dah disentuh — tunggu SOLID baharu':'TP1 dah disentuh — tunggu SOLID baharu'):sequential?'SOLID setup dipegang':'Solid Entry Signal',pass:solid},
    {key:'entry',label:revisedTf2?'Harga lepas Entry, sebelum TP2':'Price Lepas Entry Line',pass:pricePast&&entryWindowPass},
    {key:'sop',label:`SOP Dashboard ≥${minimumGreen}/5 Green`,pass:green>=minimumGreen,detail:`${green}/5`},
    {key:'forecast',label:'Forecast mengikut arah',pass:forecastPass,detail:`${forecast||'WAIT'} ${power===null?'—':power+'%'}`},
    {key:'hema'+timeframe,label:'HEMA TF'+timeframe+(revisedTf2?' searah, ribbon tidak nipis':' searah entry'),pass:ownHema.pass,detail:ownHema.state},
    {key:'hema'+higherTf,label:'HEMA TF'+higherTf+(revisedTf2?' searah, ribbon tidak nipis':' searah entry'),pass:higherHema.pass,detail:higherHema.state}
  ];
  if(atrPullback)gates.splice(1,0,{key:'pullback',label:'Candle besar: pullback 40%',pass:d.pullback?.pass===true,detail:d.pullback?.state||'WAIT_ATR'});
  // Friday 25 Sep Normal entry has no separate re-entry route.
  const reentryType='NONE',reentrySide='WAIT',reentryGates=[],reentryReady=false;
  const standardReady=String(d.timeframe)===String(timeframe)&&['BUY','SELL'].includes(side)&&gates.every(g=>g.pass)&&entry!==null&&close!==null&&atr!==null&&atr>0;
  return {version,minimumGreen,entryExpiryTarget:revisedTf2?'TP2':'TP1',entryLimit,atrReference:atr,solid,sequential,pullback:atrPullback?d.pullback:null,['hema'+timeframe]:ownHema,['hema'+higherTf]:higherHema,side,entry,close,atr,flags,green,forecast,power,forecastPass,cross,pricePast,m5Pass,gates,
    standardReady,reentryType,reentrySide,reentryGates,reentryReady};
}

function normalEntrySop(d={}){return evaluateEntrySop(d,'2');}
module.exports={normalEntrySop,evaluateEntrySop,hemaStrength,hemaMode,hemaWidthMode};
