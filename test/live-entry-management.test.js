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
