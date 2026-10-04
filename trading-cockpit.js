(() => {
 'use strict';
 const $=id=>document.getElementById(id),symbols=['XAUUSD','GBPUSD','GBPJPY'];
 let payload=null,failed=false,filter='both',stopped=false;
 const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
 const format=(v,symbol)=>v==null||v===''||!Number.isFinite(Number(v))?'—':Number(v).toFixed(symbol==='GBPUSD'?5:3);
 const tfName=tf=>tf===2?'SCALPING':'INTRA';
 const link=(symbol,tf)=>'/analysis?pair='+encodeURIComponent(symbol)+'&tf='+tf;
 function fresh(v){return !failed&&v.status==='LIVE'&&Date.now()-Number(v.market?.receivedAt)<=30000;}
 function ready(v){const observed=Number(v.market?.signalObservedAt);return fresh(v)&&v.entryReady&&Number.isFinite(observed)&&Date.now()-observed<=30000;}
 function state(v){return !fresh(v)?'WAITING':ready(v)?'SOLID '+v.market.strategyNormal.side:v.displayState==='READY'?'WAIT CONFIRMATION':v.displayState.replaceAll('_',' ');}
 function tone(v){return ready(v)?v.market.strategyNormal.side==='BUY'?'buy':'sell':'';}
 function dot(id,live){$(id).classList.toggle('live',live);}
 async function api(path){const r=await fetch(path,{credentials:'same-origin',cache:'no-store',headers:{Accept:'application/json'},signal:AbortSignal.timeout(8000)});if(r.status===401){stopped=true;location.replace('/login');throw Error('SESSION');}if(!r.ok)throw Error('UNAVAILABLE');return r.json();}
 function views(){return (payload?.pairs||symbols.map(symbol=>({symbol,views:[2,15].map(timeframe=>({timeframe,status:'WAITING',displayState:'WAITING',market:null}))}))).flatMap(p=>p.views.map(v=>({...v,symbol:p.symbol})));}
 function render(){
  const all=views(),visible=all.filter(v=>filter==='both'||String(v.timeframe)===filter);
  const live=all.filter(fresh).length;dot('feedDot',live>0);$('feedState').textContent=failed?'DISCONNECTED':live?live+'/6 FEED LIVE':'WAITING FEED';
  const ranked=visible.slice().sort((a,b)=>Number(ready(b))-Number(ready(a))||Number(fresh(b))-Number(fresh(a))||Number(b.market?.strategyNormal?.sop?.sopGreen||0)-Number(a.market?.strategyNormal?.sop?.sopGreen||0));
  const best=ranked[0],n=best.market?.strategyNormal||{},s=n.sop||{},p=n.plan||{};
  $('featuredPair').textContent=best.symbol;$('featuredTf').textContent='TF'+best.timeframe+' · '+tfName(best.timeframe);
  $('featuredBadge').textContent=ready(best)?'ENTRY READY':fresh(best)?'WATCHLIST':'WAITING';$('featuredBadge').className='pill'+(ready(best)?' live':'');
  $('featuredSide').textContent=ready(best)?'SOLID '+n.side:fresh(best)?'TUNGGU CONFIRMATION':'TUNGGU SIGNAL';$('featuredSide').className='featured-side '+tone(best);
  $('featuredReason').textContent=fresh(best)?n.reason||'Semak confirmation pada Analysis.':'Feed TF'+best.timeframe+' belum tersedia. Signal akan muncul selepas data segar diterima.';
  const chips=[];chips.push(el('span','SOP '+(s.sopGreen==null?'≥3/5':s.sopGreen+'/5'),s.sopGreen>=3?'pass':''));chips.push(el('span','FORECAST '+(s.forecast||'10 CANDLE')));for(const tf of [best.timeframe,best.timeframe===2?3:45])chips.push(el('span','HEMA'+tf+' '+(s['hema'+tf]?.state||'WAIT'),s['hema'+tf]?.pass?'pass':''));$('featuredChecks').replaceChildren(...chips);
  $('featuredEntry').textContent=format(p.entry,best.symbol);$('featuredTp').textContent=format(p.tp1,best.symbol);$('featuredSl').textContent=format(p.sl,best.symbol);$('featuredLink').href=link(best.symbol,best.timeframe);
  const cards=[];
  for(const symbol of symbols){const card=el('article',undefined,'market-card');const head=el('div',undefined,'market-head');head.append(el('b',symbol),el('small',symbol==='XAUUSD'?'GOLD':'FOREX'));card.append(head);
   for(const v of visible.filter(v=>v.symbol===symbol)){const m=v.market?.strategyNormal||{},sop=m.sop||{},row=el('div',undefined,'market-view'),top=el('div');top.append(el('span','TF'+v.timeframe+' · '+tfName(v.timeframe),'tf-label'),el('strong',state(v),tone(v)));row.append(top,el('p',fresh(v)?'Arah '+(m.side||'WAIT')+' · Harga '+format(v.market.price,symbol):'Menunggu feed TF'+v.timeframe),el('div','SOP '+(sop.sopGreen==null?'—':sop.sopGreen+'/5')+'  ·  Forecast '+(sop.forecast||'—')+'  ·  Power '+(sop.marketPower==null?'—':sop.marketPower+'%'),'readings'));
    const a=el('a','Lihat Analysis TF'+v.timeframe+' ↗');a.href=link(symbol,v.timeframe);row.append(a);card.append(row);
   }cards.push(card);
  }$('marketGrid').replaceChildren(...cards);
  const [symbol,timeframe]=$('planSelector').value.split('|'),v=all.find(x=>x.symbol===symbol&&String(x.timeframe)===timeframe),plan=v.market?.strategyNormal?.plan||{};
  const levels=[];for(const [key,label] of [['entry','ENTRY'],['sl','STOP LOSS'],['tp1','TP1'],['tp2','TP2'],['tp3','TP3']]){const l=el('div',undefined,'level '+(key==='sl'?'stop':key==='entry'?'':'target'));l.append(el('small',label),el('b',format(plan[key],symbol)));levels.push(l);}$('planLevels').replaceChildren(...levels);$('planLink').href=link(symbol,timeframe);
  $('planReason').textContent=!fresh(v)?'Menunggu data segar '+symbol+' TF'+timeframe+'. Paras lama, jika ada, hanya untuk rujukan.':ready(v)?'SOLID '+v.market.strategyNormal.side+' · Semak risiko dan tetapan akaun sebelum execution.':v.market.strategyNormal?.reason||'Setup belum disahkan. Semak checklist dan HEMA.';
 }
 for(const button of document.querySelectorAll('[data-tf]'))button.onclick=()=>{filter=button.dataset.tf;document.querySelectorAll('[data-tf]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));render();};$('planSelector').onchange=render;
 async function poll(){if(stopped)return;try{payload=await api('/api/trading-cockpit');if(!payload.ok||!Array.isArray(payload.pairs))throw Error('DATA');failed=false;$('feedConnection').textContent='Data TF2 & TF15 berasingan · Kemaskini '+new Date(payload.serverTime).toLocaleTimeString('ms-MY',{timeZone:'Asia/Kuala_Lumpur'})+' MYT';}catch(_){failed=true;$('feedConnection').textContent='Feed tidak tersedia. Mencuba semula…';}render();if(!stopped)setTimeout(poll,2000);}
 async function connections(){if(stopped)return;const results=await Promise.allSettled([api('/api/auto-trade/state'),api('/api/analysis-alerts/settings')]);
  if(results[0].status==='fulfilled'){const a=results[0].value;$('mt5State').textContent=a.connection?.label||'BELUM CONNECT';dot('mt5Dot',a.connection?.connected===true||a.connection?.state==='CONNECTED');const state=a.control?.effectiveState||'STOPPED';$('tradeState').textContent=state.replaceAll('_',' ');dot('tradeDot',state==='ON');}else{$('mt5State').textContent='STATUS TIDAK TERSEDIA';$('tradeState').textContent='STATUS TIDAK TERSEDIA';dot('mt5Dot',false);dot('tradeDot',false);}
  if(results[1].status==='fulfilled'){const p=results[1].value.settings||{};const enabled=p.verified&&p.telegramEnabled&&p.telegramAvailable;$('telegramState').textContent=enabled?'AKTIF':p.telegramAvailable?'BELUM DIAKTIFKAN':'TIDAK TERSEDIA';dot('telegramDot',!!enabled);}else{$('telegramState').textContent='STATUS TIDAK TERSEDIA';dot('telegramDot',false);}if(!stopped)setTimeout(connections,5000);
 }
 api('/auth/me').then(j=>{$('welcomeName').textContent=j.user?.displayName||'Trader';}).catch(()=>{});
 $('logoutButton').onclick=async()=>{$('logoutButton').disabled=true;try{await fetch('/auth/logout',{method:'POST',credentials:'same-origin',headers:{Accept:'application/json'}});}finally{location.replace('/login');}};
 render();poll();connections();setInterval(render,1000);window.addEventListener('pagehide',()=>{stopped=true;});
})();
