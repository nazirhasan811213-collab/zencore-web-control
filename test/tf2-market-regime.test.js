const test=require('node:test'),assert=require('node:assert/strict');
const C=require('../analysis-execution-contract'),{normalEntrySop}=require('../normal-entry-sop');
const h={fast:102,slow:101,previousFast:101,previousSlow:100};
const feed={timeframe:'2',chopIndex:40,normal3Side:'BUY',normal3Solid:true,normal3Entry:100,normal3Close:100.1,normal3Atr:1,
 normal3Sop1:true,normal3Sop2:true,normal3Sop3:true,normal3Forecast:'NEUTRAL',normal3MarketPower:56,
 hemaConfirmation:{tf2:h,tf3:{...h,confirmed:true}}};
function market(){const x=normalEntrySop(feed);return {symbol:'XAUUSD',receivedAt:Date.now(),price:100.1,sidewaysChop:40,
 strategyNormal:{state:'READY',side:'BUY',tf:'2m',solid:true,entrySopVersion:x.version,
 sop:{gates:x.gates,marketRegime:x.marketRegime},plan:{entry:100,sl:99,tp1:101,tp2:102,tp3:103}}};}
test('TF2 pauses immediately at CHOP threshold, explicit sideways, missing/invalid data',()=>{
 assert.equal(normalEntrySop({...feed,chopIndex:61.79}).standardReady,true);
 for(const edit of [{chopIndex:61.8},{chopIndex:80},{sidewaysGuard:true},{marketStructure:'RANGE'},
  {chopIndex:undefined},{chopIndex:''},{chopIndex:-1},{chopIndex:101},{normal3Forecast:'CHOPPY'}]){
  const x=normalEntrySop({...feed,...edit});assert.equal(x.standardReady,false,JSON.stringify(edit));
  assert.equal(x.marketRegime.pass,false);
 }
});
test('unclear or conflicting direction cannot open; directional NEUTRAL is retained',()=>{
 assert.equal(normalEntrySop(feed).standardReady,true);
 for(const edit of [{normal3MarketPower:50},{normal3Side:'WAIT'},
  {hemaConfirmation:{tf2:h,tf3:{...h,confirmed:true,previousSlow:102}}}])
  assert.equal(normalEntrySop({...feed,...edit}).standardReady,false);
});
test('contract blocks stale READY under sideways and CHOP; resumes only when clean',()=>{
 const m=market();assert.ok(C.createEntryDecision(m));
 for(const edit of [{sidewaysGuard:true},{sidewaysChop:61.8},{dashboard:{marketStructure:'SIDEWAYS'}},
  {strategyNormal:{...m.strategyNormal,sop:{...m.strategyNormal.sop,marketRegime:{pass:false,reason:'WAIT_CHOP_DATA'}}}}])
  assert.equal(C.createEntryDecision({...m,...edit}),null);
 assert.ok(C.createEntryDecision({...m,sidewaysGuard:false,sidewaysChop:50}));
});
test('management still closes and protects SL while new entries are blocked',()=>{
 const m={...market(),sidewaysGuard:true,sidewaysChop:80,positionManagement:{action:'EXIT_ALL',
  slMoveTriggered:true,slMoveAction:'MOVE_SL_ENTRY',activeSl:100}};
 assert.equal(C.createEntryDecision(m),null);
 assert.deepEqual(C.createManagementDecision(m).snapshot.actions.map(a=>a.type),['MOVE_SL_ENTRY','CLOSE_PERCENT']);
});
