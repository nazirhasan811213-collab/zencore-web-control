'use strict';
const {dualAnalysis}=require('./analysis-dual-model');
const MarketRetention=require('./market-retention');
// Market events push directly to connected analysis clients. Keepalive comments
// never refresh observedAt or make an old chart snapshot appear live.
function openAnalysisStream({req,res,symbol,bus,fetchMarkets,now=Date.now}){
 const markets=new Map();let closed=false;
 function update(items){
  for(const m of items||[]){
   const tf=String(m?.timeframe);if(m?.symbol!==symbol||!['2','15'].includes(tf))continue;
   const old=markets.get(tf);
   if(old&&Number(m.receivedAt)<Number(old.receivedAt))continue;
   if(old&&Number(m.signalObservedAt)>0&&Number(old.signalObservedAt)>0&&Number(m.signalObservedAt)<Number(old.signalObservedAt))continue;
   markets.set(tf,m);
  }
 }
 function send(){if(!closed)res.write('event: timeframes\ndata: '+JSON.stringify(dualAnalysis([...markets.values()],symbol,now()))+'\n\n');}
 function event(m){if(m?.symbol!==symbol)return;update([m]);send();}
 res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache, no-transform','Connection':'keep-alive','X-Accel-Buffering':'no'});
 bus.on('market',event);
 const keepalive=setInterval(()=>{
  if(closed)return;
  let expired=false;for(const [tf,m] of markets)if(!MarketRetention.retained(m,now())){markets.delete(tf);expired=true;}
  if(expired)send();
  res.write(': keepalive\n\n');
 },15000);keepalive.unref?.();
 function close(){if(closed)return;closed=true;clearInterval(keepalive);bus.removeListener('market',event);}
 req.on('close',close);res.on('error',close);
 Promise.resolve().then(fetchMarkets).then(items=>{if(closed)return;update(items);send();}).catch(()=>{if(!closed)res.write('event: unavailable\ndata: {}\n\n');});
 return {close};
}
module.exports={openAnalysisStream};
