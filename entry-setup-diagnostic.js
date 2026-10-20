'use strict';
const Core=require('./auto-trade-core');
const Contract=require('./analysis-execution-contract');
// Read-only explanation. Never authorizes, queues or changes an order/profile.
function inspect(market={},profile={},at=Date.now()){
 const tf=String(market.timeframe||''),n=market.strategyNormal||{},s=n.sop||{};
 const mode=tf==='15'?'TF15_INTRA':'TF2_SCALPING';
 const validation=Core.validateSettings(profile);
 const effective=Core.effectiveSettings({...validation.value,strategyMode:mode},market.symbol);
 const adapter=tf==='15'?require('./tf15-intraday'):tf==='2'?require('./tf2-ribbon-scalping'):null;
 const fresh=(t,max)=>Number.isFinite(t)&&at-t>=-5000&&at-t<=max;
 const checks={settingsValid:validation.ok,settingsErrorFields:Object.keys(validation.errors),
  modeSelected:validation.value.strategyMode==='BOTH'||validation.value.strategyMode===mode,
  tfEnabled:effective.enabled===true,lotConfigured:effective.lotPerLayer>0,layersConfigured:Number.isInteger(effective.layers)&&effective.layers>0,
  executionChannel:market.feedChannel==='EXECUTION',entryEvent:market.entryEvent===true,
  sourceFresh:fresh(market.receivedAt,30000),authorizationFresh:fresh(market.entryAuthorizedAt,60000),
  qualificationFresh:fresh(s.qualifiedAt,60000),
  authorizationMatches:market.entryDeliveryVersion==='FIXED_EVENT_RETRY_V1'?market.entryAuthorizedAt===s.qualifiedAt&&market.entryAuthorizedAt<=market.signalObservedAt:market.entryAuthorizedAt===market.signalObservedAt,
  planValid:!!adapter?.planPass(n.side,n.plan||{},s),confirmationsPass:!!adapter?.confirmations(n.side,s).pass,
  contractValid:!!Contract.createEntryDecision(market)};
 let reason=!checks.settingsValid?'ENTRY_SETTINGS_INVALID':!checks.modeSelected?'ENTRY_TF_NOT_SELECTED':
  !checks.tfEnabled||!checks.lotConfigured||!checks.layersConfigured?'ENTRY_TF_NOT_CONFIGURED':
  !checks.executionChannel||!checks.entryEvent?'WAIT_EXECUTION_EVENT':
  !checks.sourceFresh?'ENTRY_SOURCE_STALE':!checks.authorizationFresh||!checks.qualificationFresh?'ENTRY_EVENT_EXPIRED':
  !checks.authorizationMatches?'ENTRY_AUTHORIZATION_MISMATCH':!checks.planValid?'ENTRY_PLAN_REJECTED':
  !checks.confirmationsPass?'ENTRY_CONFIRMATIONS_REJECTED':!checks.contractValid?'ENTRY_CONTRACT_REJECTED':'ENTRY_BUILD_OR_CURRENT_CHECK';
 return {reason,checks};
}
module.exports={inspect};
