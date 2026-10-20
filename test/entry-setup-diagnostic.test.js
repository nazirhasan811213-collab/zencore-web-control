'use strict';
const {test}=require('node:test'),a=require('node:assert/strict');
const {inspect}=require('../entry-setup-diagnostic');
const settings={capitalUsd:200,lotPerLayer:.01,layers:2,symbols:['XAUUSD'],strategyMode:'BOTH'};
test('diagnosis separates invalid settings, disabled TF and non-execution input without changing settings',()=>{
 const m={symbol:'XAUUSD',timeframe:'2'},p={...settings,password:'PRIVATE_SENTINEL'};
 const before=JSON.stringify(p);a.equal(inspect(m,p).reason,'WAIT_EXECUTION_EVENT');
 a.equal(JSON.stringify(p),before);a.equal(JSON.stringify(inspect(m,p)).includes('PRIVATE_SENTINEL'),false);
 a.equal(inspect(m,{...p,capitalUsd:0}).reason,'ENTRY_SETTINGS_INVALID');
 a.equal(inspect(m,{...p,modeSettings:{TF2_SCALPING:{gold:{enabled:false}}}}).reason,'ENTRY_TF_NOT_CONFIGURED');
 a.equal(inspect(m,{...p,strategyMode:'TF15_INTRA'}).reason,'ENTRY_TF_NOT_SELECTED');
});
test('diagnosis separates stale source, expired authorization and mismatched timestamp',()=>{
 const at=Date.now(),m={symbol:'XAUUSD',timeframe:'2',feedChannel:'EXECUTION',entryEvent:true,receivedAt:at-31000,entryAuthorizedAt:at,signalObservedAt:at,strategyNormal:{sop:{qualifiedAt:at}}};
 a.equal(inspect(m,settings,at).reason,'ENTRY_SOURCE_STALE');
 a.equal(inspect({...m,receivedAt:at,entryAuthorizedAt:at-61000},settings,at).reason,'ENTRY_EVENT_EXPIRED');
 a.equal(inspect({...m,receivedAt:at,entryAuthorizedAt:at-1},settings,at).reason,'ENTRY_AUTHORIZATION_MISMATCH');
});

test('missing/null plan cannot interrupt dispatch diagnostics',()=>{const result=inspect({symbol:'XAUUSD',timeframe:'15',strategyNormal:{side:'BUY',plan:null,sop:{}}},settings);a.equal(result.checks.planValid,false);});
