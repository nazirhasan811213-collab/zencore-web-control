'use strict';
const RULE='TF2_CURRENT_SOLID_3GREEN_HEMA_PRICE_V1';
const VERSION='NORMAL_20261001_TF2_CURRENT_SOLID_HEMAPRICE_V7';
const num=v=>v===null||v===undefined||v===''?null:Number.isFinite(Number(v))?Number(v):null;
function isCurrentSolidTf2(d){return String(d?.timeframe)==='2'&&(d.setupMeta||d.tf2SetupMeta)?.entryRuleVersion===RULE;}
function evaluateCurrentSolidTf2(d={}){
 const side=String(d.normal3Side||'').toUpperCase(),entry=num(d.normal3Entry),close=num(d.normal3Close),atr=num(d.normal3Atr);
 const flags=[1,2,3,4,5].map(i=>d['normal3Sop'+i]===true),green=flags.filter(Boolean).length;
 const forecast=String(d.normal3Forecast||'').toUpperCase(),power=num(d.normal3MarketPower),solid=d.normal3Solid===true;
 const forecastPass=power!==null&&power>=0&&power<=100&&(side==='BUY'?
  (forecast==='NEUTRAL'||forecast==='BULLISH')&&power>50:
  side==='SELL'&&(forecast==='NEUTRAL'&&power<50||forecast==='BEARISH'&&power>50));
 const ribbon=d.hemaConfirmation?.version==='HEMA23_LIVE_V1'?d.hemaConfirmation.tf2:null;
 const fast=num(ribbon?.fast),slow=num(ribbon?.slow),valid=fast!==null&&slow!==null&&close!==null;
 const mode=!valid?'WAIT_DATA':close>Math.max(fast,slow)?'BUY':close<Math.min(fast,slow)?'SELL':'NEUTRAL';
 const state=!valid?'WAIT_DATA':mode==='BUY'?'ABOVE':mode==='SELL'?'BELOW':'INSIDE';
 const hema2={fast,slow,price:close,mode,state,pass:['BUY','SELL'].includes(side)&&mode===side};
 const pricePast=entry!==null&&close!==null&&(side==='BUY'?close>entry:side==='SELL'&&close<entry);
 const gates=[{key:'solid',label:'SOLID aktif sekarang',pass:solid},
  {key:'entry',label:'Harga lepas entry line',pass:pricePast},
  {key:'sop',label:'Checklist minimum 3/5 hijau',pass:green>=3,detail:`${green}/5`},
  {key:'forecast',label:'Forecast menyokong arah — had 50%',pass:forecastPass,detail:`${forecast||'WAIT'} ${power===null?'—':power+'%'}`},
  {key:'hema2',label:'Harga TF2 di luar HEMA20 dan HEMA40',pass:hema2.pass,detail:state}];
 return {version:VERSION,currentSolidOnly:true,minimumGreen:3,solid,sequential:false,pullback:null,entryExpiryTarget:'TP1',
  entryLimit:num(d.tp1),atrReference:atr,hema2,side,entry,close,atr,flags,green,forecast,power,forecastPass,pricePast,
  cross:d.normal3PriceCrossEntry===true,m5Pass:false,gates,reentryType:'NONE',reentrySide:'WAIT',reentryGates:[],reentryReady:false,
  standardReady:String(d.timeframe)==='2'&&gates.every(g=>g.pass)&&entry!==null&&close!==null&&atr!==null&&atr>0};
}
module.exports={RULE,VERSION,isCurrentSolidTf2,evaluateCurrentSolidTf2};
