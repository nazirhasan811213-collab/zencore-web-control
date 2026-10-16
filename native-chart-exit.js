'use strict';
// A native chart close applies to the executed strategy, even if chart analysis
// has advanced to another SOLID. Never rebind virtual SL or unrelated actions.
function forActiveSetup(market, latest, positions, mode, now) {
  const s=latest?.payload?.analysisSnapshot, t=market?.signalObservedAt;
  if(market?.nativeChartExitAll!==true||market.feedChannel!=='EXECUTION'||
     market.setupMeta?.entryPolicyVersion!=='PINE_3TRIGGERS_4OF5_V2'||
     latest?.status!=='EXECUTED'||s?.entryPolicyVersion!=='PINE_3TRIGGERS_4OF5_V2'||
     !Number.isFinite(t)||now-t>30000||t>now+5000||
     String(market.timeframe)!==String(s.executionTimeframe)||
     !positions.some(p=>p.origin!=='MANUAL'&&p.symbol===market.symbol&&
       (p.strategyMode||'TF2_SCALPING')===mode)) return market;
  return {...market,setupKey:s.setupKey,
    strategyNormal:{...market.strategyNormal,side:s.side,entrySopVersion:s.analysisSopVersion},
    positionManagement:{action:'EXIT_ALL',reason:'Native chart Close Separuh / Close All'}};
}
module.exports={forActiveSetup};
