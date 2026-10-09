'use strict';
const POLICY='SEQUENTIAL_ATR40_V1';
const num=v=>v===null||v===undefined||v===''?null:Number.isFinite(Number(v))?Number(v):null;
// Each pair and TF owns a separate setup. Only SOLID is latched; confirmations stay live.
function createEntrySetupTracker(){
 const states=new Map();
 function update(d={}){
  const tf=String(d.timeframe);if(!['2','15'].includes(tf))return d;
  const meta=d.setupMeta||d.tf2SetupMeta;
  // Alert snapshots are versioned separately from the server deploy. Preserve
  // the original six gates until that TF's Pine explicitly supplies ATR40 data.
  const atrPolicy=meta?.policy===POLICY;
  const side=String(d.normal3Side||'').toUpperCase(),sign=side==='BUY'?1:side==='SELL'?-1:0;
  const entry=num(d.normal3Entry),sl=num(d.initialSl),price=num(d.normal3Close);
  // Target/SL updates do not make an exhausted setup a new SOLID signal.
  const key=sign&&entry!==null&&sl!==null?(d.setupKey?[side,d.setupKey].join('|'):[side,entry,sl,d.tp1,d.tp2,d.tp3].join('|')):null;
  const id=String(d.symbol||'')+'|'+tf,old=states.get(id);
  const state=old&&old.key===key?old:{key,armed:false,cancelled:false,expired:false,impulse:null};
  const tp1=num(d.tp1),quote=num(d.close??d.normal3Close);
  const targetTouched=d.tp1Hit===true||d.tp2Hit===true||d.tp3Hit===true||num(d.slLockStage)>=1||meta?.entryExpired===true||
   (sign&&tp1!==null&&((price!==null&&sign*(price-tp1)>=0)||(quote!==null&&sign*(quote-tp1)>=0)));
  if(key&&targetTouched)state.expired=true;
  const ended=d.tradeActive===false||d.slHit===true||d.positionExitStage==='CLOSED'||
   ['EXIT_ALL','EXIT_REMAINING','EXIT_SL'].includes(d.positionExitAction)||
   (sign&&price!==null&&sl!==null&&sign*(price-sl)<=0);
  if(!key||ended||state.expired){state.armed=false;state.cancelled=true;state.impulse=null;}
  else if(!state.cancelled&&(d.normal3Solid===true||meta?.policy===POLICY&&meta.solidLatched===true))state.armed=true;
  states.set(id,state);
  // Apply TP1 expiry to older alerts too, without changing their six SOP gates.
  if(!atrPolicy)return state.expired?{...d,normal3EntryExpired:true,normal3EntryExpiryReason:'TP1_TOUCHED_WAIT_NEW_SOLID'}:d;
  const bar=num(d.time??d.sourceBarOpenAt),open=num(d.open),extreme=num(sign>0?d.high:d.low);
  const atr=num(meta?.atrBeforeBar??d.atrBeforeBar);
  // Restore frozen impulse data carried by the Pine latch after server restart.
  let invalidImpulseMeta=false;
  if(state.armed&&meta?.policy===POLICY&&meta.impulseRequired===true){
   const origin=num(meta.impulseOpen),peak=num(meta.impulseExtreme),reference=num(meta.impulseAtr),at=num(meta.impulseBar);
   const valid=origin!==null&&peak!==null&&reference>0&&at>0&&bar!==null&&at<=bar&&sign*(peak-origin)>=1.5*reference;
   invalidImpulseMeta=!valid;
   if(valid&&(!state.impulse||at>state.impulse.bar||at===state.impulse.bar&&sign*(peak-state.impulse.extreme)>0))
    state.impulse={bar:at,open:origin,extreme:peak,atr:reference};
  }
  if(state.armed&&bar!==null&&open!==null&&extreme!==null&&atr>0){
   const leg=sign*(extreme-open);
   if(leg>=1.5*atr&&(!state.impulse||bar>=state.impulse.bar)){
    if(!state.impulse||bar!==state.impulse.bar)state.impulse={bar,open,extreme,atr};
    else if(sign*(extreme-state.impulse.extreme)>0)state.impulse.extreme=extreme;
   }
  }
  const impulse=state.impulse,required=!!impulse;
  const distance=required?sign*(impulse.extreme-impulse.open):null;
  const level=required?impulse.extreme-sign*.4*distance:null;
  const fraction=required&&price!==null?sign*(impulse.extreme-price)/distance:null;
  const hasAtr=atr!==null&&atr>0;
  const missingImpulse=invalidImpulseMeta;
  const pass=state.armed&&hasAtr&&!missingImpulse&&(!required||fraction!==null&&fraction>=.4-1e-9);
  const pullback={required:required||missingImpulse,pass,state:state.expired?'TP1_TOUCHED_WAIT_NEW_SOLID':!state.armed?'WAIT_SOLID':!hasAtr?'WAIT_ATR':missingImpulse?'WAIT_IMPULSE_DATA':required?(pass?'PULLBACK_READY':'WAIT_PULLBACK'):'NORMAL_CANDLE',
   atrBeforeBar:atr,atrMultiplier:1.5,retracement:.4,level,fraction,distance,...(impulse?{impulse:{...impulse}}:{})};
  states.set(id,state);
  return {...d,normal3SetupPolicy:POLICY,normal3SetupArmed:state.armed,normal3SetupCancelled:state.cancelled,normal3EntryExpired:state.expired,
   normal3EntryExpiryReason:state.expired?'TP1_TOUCHED_WAIT_NEW_SOLID':null,pullback};
 }
 return {update};
}
module.exports={POLICY,createEntrySetupTracker};
