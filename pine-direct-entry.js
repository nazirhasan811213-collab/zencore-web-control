'use strict';
// Pine owns signal qualification. Transport only verifies event identity and plan shape.
const {fixedLockForRisk,isFixedLock,fixedPlanPass,SOLID_RETEST_LOCK,SOLID_SPLIT_LOCK}=require('./tf2-ribbon-scalping');
const SOLID_SPLIT='TF1_SOLID_SPLIT_V1';
const SPLIT_CONFIRM_GRACE=15000;
const POLICY='PINE_DIRECT_FILL_GAP4_V1';
const NO_DEADLINE=253402300799000; // finite compatibility timestamp; no trading TTL
function isEvent(m={}) {
 const meta=m.setupMeta||{};
 return /^[A-Z0-9][A-Z0-9._#&+!-]{0,31}$/.test(m.symbol || '')&&['1','15'].includes(String(m.timeframe))&&
  m.feedChannel==='EXECUTION'&&m.feedUpdateVersion==='SPLIT_CHANNEL_BOOTSTRAP_V2'&&
  (m.entryEvent===true||meta.solidSplit!=null)&&meta.entryPolicyVersion==='PINE_NATIVE_SOLID_ENTRY_V7';
}
function isCommand(c={}){return c.type==='PLACE_SETUP'&&c.payload?.analysisSnapshot?.executionPolicy===POLICY;}
function hemaAligned(m,side){
 const h=m.hemaConfirmation?.tf1||{},fast=m.hema20??m.hemaFast??h.fast,slow=m.hema40??m.hemaSlow??h.slow;
 return [fast,slow].every(v=>Number.isFinite(v)&&v>0)&&(side==='BUY'?fast>slow:side==='SELL'?fast<slow:false);
}
function splitDecision(m) {
 const meta=m.setupMeta, stage=meta.solidSplit, at=m.signalObservedAt;
 const {phase,bar,side,entry}=stage||{};
 const sign=side==='BUY'?1:side==='SELL'?-1:0;
 if(m.symbol!=='XAUUSD'||String(m.timeframe)!=='1'||!sign||
    !Number.isSafeInteger(bar)||bar<=0||bar%60000!==0||bar!==m.time||
    !Number.isFinite(at)||!Number.isFinite(entry)||entry<=8||!Number.isFinite(m.close)||
    !['EARLY','CONFIRM','ABORT'].includes(phase))return null;
 if(phase!=='ABORT'&&(!hemaAligned(m,side)||sign*(m.close-entry)<=0))return null;
 const closeAt=bar+60000;
 if(phase==='EARLY'?(m.confirmed!==false||at<bar||at>=closeAt):
    (m.confirmed!==true||at<closeAt||at>=closeAt+SPLIT_CONFIRM_GRACE))return null;
 if(phase==='CONFIRM'&&(meta.nativeSolid?.pulse!==true||meta.nativeSolid.barTime!==bar||
    meta.solidSide!==side||meta.sourceEntry!==entry||!Number.isFinite(m.open)||sign*(m.close-m.open)<=0))return null;
 const expiresAt=phase==='EARLY'?closeAt:closeAt+SPLIT_CONFIRM_GRACE;
 const setupKey=['TF1','XAUUSD',side,bar].join('|');
 const snapshot={
  contractVersion:'ZENCORE_ANALYSIS_EXECUTION_V1',decision:'ENTRY_AUTHORIZED',decisionOwner:'ZENCORE_ANALYSIS',
  strategy:'NORMAL_3M_SOP_V32',schemaVersion:'32.3-EXIT-STEPLOCK',symbol:'XAUUSD',side,entry,
  sl:entry-sign*3,tp1:entry+sign*1.5,tp2:entry+sign*3,tp3:entry+sign*4.5,
  executionPolicy:POLICY,maxEntryGap:4,executionTimeframe:'1',entryAnchor:'MT5_FILL_PLAN_V1',
  analysisSopVersion:'NORMAL_20261001_TF1_RIBBON_V1',entryPolicyVersion:'PINE_3TRIGGERS_3OF4_CHOP50_V3',
  qualificationPolicyVersion:meta.entryPolicyVersion,exitLockVersion:SOLID_SPLIT_LOCK,
  setupKey,signalObservedAt:at,sourceReceivedAt:m.receivedAt,entryAuthorizedAt:at,qualifiedAt:at,cycleKind:'INITIAL',
  solidSplit:{version:SOLID_SPLIT,phase,bar,expiresAt},confirmationEvidence:{owner:'PINE',executionPolicy:POLICY,phase}
 };
 return {signalKey:[SOLID_SPLIT,setupKey,phase].join('|'),snapshot};
}
function decision(m={}) {
 if(!isEvent(m))return null;
 if(m.setupMeta.solidSplit!=null)return splitDecision(m);
 const meta=m.setupMeta,tf=String(m.timeframe),side=meta.solidSide,sign=side==='BUY'?1:side==='SELL'?-1:0;
 const p={entry:m.normal3Entry,sl:m.initialSl,tp1:m.tp1,tp2:m.tp2,tp3:m.tp3};
 const fixedLock=fixedLockForRisk(meta.riskPlanVersion);
 if((fixedLock||isFixedLock(meta.exitLockVersion))&&(m.symbol!=='XAUUSD'||tf!=='1'||meta.exitLockVersion!==fixedLock||!fixedPlanPass(side,p,fixedLock)))return null;
 if(fixedLock===SOLID_RETEST_LOCK&&(!m.confirmed||p.entry!==meta.sourceEntry||
  !Number.isFinite(m.low)||!Number.isFinite(m.high)||m.low>p.entry||m.high<p.entry||
  !Number.isFinite(meta.solidRetestSopClose)||meta.solidRetestSopClose<=0||
  !Number.isFinite(m.time)||m.time<meta.solidRetestSopClose||meta.completedAt<=meta.solidRetestSopClose))return null;
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
module.exports={SOLID_SPLIT,POLICY,NO_DEADLINE,isEvent,isCommand,decision,hemaAligned};
