'use strict';
// Pine owns signal qualification. Transport only verifies event identity and plan shape.
const {fixedLockForRisk,isFixedLock,fixedPlanPass}=require('./tf2-ribbon-scalping');
const POLICY='PINE_DIRECT_FILL_GAP4_V1';
const NO_DEADLINE=253402300799000; // finite compatibility timestamp; no trading TTL
function isEvent(m={}) {
 const meta=m.setupMeta||{};
 return /^[A-Z0-9][A-Z0-9._#&+!-]{0,31}$/.test(m.symbol || '')&&['1','15'].includes(String(m.timeframe))&&
  m.feedChannel==='EXECUTION'&&m.feedUpdateVersion==='SPLIT_CHANNEL_BOOTSTRAP_V2'&&
  m.entryEvent===true&&meta.entryPolicyVersion==='PINE_NATIVE_SOLID_ENTRY_V7';
}
function isCommand(c={}){return c.type==='PLACE_SETUP'&&c.payload?.analysisSnapshot?.executionPolicy===POLICY;}
function hemaAligned(m,side){
 const h=m.hemaConfirmation?.tf1||{},fast=m.hema20??m.hemaFast??h.fast,slow=m.hema40??m.hemaSlow??h.slow;
 return [fast,slow].every(v=>Number.isFinite(v)&&v>0)&&(side==='BUY'?fast>slow:side==='SELL'?fast<slow:false);
}
function decision(m={}) {
 if(!isEvent(m))return null;
 const meta=m.setupMeta,tf=String(m.timeframe),side=meta.solidSide,sign=side==='BUY'?1:side==='SELL'?-1:0;
 const p={entry:m.normal3Entry,sl:m.initialSl,tp1:m.tp1,tp2:m.tp2,tp3:m.tp3};
 const fixedLock=fixedLockForRisk(meta.riskPlanVersion);
 if((fixedLock||isFixedLock(meta.exitLockVersion))&&(m.symbol!=='XAUUSD'||tf!=='1'||meta.exitLockVersion!==fixedLock||!fixedPlanPass(side,p,fixedLock)))return null;
 if(tf==='1'&&!hemaAligned(m,side))return null;
 if(!sign||!m.setupKey||![meta.completedAt,m.entryAuthorizedAt,m.signalObservedAt].every(x=>Number.isFinite(x)&&x>0)||
  m.entryAuthorizedAt!==meta.completedAt||m.entryAuthorizedAt>m.signalObservedAt||
  !Object.values(p).every(x=>Number.isFinite(x)&&x>0)||sign*(p.entry-p.sl)<=0||
  sign*(p.tp1-p.entry)<=0||sign*(p.tp2-p.tp1)<=0||sign*(p.tp3-p.tp2)<=0)return null;
 const snapshot={contractVersion:'ZENCORE_ANALYSIS_EXECUTION_V1',decision:'ENTRY_AUTHORIZED',decisionOwner:'ZENCORE_ANALYSIS',
  strategy:'NORMAL_3M_SOP_V32',schemaVersion:'32.3-EXIT-STEPLOCK',symbol:m.symbol,side,...p,
  executionPolicy:POLICY,maxEntryGap:4,executionTimeframe:tf,entryAnchor:'MT5_FILL_PLAN_V1',
  analysisSopVersion:`NORMAL_20261001_TF${tf}_RIBBON_V1`,entryPolicyVersion:'PINE_3TRIGGERS_3OF4_CHOP50_V3',
  qualificationPolicyVersion:meta.entryPolicyVersion,exitLockVersion:m.symbol!=='XAUUSD'?'MT5_FILL_STEPLOCK':tf==='15'?'PINE_STEPLOCK_BE_TF15_V1':(fixedLock||'PINE_STEPLOCK_150_TP3_PLUS3_V1'),
  setupKey:m.setupKey,signalObservedAt:m.signalObservedAt,sourceReceivedAt:m.receivedAt,
  entryAuthorizedAt:m.entryAuthorizedAt,qualifiedAt:meta.completedAt,cycleKind:meta.cycleKind,
  confirmationEvidence:{owner:'PINE',executionPolicy:POLICY}};
 return {signalKey:[POLICY,tf,m.symbol,side,m.setupKey,meta.completedAt].join('|'),snapshot};
}
module.exports={POLICY,NO_DEADLINE,isEvent,isCommand,decision,hemaAligned};
