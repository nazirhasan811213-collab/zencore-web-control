const test=require('node:test'),assert=require('node:assert/strict'),C=require('../auto-trade-core');
const settings={capitalUsd:100,lotPerLayer:.01,layers:3,symbols:['XAUUSD','EURUSD'],strategyMode:'TF2_SCALPING'};
test('TF2 preset exists for gold and FX; no change to sizing or TF15 exit policy',()=>{
 const existing={version:'LEGACY_TF15'};
 const v=C.validateSettings({...settings,strategyExitPolicies:{TF15_INTRA:existing}});
 assert.equal(v.ok,true);
 for(const symbol of settings.symbols){const e=C.effectiveSettings(v.value,symbol);assert.equal(e.exitPolicy.slDistanceFactor,.8);assert.equal(e.exitPolicy.maxCompletedCandlesWithoutTp1,3);assert.equal(e.layers,3);assert.equal(e.lotPerLayer,.01);}
 const ten=C.effectiveSettings({...v.value,strategyMode:'TF15_INTRA'});assert.deepEqual(ten.exitPolicy,existing);assert.equal(ten.layers,2);
 assert.equal(v.value.strategyExitPolicies.TF2_SCALPING.executionStatus,'REQUIRES_EA_1_1');
});
test('TF15 has no new policy when none was previously configured',()=>{
 const v=C.validateSettings({...settings,strategyMode:'TF15_INTRA'});
 assert.equal(C.effectiveSettings(v.value).exitPolicy,null);
});
