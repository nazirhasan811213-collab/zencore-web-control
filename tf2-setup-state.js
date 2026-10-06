'use strict';
const num=v=>v===null||v===undefined||v===''?null:Number.isFinite(Number(v))?Number(v):null;
const POLICY='TF2_SEQUENTIAL_V1';
// Remember SOLID only. Confirmations and prices are always taken from the latest feed.
function createTf2SetupTracker(){
 const states=new Map();
 function update(d={}){
  if(String(d.timeframe)!=='2')return d;
  const side=String(d.normal3Side||'').toUpperCase(),entry=num(d.normal3Entry),sl=num(d.initialSl),price=num(d.normal3Close);
  const key=['BUY','SELL'].includes(side)&&entry!==null&&sl!==null?
   [side,d.setupKey||'',entry,sl,d.tp1,d.tp2,d.tp3].join('|'):null;
  const id=String(d.symbol||''),old=states.get(id);
  let state=old&&old.key===key?old:{key,side,armed:false,cancelled:false};
  const sign=side==='BUY'?1:side==='SELL'?-1:0;
  const ended=d.tradeActive===false||d.slHit===true||d.positionExitStage==='CLOSED'||
   ['EXIT_ALL','EXIT_REMAINING','EXIT_SL'].includes(d.positionExitAction)||
   (sign&&price!==null&&sl!==null&&sign*(price-sl)<=0);
  if(!key||!sign||ended){state.armed=false;state.cancelled=true;}
  else if(!state.cancelled&&(d.normal3Solid===true||
   d.tf2SetupMeta?.policy===POLICY&&d.tf2SetupMeta?.solidLatched===true))state.armed=true;
  states.set(id,state);
  return {...d,normal3SetupPolicy:POLICY,normal3SetupArmed:state.armed,
   normal3SetupCancelled:state.cancelled};
 }
 return {update};
}
module.exports={POLICY,createTf2SetupTracker};
