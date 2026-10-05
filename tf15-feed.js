'use strict';
// Pure adapter for the separate TF15 real-time batch; does not register live trading.
function decodeTf15Market(row,batch={},receivedAt=Date.now()) {
 if(batch.feedVersion!=='TF15_REALTIME_V1'||String(batch.timeframe)!=='15'||!Array.isArray(row)||row.length!==67)return null;
 const meta=row[66],hema=row[65];
 if(hema?.version!=='HEMA1545_V1'||meta?.version!=='TF15_ENTRY_EVENT_V1')return null;
 const symbol=String(row[0]||'').toUpperCase(),side=String(row[34]||'').toUpperCase();
 const opened=Number(row[1]),observed=Number(batch.emittedAt),setupAt=Number(meta.setupAt);
 if(!Number.isFinite(opened)||!Number.isFinite(observed)||!Number.isFinite(setupAt)||setupAt<=0||setupAt>opened)return null;
 const confirmed=batch.confirmed===true;
 if(confirmed&&observed<opened+900000)return null;
 const pine={symbol,timeframe:'15',confirmed,feedMode:'REALTIME_ENTRY',entryEvent:meta.entryEvent===true,
  receivedAt,signalObservedAt:observed,sourceBarOpenAt:opened,sourceBarCloseAt:opened+900000,
  setupKey:`TF15|${symbol}|${side}|${setupAt}`,normal3Side:side,normal3Solid:row[35]===true,
  normal3PricePastEntry:row[36]===true,normal3PriceCrossEntry:row[61]===true,normal5Position:row[44],normal5Close:row[45],normal5Hema20:row[46],normal5Hema40:row[47],
  normal3Entry:row[22],normal3Close:row[6],normal3Atr:row[21],normal3Forecast:row[42],normal3MarketPower:row[43],
  hemaConfirmation:hema,chopIndex:row[16]};
 for(let i=1;i<=5;i++)pine['normal3Sop'+i]=row[36+i]===true;
 return {pine,plan:{sourceTimeframe:'15',entry:row[22],sl:row[23],tp1:row[25],tp2:row[26],tp3:row[27]},
  // Intrabar entry snapshots may never trigger candle-close partial/yellow exits.
  pineExit:{confirmed,sourceBarCloseAt:opened+900000,action:confirmed?String(row[49]||'IDLE'):'IDLE',slMoveTriggered:confirmed&&row[59]===true,slMoveAction:confirmed?String(row[58]||'NONE'):'NONE',activeSl:row[24],slLockLabel:row[57]}};
}
module.exports={decodeTf15Market};
