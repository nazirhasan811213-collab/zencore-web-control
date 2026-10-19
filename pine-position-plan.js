'use strict';
// Executed MT5 setup identity owns its exit levels, never the newest chart candidate.
const VERSIONS=['NORMAL_20261001_TF3_RIBBON_V1','NORMAL_20261001_TF15_RIBBON_V1'];
const ANCHOR='PINE_SETUP_PLAN_V1';
function valid(command){
 const p=command?.payload,s=p?.analysisSnapshot,sign=p?.side==='BUY'?1:p?.side==='SELL'?-1:0;
 return command?.type==='PLACE_SETUP'&&VERSIONS.includes(s?.analysisSopVersion)&&
  s.exitLockVersion==='PINE_STEPLOCK_150_TP3_PLUS3_V1'&&sign!==0&&
  ['entry','sl','tp1','tp2','tp3'].every(k=>Number.isFinite(p[k])&&p[k]>0&&p[k]===s[k])&&
  sign*(p.entry-p.sl)>0&&sign*(p.tp1-p.entry)>0&&sign*(p.tp2-p.tp1)>0&&sign*(p.tp3-p.tp2)>0;
}
function ownPositions(positions,symbol,mode){return positions.filter(p=>p.origin!=='MANUAL'&&p.symbol===symbol&&(p.strategyMode||'TF2_SCALPING')===mode);}
function matches(command,positions){
 if(!valid(command)||!positions.length)return false;
 const p=command.payload;
 return positions.every(x=>x.setupId===command.id.slice(0,20)&&x.side===p.side&&x.symbol===p.symbol&&(x.strategyMode||'TF2_SCALPING')===p.strategyMode);
}
async function resolve(store,userId,podId,positions,symbol,mode,fallback){
 const own=ownPositions(positions,symbol,mode);
 if(!own.length)return null;
 if(matches(fallback,own)&&fallback.podId===podId&&fallback.userId===userId)return fallback;
 const ids=[...new Set(own.map(p=>p.setupId))];
 if(ids.length!==1||!/^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f])$/.test(ids[0]||'')||typeof store.setupForPosition!=='function')return null;
 const command=await store.setupForPosition(userId,podId,symbol,mode,ids[0]);
 return command?.userId===userId&&command?.podId===podId&&matches(command,own)?command:null;
}
function view(command){
 if(!valid(command))return null;
 const p=command.payload,s=p.analysisSnapshot;
 return {commandId:command.id,setupKey:s.setupKey,cycleKind:s.cycleKind==='FOLLOWUP'?'FOLLOWUP':'INITIAL',entryKind:s.cycleKind==='FOLLOWUP'?'RE-ENTRY':'ENTRY',timeframe:s.executionTimeframe,entry:p.entry,sl:p.sl,tp1:p.tp1,tp2:p.tp2,tp3:p.tp3,exitLockVersion:s.exitLockVersion};
}
function management(market,positions,command,at){
 if(!valid(command))return null;
 const p=command.payload,s=p.analysisSnapshot,own=ownPositions(positions,p.symbol,p.strategyMode),observed=Number(market?.signalObservedAt||market?.receivedAt);
 if(!matches(command,own)||String(market?.timeframe)!==String(s.executionTimeframe)||market.symbol!==p.symbol||!Number.isFinite(observed)||at-observed>30000||observed>at+5000)return null;
 const sign=p.side==='BUY'?1:-1,quotes=own.map(x=>x.currentPrice);
 if(quotes.some(x=>!Number.isFinite(x)||x<=0))return null;
 const quote=sign>0?Math.min(...quotes):Math.max(...quotes),hit=t=>sign*(quote-t)>=0;
 const source=market.positionManagement||{},freshExit=own.every(x=>Number.isFinite(x.openedAt)&&observed>=x.openedAt);
 const chartClose=freshExit&&(market.nativeChartExitAll===true&&market.feedChannel==='EXECUTION'||market.setupKey===s.setupKey&&['CLOSE_50_NOW','EXIT_ALL','EXIT_REMAINING','EXIT_SL'].includes(source.action));
 const pm={action:chartClose?'EXIT_ALL':'HOLD',slMoveTriggered:false,entryAnchor:ANCHOR,entryCommandId:command.id,reason:chartClose?'Chart Close → CLOSE ALL setup aktif':'Exit ikut pelan '+(s.cycleKind==='FOLLOWUP'?'RE-ENTRY':'ENTRY')};
 let target=null,label='INITIAL';
 if(sign*(quote-p.tp3)>3){target=p.tp3;label='TP3_LOCKED';}
 else if(hit(p.tp3)){target=p.tp2;label='TP2_LOCKED';}
 else if(hit(p.tp2)){target=p.tp1;label='TP1_LOCKED';}
 else if(hit(p.tp1)&&sign*(quote-p.entry)>1.50){target=p.entry+sign*1.50;label='ENTRY_PLUS_150';}
 if(!chartClose&&target!==null&&own.some(x=>!Number.isFinite(x.activeSl)||x.activeSl<=0||sign*(target-x.activeSl)>0.000001))Object.assign(pm,{slMoveTriggered:true,slMoveAction:'MOVE_SL_TP1',activeSl:target,slLockLabel:label});
 return {...market,setupKey:s.setupKey,strategyNormal:{...market.strategyNormal,side:p.side,entrySopVersion:s.analysisSopVersion,plan:{entry:p.entry,sl:p.sl,tp1:p.tp1,tp2:p.tp2,tp3:p.tp3}},positionManagement:pm};
}
module.exports={ANCHOR,valid,matches,ownPositions,resolve,view,management};
