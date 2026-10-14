'use strict';
const B=require('./tf2-solid-80-sop'),R=require('./tf2-scalp-range'),E=require('./tf2-scalp-range-sop');
const VERSION='TF2_POST_CLOSE_HALF_LAYERS_V1',FILL='FILL_PRICE_ATR_V1';
const PAUSED=()=>/^(1|true|yes|on)$/i.test(process.env.ZENCORE_ENTRY_SIGNALS_PAUSED||'');
function qualifies(m,side,at=Date.now()){
 const n=m?.strategyNormal,s=n?.sop,h=s?.hema2,a=s?.atrReference;
 const seen=m?.signalObservedAt,received=m?.receivedAt,sign=side==='BUY'?1:side==='SELL'?-1:0;
 return !PAUSED()&&m?.symbol==='XAUUSD'&&String(m.timeframe)==='2'&&n?.entrySopVersion===E.VERSION&&n.side===side&&
  sign!==0&&Number.isFinite(seen)&&Number.isFinite(received)&&at-seen>=-5000&&at-seen<=30000&&at-received>=-5000&&at-received<=30000&&
  Number.isFinite(a)&&a>0&&Number.isFinite(m.price)&&m.price>0&&s.price===m.price&&
  B.confirmations(side,s).pass&&sign*(h.fast-h.slow)>=.10*a&&sign*(h.waveTrend1-h.waveTrend2)>0;
}
// State is deliberately session-local: a restart, offline heartbeat or relink
// cannot reconstruct a close and accidentally replay an old trade.
class Tracker{
 constructor(){this.states=new Map();}
 clear(user){this.states.delete(user);}
 observe(user,pod,positions,latest,at){
  const own=positions.filter(p=>p.origin!=='MANUAL'&&p.symbol==='XAUUSD'&&p.strategyMode==='TF2_SCALPING');
  const key=pod.id+'|'+pod.accountFingerprint;
  let x=this.states.get(user);
  if(x&&(x.key!==key||at-x.lastHeartbeat>15000)){this.clear(user);x=null;}
  if(own.length){
   const p=latest?.payload;
   if(latest?.status!=='EXECUTED'||p?.analysisSnapshot?.analysisSopVersion!==E.VERSION||
      !own.every(z=>z.side===p.side&&z.setupId===latest.id.slice(0,20))){this.clear(user);return;}
   this.states.set(user,{key,parent:latest.id,side:p.side,lastHeartbeat:at,seenOpen:true,emptyCount:0,closedAt:null});return;
  }
  if(!x)return;
  x.lastHeartbeat=at;
  if(latest?.id!==x.parent&&latest?.id!==x.issued){this.clear(user);return;}
  if(x.issued)return;
  if(x.emptyCount===0)x.closedAt=at;
  x.emptyCount++;
 }
 ready(user,pod,m,at){
  const x=this.states.get(user);
  if(!x||x.key!==pod.id+'|'+pod.accountFingerprint||x.issued||x.emptyCount<2||at-x.lastHeartbeat>15000||
    !qualifies(m,x.side,at)||m.signalObservedAt<x.closedAt)return null;
  return {...x,id:VERSION+'|'+pod.id+'|'+x.parent};
 }
 issued(user,commandId){const x=this.states.get(user);if(x)x.issued=commandId;}
}
function marketForReentry(m,closure){
 const n=m.strategyNormal,t=m.signalObservedAt,p=R.levels(closure.side,m.price,n.sop.atrReference);
 return {...m,setupKey:closure.id,entryEvent:true,feedChannel:'EXECUTION',entryAuthorizedAt:t,
  strategyNormal:{...n,state:'READY',solid:true,entryType:'POST_CLOSE_REENTRY',plan:{...p,riskPlanVersion:R.VERSION},
    sop:{...n.sop,solid:true,triggerAt:t,qualifiedAt:t}}};
}
function halfSettings(profile){
 const raw=profile.modeSettings?.TF2_SCALPING?.gold;
 const count=Number(raw?.layers??profile.layers),layers=Math.floor(count/2);
 if(raw?.enabled===false||!Number.isInteger(count)||count<2||count>10)return null;
 return {...profile,layers,modeSettings:{...profile.modeSettings,TF2_SCALPING:{...profile.modeSettings?.TF2_SCALPING,
  gold:{...raw,layers}}}};
}
function annotate(setup,closure,atr){
 if(!setup)return null;
 const evidence={version:VERSION,parentCommandId:closure.parent,closedAt:closure.closedAt,layerFraction:.5};
 setup.payload.reentry=evidence;
 setup.payload.analysisSnapshot={...setup.payload.analysisSnapshot,entryAnchor:FILL,reentry:evidence};
 setup.payload.fillRisk={version:FILL,atr,distances:R.distances(atr)};
 setup.payload.exitPolicy=null;
 return setup;
}
module.exports={VERSION,FILL,Tracker,qualifies,marketForReentry,halfSettings,annotate};
