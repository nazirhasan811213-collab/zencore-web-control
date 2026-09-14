// ZenCore V17 compatibility shim.
// Purpose: prevent runtime crashes caused by missing helper declarations.
// This module does not alter Pine V32 Normal SOP hard gates.

const N=v=>{if(v===null||v===undefined||v===''||v==='null'||v==='NaN')return null;const n=Number(v);return Number.isFinite(n)?n:null};
const U=v=>String(v||'').toUpperCase();
const clamp=(v,a=0,b=100)=>Math.max(a,Math.min(b,v));

global.exactAction=function(v){
  const s=U(v);
  return s==='BUY'||s==='SELL'?s:'WAIT';
};

global.mtfTotalOf=function(d){
  const direct=N(d?.mtfTotal);
  if(direct!=null)return direct;
  return [N(d?.mtf1),N(d?.mtf2),N(d?.mtf3)].filter(v=>v!=null).reduce((a,v)=>a+v,0);
};

global.signalConfidenceForSide=function(p,side){
  if(!p||side==='WAIT')return 0;
  if(p.direction===side)return clamp(N(p.confidence)||0);
  const b=N(p.bullScore)||0,s=N(p.bearScore)||0,total=b+s;
  if(!total)return 0;
  return clamp(Math.round((side==='BUY'?b:s)/total*100));
};

global.predictionReadiness=function(d,symbol,p){
  return clamp(Math.round(N(p?.confidence)||0));
};

global.predictionRadarScore=function(d,symbol,p){
  return clamp(Math.round(N(p?.confidence)||0));
};

global.predictionGrade=function(p){
  const c=N(p?.confidence)||0;
  if(p?.direction==='WAIT')return c>=75?'B':'C';
  return c>=90?'A+':c>=82?'A':c>=74?'B+':'B';
};

global.predictionStatus=function(d,symbol,p){
  if(!d)return'OFFLINE';
  if(d.tradeActive===true&&!d.tp3Hit&&!d.slHit)return'TRADE ACTIVE';
  if(p?.direction!=='WAIT'&&(N(p?.confidence)||0)>=84)return'HOT PREDICTION';
  if(p?.direction!=='WAIT'&&(N(p?.confidence)||0)>=74)return'PREDICTION READY';
  if(p?.direction!=='WAIT')return'WATCH';
  return'WAIT';
};

global.updateSignalCore=function(symbol,d){
  const side=global.exactAction(d?.action)!=='WAIT'
    ?global.exactAction(d?.action)
    :(U(d?.normal3Side)==='BUY'||U(d?.normal3Side)==='SELL'?U(d?.normal3Side):'WAIT');
  const active=d?.tradeActive===true&&!d?.tp3Hit&&!d?.slHit;
  return{
    side,
    stage:active?'ACTIVE':side!=='WAIT'?'WATCH':'WAIT',
    locked:active,
    lockedAt:active?Date.now():0,
    updatedAt:Date.now(),
    invalidStreak:0,
    cooldownUntil:0,
    reason:active?'Pine trade active':side!=='WAIT'?'Direction received from Pine':'Waiting for valid signal',
    warnings:[]
  };
};

global.updateOpportunity=function(symbol,d){
  const side=global.exactAction(d?.action)!=='WAIT'
    ?global.exactAction(d?.action)
    :(U(d?.normal3Side)==='BUY'||U(d?.normal3Side)==='SELL'?U(d?.normal3Side):'WAIT');
  return{
    type:side==='WAIT'?'NONE':'PINE_SIGNAL',
    side,
    strength:d?.normal3Solid===true?'STRONG':side==='WAIT'?'NONE':'WATCH',
    reason:d?.normal3Solid===true?'Solid Entry received from Pine':'Waiting for Solid Entry',
    risk:'NORMAL',
    price:N(d?.normal3Entry??d?.entry??d?.close),
    triggeredAt:side==='WAIT'?0:Date.now()
  };
};

console.log('[Compat] V17 missing helper shim loaded');
