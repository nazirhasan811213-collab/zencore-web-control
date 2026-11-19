'use strict';
const RULE='TF1_CURRENT_SOLID_3GREEN_HEMA_PRICE_V1';
const SEPT_RULE='TF1_SEP24_4GREEN_HEMA5_V1';
const SEPT_VERSION='NORMAL_20261001_TF1_SEP24_HEMA5_V8';
const VERSION='NORMAL_20261001_TF1_CURRENT_SOLID_HEMAPRICE_V7';
const num=v=>v===null||v===undefined||v===''?null:Number.isFinite(Number(v))?Number(v):null;
function isCurrentSolidTf1(d){return String(d?.timeframe)==='1'&&(d.setupMeta||d.tf1SetupMeta)?.entryRuleVersion&&[RULE,SEPT_RULE].includes((d.setupMeta||d.tf1SetupMeta).entryRuleVersion);}
function evaluateCurrentSolidTf1(d={}){
 const sept=(d.setupMeta||d.tf1SetupMeta)?.entryRuleVersion===SEPT_RULE,minimumGreen=sept?4:3;
 const side=String(d.normal3Side||'').toUpperCase(),entry=num(d.normal3Entry),close=num(d.normal3Close),atr=num(d.normal3Atr);
 const flags=[1,2,3,4,5].map(i=>d['normal3Sop'+i]===true),green=flags.filter(Boolean).length;
 const forecast=String(d.normal3Forecast||'').toUpperCase(),power=num(d.normal3MarketPower),solid=d.normal3Solid===true;
 const forecastPass=power!==null&&power>=0&&power<=100&&(side==='BUY'?
  (forecast==='NEUTRAL'||forecast==='BULLISH')&&power>50:
  side==='SELL'&&(forecast==='NEUTRAL'&&power<50||forecast==='BEARISH'&&power>50));
 const ribbon=d.hemaConfirmation?.version==='HEMA13_LIVE_V1'?d.hemaConfirmation.tf1:null;
 const fast=num(sept?d.normal5Hema20:ribbon?.fast),slow=num(sept?d.normal5Hema40:ribbon?.slow),hemaPrice=sept?num(d.normal5Close):close,valid=fast!==null&&slow!==null&&hemaPrice!==null;
 const mode=!valid?'WAIT_DATA':hemaPrice>Math.max(fast,slow)?'BUY':hemaPrice<Math.min(fast,slow)?'SELL':'NEUTRAL';
 const state=!valid?'WAIT_DATA':mode==='BUY'?'ABOVE':mode==='SELL'?'BELOW':'INSIDE';
 const hema1={fast,slow,price:hemaPrice,timeframe:sept?'5':'1',mode,state,pass:['BUY','SELL'].includes(side)&&mode===side};
 const pricePast=entry!==null&&close!==null&&(side==='BUY'?close>entry:side==='SELL'&&close<entry);
 const gates=[{key:'solid',label:'SOLID aktif sekarang',pass:solid},
  {key:'entry',label:'Harga lepas entry line',pass:pricePast},
  {key:'sop',label:`Checklist minimum ${minimumGreen}/5 hijau`,pass:green>=minimumGreen,detail:`${green}/5`},
  {key:'forecast',label:'Forecast menyokong arah — had 50%',pass:forecastPass,detail:`${forecast||'WAIT'} ${power===null?'—':power+'%'}`},
  {key:'hema1',label:`Harga TF${sept?5:2} di luar HEMA20 dan HEMA40`,pass:hema1.pass,detail:state}];
 return {version:sept?SEPT_VERSION:VERSION,currentSolidOnly:true,minimumGreen,solid,sequential:false,pullback:null,entryExpiryTarget:'TP1',
  entryLimit:num(d.tp1),atrReference:atr,hema1,side,entry,close,atr,flags,green,forecast,power,forecastPass,pricePast,
  cross:d.normal3PriceCrossEntry===true,m5Pass:sept&&hema1.pass,gates,reentryType:'NONE',reentrySide:'WAIT',reentryGates:[],reentryReady:false,
  standardReady:String(d.timeframe)==='1'&&gates.every(g=>g.pass)&&entry!==null&&close!==null&&atr!==null&&atr>0};
}
module.exports={RULE,VERSION,SEPT_RULE,SEPT_VERSION,isCurrentSolidTf1,evaluateCurrentSolidTf1};
