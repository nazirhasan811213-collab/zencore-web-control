'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {rebasedManagement}=require('../live-entry-management');
const C=require('../analysis-execution-contract');
function fixture(side='BUY'){
 const sign=side==='BUY'?1:-1,p={symbol:'XAUUSD',side,strategyMode:'TF2_SCALPING',entry:4001,sl:4001-sign*3,tp1:4001+sign*2,tp2:4001+sign*4,tp3:4001+sign*6,analysisSnapshot:{entryAnchor:'LIVE_SIGNAL_PRICE_V1'}};
 return {command:{id:'entry-id',payload:p},positions:[{origin:'ZENCORE',symbol:'XAUUSD',side,strategyMode:'TF2_SCALPING',entry:p.entry,currentPrice:p.entry,activeSl:p.sl,openedAt:1000,tp1:p.tp1,tp2:p.tp2,tp3:p.tp3}],market:{symbol:'XAUUSD',timeframe:'2',receivedAt:2000,positionManagement:{action:'EXIT_SL',slMoveTriggered:true,slMoveAction:'MOVE_SL_TP1',activeSl:9999}}};
}
test('old chart SL and exit cannot close rebased orders; TP1/2/3 use command targets',()=>{
 for(const side of ['BUY','SELL']){
  const f=fixture(side),p=f.command.payload,sign=side==='BUY'?1:-1;
  const held=rebasedManagement(f.market,f.positions,f.command);assert.equal(held.rebased,true);assert.equal(C.createManagementDecision(held.market),null);
  for(let stage=1;stage<=3;stage++){
   f.positions[0].currentPrice=p['tp'+stage]+sign*.01;
   const result=C.createManagementDecision(rebasedManagement(f.market,f.positions,f.command).market);assert.ok(result);
   const move=result.snapshot.actions.find(x=>x.type.startsWith('MOVE_SL'));assert.equal(move.activeSl,stage===1?p.entry:p['tp'+(stage-1)]);
   assert.equal(result.snapshot.entryCommandId,'entry-id');
   assert.equal(result.snapshot.actions.some(x=>x.type==='CLOSE_PERCENT'),stage===1);
  }
 }
});
test('legacy, manual and mismatched batches retain their own policy',()=>{
 const f=fixture();assert.equal(rebasedManagement(f.market,f.positions,{payload:{}}).market,f.market);
 f.positions[0].origin='MANUAL';assert.equal(rebasedManagement(f.market,f.positions,f.command).rebased,false);
 f.positions[0].origin='ZENCORE';f.positions[0].tp1+=1;assert.equal(rebasedManagement(f.market,f.positions,f.command).rebased,false);
});
test('missing quote blocks derived management, and yellow exit requires post-entry BE protection',()=>{
 const f=fixture();f.positions[0].currentPrice=null;assert.equal(rebasedManagement(f.market,f.positions,f.command).market,null);
 f.positions[0].currentPrice=f.command.payload.entry;f.market.positionManagement={oppositeYellow:true,action:'EXIT_REMAINING'};
 assert.equal(C.createManagementDecision(rebasedManagement(f.market,f.positions,f.command).market),null);
 f.positions[0].activeSl=f.positions[0].entry;
 assert.equal(C.createManagementDecision(rebasedManagement(f.market,f.positions,f.command).market).snapshot.actions[0].percent,100);
});

// New re-entry tickets may have different fill targets; old chart levels must never manage them.
test('fill-anchored re-entry suppresses chart-price exits and permits only fresh advisory exits',()=>{
 const {rebasedManagement}=require('../live-entry-management');
 const command={id:'11111111-1111-4111-8111-111111111111',payload:{symbol:'XAUUSD',side:'BUY',strategyMode:'TF2_SCALPING',analysisSnapshot:{entryAnchor:'FILL_PRICE_ATR_V1'}}};
 const positions=[{origin:'ZENCORE',symbol:'XAUUSD',side:'BUY',strategyMode:'TF2_SCALPING',setupId:command.id.slice(0,20),fillRiskVersion:'FILL_PRICE_ATR_V1',entry:4100,activeSl:4100,openedAt:1000}];
 let m={signalObservedAt:1001,positionManagement:{slMoveTriggered:true,slMoveAction:'MOVE_SL_TP1',activeSl:99,action:'EXIT_SL'}};
 let x=rebasedManagement(m,positions,command);assert.equal(x.market.positionManagement.action,'HOLD');assert.equal(x.market.positionManagement.slMoveTriggered,false);
 m.positionManagement={action:'EXIT_ALL'};x=rebasedManagement(m,positions,command);assert.equal(x.market.positionManagement.action,'EXIT_ALL');
 m.signalObservedAt=999;x=rebasedManagement(m,positions,command);assert.equal(x.market.positionManagement.action,'HOLD');
 positions[0].setupId='wrong';assert.equal(rebasedManagement(m,positions,command).market,null);
});
