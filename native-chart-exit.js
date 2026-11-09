'use strict';
// A native chart close applies to the executed strategy, even if chart analysis
// has advanced to another SOLID. Never rebind virtual SL or unrelated actions.
function forActiveSetup(market, latest, positions, mode, now) {
  const s=latest?.payload?.analysisSnapshot, t=market?.signalObservedAt;
  const y=market?.setupMeta?.yellowExit,step=Number(market?.timeframe)*60000;
  const yellow=market?.setupMeta?.entryPolicyVersion==='PINE_NATIVE_SOLID_ENTRY_V7'&&y?.version==='BJ_OPPOSITE_YELLOW_V1'&&y.confirmed===true&&market.confirmed===true&&y.barTime===market.time&&[y.fast,y.slow,y.close].every(Number.isFinite)&&t>=y.barTime+step-1000&&t-y.barTime-step<=60000&&(s?.side==='BUY'?y.fast>y.slow&&y.close<y.slow:s?.side==='SELL'&&y.fast<y.slow&&y.close>y.slow);
  if((market?.nativeChartExitAll!==true&&!yellow)||market.feedChannel!=='EXECUTION'||
     !['PINE_3TRIGGERS_4OF5_V2','PINE_3TRIGGERS_3OF4_FORECAST45_V4','PINE_SOLID_3OF4_FORECAST45_V5','PINE_SOLID_PRICE_WT_HEMA_V6','PINE_NATIVE_SOLID_ENTRY_V7','PINE_3TRIGGERS_3OF4_CHOP50_V3'].includes(market.setupMeta?.entryPolicyVersion)||
     latest?.status!=='EXECUTED'||!['PINE_3TRIGGERS_4OF5_V2','PINE_3TRIGGERS_3OF4_FORECAST45_V4','PINE_SOLID_3OF4_FORECAST45_V5','PINE_SOLID_PRICE_WT_HEMA_V6','PINE_NATIVE_SOLID_ENTRY_V7','PINE_3TRIGGERS_3OF4_CHOP50_V3'].includes(s?.entryPolicyVersion)||
     !Number.isFinite(t)||now-t>30000||t>now+5000||
     String(market.timeframe)!==String(s.executionTimeframe)||
     !positions.some(p=>p.origin!=='MANUAL'&&p.symbol===market.symbol&&
       (p.strategyMode||'TF2_SCALPING')===mode)) return market;
  return {...market,setupKey:s.setupKey,
    strategyNormal:{...market.strategyNormal,side:s.side,entrySopVersion:s.analysisSopVersion},
    positionManagement:{action:'EXIT_ALL',reason:yellow?(s.side==='BUY'?'Candle kuning garis merah — CLOSE ALL BUY':'Candle kuning garis hijau — CLOSE ALL SELL'):'Native chart Close Separuh / Close All'}};
}
module.exports={forActiveSetup};
