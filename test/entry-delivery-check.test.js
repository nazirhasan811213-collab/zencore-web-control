const test=require('node:test'),a=require('node:assert/strict');
const {checkEntryDelivery:check}=require('../entry-delivery-check');
const plan={entry:4100,sl:4103,tp1:4098,tp2:4096,tp3:4094};
function fixture(){return {command:{payload:{...plan,side:'SELL',analysisSnapshot:{setupKey:'solid1',executionTimeframe:'3'}}},market:{timeframe:'3',setupKey:'solid1',signalObservedAt:100000,price:4100,strategyNormal:{state:'READY',side:'SELL',plan:{...plan}}}};}
test('unchanged plan and harmless binary rounding pass delivery',()=>{const {command,market}=fixture();a.equal(check(command,market,100001).ok,true);market.strategyNormal.plan.tp1+=1e-10;a.equal(check(command,market,100001).ok,true);});
test('real plan, side, setup and SOP changes remain blocked with exact reason',()=>{for(const [mutate,reason] of [[m=>m.strategyNormal.plan.tp1+=.001,'PLAN_CHANGED'],[m=>m.strategyNormal.side='BUY','SIDE_CHANGED'],[m=>m.setupKey='solid2','SETUP_CHANGED'],[m=>m.strategyNormal.state='WAIT','SOP_CONFIRMATION_FAILED']]){const {command,market}=fixture();mutate(market);a.equal(check(command,market,100001).reason,reason);}});
test('stale or missing data cannot deliver queued entry',()=>{const {command,market}=fixture();a.equal(check(command,market,130001).reason,'MARKET_STALE');a.equal(check(command,null,100001).reason,'MARKET_MISSING');});
