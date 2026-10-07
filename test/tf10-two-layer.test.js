const test=require('node:test'),assert=require('node:assert/strict');
const S=require('../strategies/tf10-two-layer'),{normalEntrySop}=require('../normal-entry-sop');
const now=Date.UTC(2026,9,4),h={fast:102,slow:101,previousFast:101,previousSlow:100};
const input={now,pine:{symbol:'XAUUSD',timeframe:'10',confirmed:true,receivedAt:now,sourceBarOpenAt:now-600000,sourceBarCloseAt:now,
 normal3Side:'BUY',normal3Solid:true,normal3Entry:100,normal3Close:100.05,normal3Atr:1,
 normal3Sop1:true,normal3Sop2:true,normal3Sop3:true,normal3Sop4:true,normal3PricePastEntry:true,normal3Forecast:'BULLISH',normal3MarketPower:60,
 hemaConfirmation:{version:'HEMA23_LIVE_V1',tf10:h,tf2:h,tf3:{...h,confirmed:true}}},
 plan:{sourceTimeframe:'10',entry:100,sl:99,tp1:102,tp2:104,tp3:106},quote:{bid:100,ask:100.05,capturedAt:now},
 account:{demo:true,equityUsd:1000,dayStartEquityUsd:1000,dailyNetPnlUsd:0,openRiskUsd:0},
 broker:{tickSize:.01,tickValuePerLot:1,volumeMin:.01,volumeMax:10,volumeStep:.01,minimumStopDistancePrice:.1,
 commissionRoundtripUsdPerLot:7,entrySlippageReservePrice:.01,exitSlippageReservePrice:.01,marginApproved:true,marginApprovedTotalLot:.02},settings:{lotPerLayer:.01,layers:2}};
test('new strategy requires TF10, emits exactly two layers, preserves TF2 existing strategy',()=>{
 const r=S.entryDecision(input);assert.equal(r.status,'READY');assert.equal(r.command.layers,2);assert.equal(r.command.totalLot,.02);
 assert.equal(normalEntrySop(input.pine).standardReady,false);
 assert.equal(normalEntrySop({...input.pine,timeframe:'2',chopIndex:40}).standardReady,true);
 assert.equal(S.sop({...input.pine,timeframe:'2',chopIndex:40}).standardReady,false);
});
test('HEMA TF2/TF3 and strict forecast rules remain unchanged',()=>{
 for(const edit of [{hemaConfirmation:undefined},{normal3MarketPower:50},{normal3Sop3:false}])assert.equal(S.sop({...input.pine,...edit}).standardReady,false);
 assert.equal(S.sop({...input.pine,normal3Forecast:'NEUTRAL',normal3MarketPower:50}).standardReady,false);
});
test('live accounts, stale TF10 feed, wrong layer count and duplicate pair cannot open',()=>{
 const inputs=[{...input,account:{...input.account,demo:false}},{...input,now:now+31000},
 {...input,settings:{...input.settings,layers:3}},{...input,openPositions:[{symbol:'XAUUSD'}]}];
 for(const i of inputs)assert.equal(S.entryDecision(i).command,null);
});
test('two layers must fit setup and aggregate risk, daily pause and known broker costs',()=>{
 for(const account of [{...input.account,equityUsd:100},{...input.account,openRiskUsd:14},{...input.account,dailyNetPnlUsd:-20}])assert.equal(S.entryDecision({...input,account}).command,null);
 assert.equal(S.entryDecision({...input,broker:{...input.broker,commissionRoundtripUsdPerLot:null}}).status,'WAIT_DATA');
 assert.equal(S.entryDecision({...input,broker:{...input.broker,marginApprovedTotalLot:.03}}).command,null);
});
test('rejects late/excessive-cost entry and illegal volume without widening SL',()=>{
 for(const quote of [{...input.quote,bid:101.8,ask:101.85},{...input.quote,bid:100,ask:101},{...input.quote,bid:102,ask:102.05}])assert.equal(S.entryDecision({...input,quote}).command,null);
 assert.equal(S.entryDecision({...input,settings:{lotPerLayer:.015,layers:2}}).command,null);
 assert.equal(input.plan.sl,99);
});
const state={setupKey:'SYNTHETIC',side:'BUY',plan:input.plan,lockStage:0,partialDone:false,closed:false};
test('StepLock uses actual ticket fill at TP1 and highest stage on quote jump',()=>{
 const a=S.managementIntents({state,quote:{bid:102,ask:102.05}})[0];assert.equal(a.type,'MOVE_SL_ENTRY');assert.equal(a.useActualFillPerTicket,true);
 const z=S.managementIntents({state,quote:{bid:106,ask:106.05}})[0];assert.equal(z.type,'MOVE_SL_TP2');assert.equal(z.value,104);
 assert.equal(state.lockStage,0);assert.equal(S.acknowledge(state,z,{success:false}).lockStage,0);
 const next=S.acknowledge(state,z,{success:true});assert.equal(next.lockStage,3);assert.equal(S.managementIntents({state:next,quote:{bid:106,ask:106.05}}).length,0);
});
test('partial is once-only after broker success; emergency closes all',()=>{
 const a=S.managementIntents({state,quote:{bid:101,ask:101.05},pineExit:{confirmed:true,action:'CLOSE_50_NOW'}})[0];
 assert.equal(a.value,50);const next=S.acknowledge(state,a,{success:true});
 assert.equal(S.managementIntents({state:next,quote:{bid:101,ask:101.05},pineExit:{confirmed:true,action:'CLOSE_50_NOW'}}).length,0);
 assert.equal(S.managementIntents({state,quote:{bid:101,ask:101.05},pineExit:{confirmed:true,action:'EXIT_ALL',sourceBarCloseAt:now}})[0].value,100);
});

test('SELL TF10 uses the same two-layer rule and correct quote direction',()=>{
 const h={fast:98,slow:99,previousFast:99,previousSlow:100};
 const i={...input,pine:{...input.pine,normal3Side:'SELL',normal3Forecast:'BEARISH',normal3Close:99.95,
 hemaConfirmation:{version:'HEMA23_LIVE_V1',tf10:h,tf2:h,tf3:{...h,confirmed:true}}},plan:{sourceTimeframe:'10',entry:100,sl:101,tp1:98,tp2:96,tp3:94},quote:{bid:99.95,ask:100,capturedAt:now}};
 assert.equal(S.entryDecision(i).status,'READY');assert.equal(S.entryDecision(i).command.layers,2);
 const z=S.managementIntents({state:{...state,side:'SELL',plan:i.plan},quote:{bid:93.95,ask:94}})[0];
 assert.equal(z.type,'MOVE_SL_TP2');assert.equal(z.value,96);
});
test('confirmed protected SL remains active after acknowledgement',()=>{
 const a=S.managementIntents({state,quote:{bid:106,ask:106.05}})[0];const next=S.acknowledge(state,a,{success:true});
 assert.equal(next.activeSl,104);const close=S.managementIntents({state:next,quote:{bid:103.99,ask:104.04}})[0];
 assert.equal(close.value,100);assert.equal(close.reason,'SL_HIT');
});

test('TF2 plans cannot silently become TF10 plans',()=>{assert.equal(S.entryDecision({...input,plan:{...input.plan,sourceTimeframe:'2'}}).command,null);});
