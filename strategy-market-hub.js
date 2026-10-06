
'use strict';
const {decodeTf15Market}=require('./tf15-feed');
const {evaluateEntrySop}=require('./normal-entry-sop');
const entries=new Map();
const MarketRetention=require('./market-retention');
const retentionTimer=setInterval(()=>{for(const [symbol,m] of entries)if(!MarketRetention.retained(m))entries.delete(symbol);},60000);retentionTimer.unref?.();
const setupTracker=require('./entry-setup-state').createEntrySetupTracker();
function ingest(batch,at=Date.now()) {
 const touched=[];
 if(batch?.feedVersion!=='TF15_REALTIME_V1'||!Array.isArray(batch.markets))return touched;
 for(const row of batch.markets){
  const decoded=decodeTf15Market(row,batch,at);if(!decoded)continue;
  const {pine,plan,pineExit}=decoded;if(!['XAUUSD','GBPUSD','GBPJPY'].includes(pine.symbol))continue;
  const prev=entries.get(pine.symbol);if(prev&&(pine.sourceBarOpenAt<prev.sourceBarTime||pine.signalObservedAt<prev.signalObservedAt))continue;
  const tracked=setupTracker.update(pine);
  const x=evaluateEntrySop(tracked,'15');
  const sign=x.side==='BUY'?1:-1,within=sign*(plan.tp1-pine.normal3Close)>0&&sign*(pine.normal3Close-plan.sl)>0;
  const ready=(x.sequential?x.solid:pine.entryEvent)&&x.standardReady&&within;
  const market={symbol:pine.symbol,timeframe:'15',receivedAt:at,sourceBarTime:pine.sourceBarOpenAt,signalObservedAt:pine.signalObservedAt,
   setupKey:pine.setupKey,price:pine.normal3Close,freshness:'LIVE',feedMode:pine.confirmed?'BAR-CLOSE':'INTRABAR',
   strategyNormal:{tf:'15m',side:x.side,state:ready?'READY':'WATCH',solid:x.solid,pullback:x.pullback,triggerPolicy:'SOLID_LATCH_CURRENT_CONFIRMATIONS',entrySopVersion:x.version,
    reason:ready?'SOLID TF15 dipegang + pengesahan semasa lulus':x.pullback?.state==='WAIT_PULLBACK'?'WAIT PULLBACK 40% candle besar':!within&&x.solid?'Harga di luar julat Entry–TP1; tunggu pullback':'Tunggu: '+x.gates.filter(g=>!g.pass).map(g=>g.label).join(' • '),plan,
    sop:{pullback:x.pullback,gates:x.gates,sopGreen:x.green,forecast:x.forecast,marketPower:x.power,m5Position:pine.normal5Position,m5Pass:x.m5Pass,pricePastEntry:x.pricePast,hema15:x.hema15,hema30:x.hema30}},
   positionManagement:{action:pineExit.action,reason:'TF15 confirmed exit',slMoveTriggered:pineExit.slMoveTriggered,slMoveAction:pineExit.slMoveAction,activeSl:pineExit.activeSl,slLockLabel:pineExit.slLockLabel}};
  entries.set(pine.symbol,market);touched.push(market);
 }
 return touched;
}
function markets(){return [...entries.values()];}
module.exports={ingest,markets};
