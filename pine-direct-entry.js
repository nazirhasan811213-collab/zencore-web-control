'use strict';
// Pine owns signal qualification. Transport only verifies event identity and plan shape.
const POLICY='PINE_DIRECT_FILL_GAP4_V1';
const NO_DEADLINE=253402300799000; // finite compatibility timestamp; no trading TTL
function isEvent(m={}) {
 const meta=m.setupMeta||{};
 return /^[A-Z0-9][A-Z0-9._#&+!-]{0,31}$/.test(m.symbol || '')&&['2','15'].includes(String(m.timeframe))&&
  m.feedChannel==='EXECUTION'&&m.feedUpdateVersion==='SPLIT_CHANNEL_BOOTSTRAP_V2'&&
  m.entryEvent===true&&meta.entryPolicyVersion==='PINE_NATIVE_SOLID_ENTRY_V7';
}
function isCommand(c={}){return c.type==='PLACE_SETUP'&&c.payload?.analysisSnapshot?.executionPolicy===POLICY;}
function decision(m={}) {
 if(!isEvent(m))return null;
 const meta=m.setupMeta,tf=String(m.timeframe),side=meta.solidSide,sign=side==='BUY'?1:side==='SELL'?-1:0;
 const p={entry:m.normal3Entry,sl:m.initialSl,tp1:m.tp1,tp2:m.tp2,tp3:m.tp3};
 if(!sign||!m.setupKey||![meta.completedAt,m.entryAuthorizedAt,m.signalObservedAt].every(x=>Number.isFinite(x)&&x>0)||
  m.entryAuthorizedAt!==meta.completedAt||m.entryAuthorizedAt>m.signalObservedAt||
  !Object.values(p).every(x=>Number.isFinite(x)&&x>0)||sign*(p.entry-p.sl)<=0||
  sign*(p.tp1-p.entry)<=0||sign*(p.tp2-p.tp1)<=0||sign*(p.tp3-p.tp2)<=0)return null;
 const snapshot={contractVersion:'ZENCORE_ANALYSIS_EXECUTION_V1',decision:'ENTRY_AUTHORIZED',decisionOwner:'ZENCORE_ANALYSIS',
  strategy:'NORMAL_3M_SOP_V32',schemaVersion:'32.3-EXIT-STEPLOCK',symbol:m.symbol,side,...p,
  executionPolicy:POLICY,maxEntryGap:4,executionTimeframe:tf,entryAnchor:'MT5_FILL_PLAN_V1',
  analysisSopVersion:`NORMAL_20261001_TF${tf}_RIBBON_V1`,entryPolicyVersion:'PINE_3TRIGGERS_3OF4_CHOP50_V3',
  qualificationPolicyVersion:meta.entryPolicyVersion,exitLockVersion:m.symbol!=='XAUUSD'?'MT5_FILL_STEPLOCK':tf==='15'?'PINE_STEPLOCK_BE_TF15_V1':'PINE_STEPLOCK_150_TP3_PLUS3_V1',
  setupKey:m.setupKey,signalObservedAt:m.signalObservedAt,sourceReceivedAt:m.receivedAt,
  entryAuthorizedAt:m.entryAuthorizedAt,qualifiedAt:meta.completedAt,cycleKind:meta.cycleKind,
  confirmationEvidence:{owner:'PINE',executionPolicy:POLICY}};
 return {signalKey:[POLICY,tf,m.symbol,side,m.setupKey,meta.completedAt].join('|'),snapshot};
}
module.exports={POLICY,NO_DEADLINE,isEvent,isCommand,decision};
