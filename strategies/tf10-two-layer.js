'use strict';
// Offline strategy candidate. No network, credentials or broker calls. Not registered with live dispatcher.
const {evaluateEntrySop}=require('../normal-entry-sop');
const CONFIG=Object.freeze({version:'SOLID_TF10_3GREEN_HEMA23_2L_V1',entryTimeframe:'10',layers:2,
 riskPerSetupPct:.5,maxOpenRiskPct:1.5,dailyLossPausePct:2,minNetTp1RewardRisk:.5,maxCostFraction:.2,
 maxFeedAgeMs:30000,commandTtlMs:15000,hedging:false,addLayers:false});
const PAIRS=new Set(['XAUUSD','EURUSD','GBPUSD','USDJPY','USDCAD','USDCHF','EURJPY','GBPJPY','EURGBP']);
const num=v=>v===null||v===undefined||v===''?null:Number.isFinite(Number(v))?Number(v):null;
const finite=(...v)=>v.every(x=>num(x)!==null);
const nearly=(a,b)=>Math.abs(a-b)<1e-8;
function sop(d={}){return evaluateEntrySop(d,'10',CONFIG.version);}
function entryDecision({pine={},plan={},quote={},account={},broker={},settings={},openPositions=[],now=Date.now()}={}){
 const x=sop(pine),fail=[],need=[];const sign=x.side==='BUY'?1:x.side==='SELL'?-1:0;
 const symbol=String(pine.symbol||'').toUpperCase();
 if(!PAIRS.has(symbol))fail.push('UNSUPPORTED_PAIR');
 if(!x.standardReady)fail.push('SOP_NOT_READY');
 if(pine.confirmed!==true)fail.push('TF10_CANDLE_NOT_CONFIRMED');
 const received=num(pine.receivedAt),closed=num(pine.sourceBarCloseAt),opened=num(pine.sourceBarOpenAt);
 if(!finite(received,closed,opened)||closed-opened!==600000)need.push('TF10_CANDLE_TIMESTAMPS_REQUIRED');
 else if(received<closed||received>now||now-closed>CONFIG.maxFeedAgeMs||now-received>CONFIG.maxFeedAgeMs)fail.push('STALE_OR_FUTURE_FEED');
 if(account.demo!==true)fail.push('DEMO_ACCOUNT_REQUIRED');
 if(openPositions.some(p=>p.symbol===symbol))fail.push('PAIR_ALREADY_HAS_POSITION');
 const equity=num(account.equityUsd),dayEquity=num(account.dayStartEquityUsd),dailyPnl=num(account.dailyNetPnlUsd),openRisk=num(account.openRiskUsd);
 if(!finite(equity,dayEquity,dailyPnl,openRisk)||equity<=0||dayEquity<=0||openRisk<0)need.push('ACCOUNT_RISK_DATA_REQUIRED');
 else if(dailyPnl<=-dayEquity*CONFIG.dailyLossPausePct/100)fail.push('DAILY_ENTRY_PAUSE');
 const bid=num(quote.bid),ask=num(quote.ask),sl=num(plan.sl),entry=num(plan.entry),tp1=num(plan.tp1),tp2=num(plan.tp2),tp3=num(plan.tp3);
 const quoteTime=num(quote.capturedAt);
 if(!finite(bid,ask)||bid<=0||ask<bid||quoteTime===null)need.push('BROKER_QUOTE_REQUIRED');
 else if(quoteTime>now||now-quoteTime>5000)fail.push('STALE_BROKER_QUOTE');
 const fill=sign===1?ask:bid;
 const planValid=sign&&finite(entry,sl,tp1,tp2,tp3)&&(entry-sl)*sign>0&&(tp1-entry)*sign>0&&(tp2-tp1)*sign>0&&(tp3-tp2)*sign>0;
 if(!planValid)fail.push('INVALID_PLAN');
 if(String(plan.sourceTimeframe)!=='10')fail.push('TF10_PLAN_REQUIRED');
 if(planValid&&finite(fill,bid,ask)&&(sign*(tp1-fill)<=0||sign*((sign===1?bid:ask)-sl)<=0))fail.push('TP1_OR_SL_ALREADY_REACHED');
 const tick=num(broker.tickSize),value=num(broker.tickValuePerLot),min=num(broker.volumeMin),max=num(broker.volumeMax),step=num(broker.volumeStep),stops=num(broker.minimumStopDistancePrice);
 const commission=num(broker.commissionRoundtripUsdPerLot),entrySlip=num(broker.entrySlippageReservePrice),exitSlip=num(broker.exitSlippageReservePrice);
 if(!finite(tick,value,min,max,step,stops,commission,entrySlip,exitSlip)||tick<=0||value<=0||min<=0||max<min||step<=0||stops<0||commission<0||entrySlip<0||exitSlip<0)need.push('BROKER_SPEC_AND_COSTS_REQUIRED');
 let lot=num(settings.lotPerLayer??.01),metrics=null;
 if(!finite(lot)||lot<min||lot>max||!nearly(lot/step,Math.round(lot/step)))fail.push('INVALID_LOT');
 if(settings.layers!==undefined&&Number(settings.layers)!==2)fail.push('EXACTLY_TWO_LAYERS_REQUIRED');
 if(!need.length&&planValid){
  const unit=value/tick,worstFill=fill+sign*entrySlip;
  const riskPerLot=(sign*(worstFill-sl)+exitSlip)*unit+commission;
  const rewardPerLot=(sign*(tp1-worstFill)-exitSlip)*unit-commission;
  const grossRewardPerLot=sign*(tp1-fill)*unit;
  const costPerLot=((ask-bid)+entrySlip+exitSlip)*unit+commission;
  const totalLot=lot*2,riskUsd=riskPerLot*totalLot,netRewardUsd=rewardPerLot*totalLot;
  metrics={totalLot,riskUsd,netRewardUsd,netRewardRisk:riskPerLot>0?rewardPerLot/riskPerLot:null,costFraction:grossRewardPerLot>0?costPerLot/grossRewardPerLot:null};
  if(riskPerLot<=0||metrics.netRewardRisk<CONFIG.minNetTp1RewardRisk)fail.push('INSUFFICIENT_NET_REWARD');
  if(metrics.costFraction===null||metrics.costFraction>CONFIG.maxCostFraction)fail.push('COST_TOO_HIGH');
  if(riskUsd>equity*CONFIG.riskPerSetupPct/100+1e-8)fail.push('SETUP_RISK_LIMIT');
  if(openRisk+riskUsd>equity*CONFIG.maxOpenRiskPct/100+1e-8)fail.push('PORTFOLIO_RISK_LIMIT');
  if(sign*((sign===1?bid:ask)-sl)<stops)fail.push('SL_TOO_CLOSE_TO_BROKER_QUOTE');
  if(broker.marginApproved!==true||!nearly(num(broker.marginApprovedTotalLot)??-1,totalLot))need.push('BROKER_MARGIN_APPROVAL_REQUIRED_FOR_THIS_SIZE');
 }
 const ready=!fail.length&&!need.length;
 return {strategy:CONFIG.version,status:ready?'READY':need.length?'WAIT_DATA':'SKIP',sop:x,metrics,reasons:[...new Set([...fail,...need])],
  command:ready?{strategy:CONFIG.version,symbol,side:x.side,layers:2,lotPerLayer:lot,totalLot:lot*2,plan:{entry,sl,tp1,tp2,tp3},ttlMs:CONFIG.commandTtlMs}:null};
}
function managementIntents({state,quote,pineExit={}}){
 if(!state||state.closed)return [];
 const p=state.plan,sign=state.side==='BUY'?1:-1;
 const mark=num(sign===1?quote.bid:quote.ask);if(mark===null||mark<=0)return [];
 const key=suffix=>CONFIG.version+'|'+state.setupKey+'|'+suffix;
 const activeSl=num(state.activeSl)??p.sl;
 if(sign*(mark-activeSl)<=0)return [{key:key('SL'),type:'CLOSE_PERCENT',value:100,reason:'SL_HIT'}];
 if(['EXIT_ALL','EXIT_REMAINING','EXIT_SL'].includes(pineExit.action)&&pineExit.confirmed===true)
  return [{key:key('EXIT_'+pineExit.sourceBarCloseAt),type:'CLOSE_PERCENT',value:100,reason:pineExit.action}];
 const actions=[];
 let stage=sign*(mark-p.tp3)>=0?3:sign*(mark-p.tp2)>=0?2:sign*(mark-p.tp1)>=0?1:0;
 if(stage>(state.lockStage||0))actions.push({key:key('LOCK_'+stage),type:stage===3?'MOVE_SL_TP2':stage===2?'MOVE_SL_TP1':'MOVE_SL_ENTRY',
  value:stage===3?p.tp2:stage===2?p.tp1:null,useActualFillPerTicket:stage===1,stage});
 if(!state.partialDone&&pineExit.action==='CLOSE_50_NOW'&&pineExit.confirmed===true)
  actions.push({key:key('HALF'),type:'CLOSE_PERCENT',value:50,reason:'PINE_PARTIAL'});
 // State is not advanced on intent. Consumer must reconcile successful broker acknowledgements first.
 return actions;
}
function acknowledge(state,intent,{success=false}={}){
 if(!success)return state;
 const expectedPrefix=CONFIG.version+'|'+state.setupKey+'|';
 if(!String(intent.key||'').startsWith(expectedPrefix))return state;
 const next={...state};
 if(intent.stage){
  next.lockStage=Math.max(next.lockStage||0,intent.stage);
  if(intent.value!==null&&num(intent.value)!==null)next.activeSl=intent.value;
  // MOVE_SL_ENTRY actual stop prices must be reconciled from broker positions, not the plan entry.
 }
 if(intent.type==='CLOSE_PERCENT'&&intent.value===50)next.partialDone=true;
 if(intent.type==='CLOSE_PERCENT'&&intent.value===100)next.closed=true;
 return next;
}
module.exports={CONFIG,sop,entryDecision,managementIntents,acknowledge};
