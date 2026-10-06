(() => {
 'use strict';
 const $=id=>document.getElementById(id),symbols=['XAUUSD'];
 let payload=null,failed=false,filter='both',stopped=false,stream=null,streamLive=false,pushedViews=[];
 const Live=window.ZenCoreDashboardLive,tape=Live.createTape(),activity=[],activityState=new Map();let flashTimer=null;
 const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
 const format=(v,symbol)=>v==null||v===''||!Number.isFinite(Number(v))?'—':Number(v).toFixed(symbol==='GBPUSD'?5:3);
 const tfName=tf=>tf===2?'SCALPING':'INTRADAY';
 const link=(symbol,tf)=>'/analysis?pair='+encodeURIComponent(symbol)+'&tf='+tf;
 function fresh(v){return !failed&&Live.fresh(v);}
 function ready(v){const observed=Number(v.market?.signalObservedAt);return fresh(v)&&v.entryReady&&Number.isFinite(observed)&&Date.now()-observed<=30000;}
 function state(v){return !fresh(v)?'WAITING':ready(v)?'SOLID '+v.market.strategyNormal.side:v.displayState==='READY'?'WAIT CONFIRMATION':v.displayState.replaceAll('_',' ');}
 function tone(v){return ready(v)?v.market.strategyNormal.side==='BUY'?'buy':'sell':'';}
 function dot(id,live){$(id).classList.toggle('live',live);}
 async function api(path){const r=await fetch(path,{credentials:'same-origin',cache:'no-store',headers:{Accept:'application/json'},signal:AbortSignal.timeout(8000)});if(r.status===401){stopped=true;location.replace('/login');throw Error('SESSION');}if(!r.ok)throw Error('UNAVAILABLE');return r.json();}
 function views(){return (payload?.pairs||symbols.map(symbol=>({symbol,views:[2,15].map(timeframe=>({timeframe,status:'WAITING',displayState:'WAITING',market:null}))}))).flatMap(p=>p.views.map(v=>({...v,symbol:p.symbol})));}
 function liveViews(){return [...views(),...(streamLive?pushedViews:[])];}
 function renderLive(){
  const now=Date.now(),q=Live.quote(liveViews().filter(()=>!failed||streamLive),now),last=tape.points().at(-1);
  $('marketClock').textContent=new Date(now).toLocaleTimeString('en-GB',{timeZone:'Asia/Kuala_Lumpur',hour12:false})+' MYT';
  $('liveQuoteStatus').textContent=q?'FEED LIVE':last?'DATA LAMA':'MENUNGGU FEED';$('liveQuoteStatus').classList.toggle('live',!!q);document.querySelector('.live-market').classList.toggle('is-live',!!q);
  if(q){
   const point=tape.push(q);if(point){
    $('livePrice').textContent=format(point.price,'XAUUSD');$('livePrice').dataset.direction=point.delta>0?'up':point.delta<0?'down':'flat';
    if(point.delta!==null&&point.delta!==0){$('livePrice').classList.remove('price-flash');void $('livePrice').offsetWidth;$('livePrice').classList.add('price-flash');clearTimeout(flashTimer);flashTimer=setTimeout(()=>$('livePrice').classList.remove('price-flash'),900);}
    $('liveDelta').textContent=point.delta===null?'Kemas kini pertama diterima.':(point.delta>0?'↑ +':point.delta<0?'↓ −':'→ ')+Math.abs(point.delta).toFixed(3)+' USD / kemas kini';
    $('liveDelta').className=point.delta>0?'buy':point.delta<0?'sell':'';
    const points=tape.points();$('priceLine').setAttribute('d',Live.sparkline(points));$('liveSampleCount').textContent=points.length+' kemas kini';$('traceNote').textContent=points.length<2?'Menunggu kemas kini kedua untuk graf.':'Kemas kini feed sejak dashboard dibuka · '+new Date(points[0].at).toLocaleTimeString('en-GB',{timeZone:'Asia/Kuala_Lumpur',hour12:false})+' hingga '+new Date(point.at).toLocaleTimeString('en-GB',{timeZone:'Asia/Kuala_Lumpur',hour12:false})+' MYT';
   }
   const observed=Number(q.market.signalObservedAt)||Number(q.market.receivedAt),age=Math.max(0,now-observed);
   $('liveSource').textContent='FEED PINE · TF'+q.timeframe;$('liveAge').textContent='USIA DATA '+(age/1000).toFixed(1)+'s';$('freshnessBar').style.width=Math.max(0,100-age/30000*100)+'%';
   const delta=tape.points().at(-1)?.delta;$('liveNow').textContent=delta===null?'Harga pertama diterima daripada feed.':delta>0?'Harga meningkat berbanding kemas kini sebelumnya.':delta<0?'Harga menurun berbanding kemas kini sebelumnya.':'Harga tidak berubah pada kemas kini terakhir.';
  }else{
   $('liveNow').textContent=last?'Harga terakhir dipaparkan. Tunggu feed segar sebelum menilai setup.':'Menunggu data harga sebenar daripada feed Pine.';$('freshnessBar').style.width='0%';$('liveAge').textContent=last?'USIA DATA '+Math.max(0,(now-last.at)/1000).toFixed(1)+'s':'USIA DATA —';$('liveDelta').textContent=last?'Perubahan harga tidak aktif — data lama.':'Perubahan akan muncul selepas kemas kini kedua.';$('liveDelta').className='';$('livePrice').classList.remove('price-flash');
  }
  document.dispatchEvent(new CustomEvent('zencore:dashboard',{detail:{views:views(),failed}}));
  $('liveTfSummary').replaceChildren(...views().map(v=>el('span','TF'+v.timeframe+' · '+state(v),tone(v))));
 }
 function trackActivity(){
  let changed=false;
  for(const v of views()){
   if(!fresh(v))continue;const n=v.market.strategyNormal||{},s=n.sop||{},key=String(v.timeframe),fingerprint=[state(v),n.side,s.hemaShape?.state,v.market.positionManagement?.action].join('|');
   if(activityState.get(key)===fingerprint)continue;activityState.set(key,fingerprint);
   changed=true;activity.unshift({at:Number(v.market.signalObservedAt)||Number(v.market.receivedAt),text:'TF'+v.timeframe+' · '+state(v)+(s.hemaShape?' · HEMA '+s.hemaShape.state:'')+(!['HOLD','IDLE','NONE'].includes(v.market.positionManagement?.action||'HOLD')?' · ARAHAN PINE '+v.market.positionManagement.action:'')});
  }
  activity.splice(6);if(changed&&activity.length)$('marketActivity').replaceChildren(...activity.map(a=>{const li=el('li');li.append(el('time',new Date(a.at).toLocaleTimeString('en-GB',{timeZone:'Asia/Kuala_Lumpur',hour12:false})+' MYT'),el('span',a.text));return li;}));
 }
 function startLiveStream(){
  if(!window.EventSource)return;
  stream=new EventSource('/api/analysis/timeframes/events?symbol=XAUUSD');
  stream.addEventListener('timeframes',e=>{try{const j=JSON.parse(e.data);if(j.ok&&j.symbol==='XAUUSD'&&Array.isArray(j.views)){pushedViews=j.views;streamLive=true;renderLive();}}catch(_){}});
  stream.addEventListener('unavailable',()=>{streamLive=false;renderLive();});stream.onerror=()=>{streamLive=false;renderLive();};
 }
 function render(){
  renderLive();const all=views(),visible=all.filter(v=>filter==='both'||String(v.timeframe)===filter);
  const live=all.filter(fresh).length;dot('feedDot',live>0);$('feedState').textContent=failed?'TERPUTUS':live?live+'/'+(symbols.length*2)+' FEED LIVE':'MENUNGGU DATA';
  const ranked=visible.slice().sort((a,b)=>Number(ready(b))-Number(ready(a))||Number(fresh(b))-Number(fresh(a))||Number(b.market?.strategyNormal?.sop?.sopGreen||0)-Number(a.market?.strategyNormal?.sop?.sopGreen||0));
  const best=ranked[0],n=best.market?.strategyNormal||{},s=n.sop||{},p=n.plan||{};
  $('featuredPair').textContent=best.symbol;$('featuredTf').textContent='TF'+best.timeframe+' · '+tfName(best.timeframe);
  $('featuredBadge').textContent=ready(best)?'ENTRY READY':fresh(best)?'DALAM PEMERHATIAN':'WAITING';$('featuredBadge').className='pill'+(ready(best)?' live':'');
  $('featuredSide').textContent=ready(best)?'SOLID '+n.side:fresh(best)?'TUNGGU PENGESAHAN':'TUNGGU SIGNAL';$('featuredSide').className='featured-side '+tone(best);
  $('featuredReason').textContent=fresh(best)?n.reason||'Semak confirmation pada Analysis.':'Feed TF'+best.timeframe+' belum tersedia. Signal akan muncul selepas data segar diterima.';
  const chips=[];chips.push(el('span','SOP '+(s.sopGreen==null?'≥4/5':s.sopGreen+'/5'),s.sopGreen>=4?'pass':''));chips.push(el('span','FORECAST '+(s.forecast||'10 CANDLE')));if(s.hemaShape)chips.push(el('span','SHAPE '+s.hemaShape.state,s.hemaShape.pass?'pass':''));for(const h of [best.timeframe,best.timeframe===2?3:30])chips.push(el('span','HEMA'+h+' '+(s['hema'+h]?.mode||'WAIT'),s['hema'+h]?.pass?'pass':''));$('featuredChecks').replaceChildren(...chips);
  $('featuredEntry').textContent=format(p.entry,best.symbol);$('featuredTp').textContent=format(p.tp1,best.symbol);$('featuredSl').textContent=format(p.sl,best.symbol);$('featuredLink').href=link(best.symbol,best.timeframe);
  const cards=[];
  for(const symbol of symbols){const card=el('article',undefined,'market-card');const head=el('div',undefined,'market-head');head.append(el('b',symbol),el('small',symbol==='XAUUSD'?'GOLD':'FOREX'));card.append(head);
   card.classList.toggle('single',visible.filter(v=>v.symbol===symbol).length===1);for(const v of visible.filter(v=>v.symbol===symbol)){const m=v.market?.strategyNormal||{},sop=m.sop||{},row=el('div',undefined,'market-view'),top=el('div');top.append(el('span','TF'+v.timeframe+' · '+tfName(v.timeframe),'tf-label'),el('strong',state(v),tone(v)));row.append(top,el('p',fresh(v)?'Arah '+(m.side||'WAIT')+' · Harga '+format(v.market.price,symbol):'Menunggu feed TF'+v.timeframe),el('div','SOP '+(sop.sopGreen==null?'—':sop.sopGreen+'/5')+'  ·  Forecast '+(sop.forecast||'—')+'  ·  Power '+(sop.marketPower==null?'—':sop.marketPower+'%'),'readings'));
    const a=el('a','Lihat Analysis TF'+v.timeframe+' ↗');a.href=link(symbol,v.timeframe);row.append(a);card.append(row);
   }cards.push(card);
  }$('marketGrid').replaceChildren(...cards);
  const [symbol,timeframe]=$('planSelector').value.split('|'),v=all.find(x=>x.symbol===symbol&&String(x.timeframe)===timeframe),plan=v.market?.strategyNormal?.plan||{};
  const levels=[];for(const [key,label] of [['entry','ENTRY'],['sl','STOP LOSS'],['tp1','TP1'],['tp2','TP2'],['tp3','TP3']]){const l=el('div',undefined,'level '+(key==='sl'?'stop':key==='entry'?'':'target'));l.append(el('small',label),el('b',format(plan[key],symbol)));levels.push(l);}$('planLevels').replaceChildren(...levels);$('planLink').href=link(symbol,timeframe);
  $('planReason').textContent=!fresh(v)?'Menunggu data segar '+symbol+' TF'+timeframe+'. Paras lama, jika ada, hanya untuk rujukan.':ready(v)?'SOLID '+v.market.strategyNormal.side+' · Semak risiko dan tetapan akaun sebelum execution.':v.market.strategyNormal?.reason||'Setup belum disahkan. Semak checklist dan HEMA.';
 }
 for(const button of document.querySelectorAll('[data-tf]'))button.onclick=()=>{filter=button.dataset.tf;document.querySelectorAll('[data-tf]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));render();};$('planSelector').onchange=render;
 async function poll(){if(stopped)return;try{payload=await api('/api/trading-cockpit');if(!payload.ok||!Array.isArray(payload.pairs))throw Error('DATA');failed=false;trackActivity();$('feedConnection').textContent='Data TF2 & TF15 berasingan · Kemaskini '+new Date(payload.serverTime).toLocaleTimeString('ms-MY',{timeZone:'Asia/Kuala_Lumpur'})+' MYT';}catch(_){failed=true;$('feedConnection').textContent='Feed tidak tersedia. Mencuba semula…';}render();if(!stopped)setTimeout(poll,2000);}
 async function connections(){if(stopped)return;const results=await Promise.allSettled([api('/api/auto-trade/state'),api('/api/analysis-alerts/settings')]);
  if(results[0].status==='fulfilled'){const a=results[0].value;$('mt5State').textContent=a.connection?.label||'BELUM CONNECT';dot('mt5Dot',a.connection?.connected===true||a.connection?.state==='CONNECTED');const state=a.control?.effectiveState||'STOPPED';$('tradeState').textContent=state.replaceAll('_',' ');dot('tradeDot',state==='ON');}else{$('mt5State').textContent='STATUS TIDAK TERSEDIA';$('tradeState').textContent='STATUS TIDAK TERSEDIA';dot('mt5Dot',false);dot('tradeDot',false);}
  if(results[1].status==='fulfilled'){const p=results[1].value.settings||{};const enabled=p.verified&&p.telegramEnabled&&p.telegramAvailable;$('telegramState').textContent=enabled?'AKTIF':p.telegramAvailable?'BELUM DIAKTIFKAN':'TIDAK TERSEDIA';dot('telegramDot',!!enabled);}else{$('telegramState').textContent='STATUS TIDAK TERSEDIA';dot('telegramDot',false);}if(!stopped)setTimeout(connections,5000);
 }
 api('/auth/me').then(j=>{$('welcomeName').textContent=j.user?.displayName||'Trader';}).catch(()=>{});
 $('logoutButton').onclick=async()=>{$('logoutButton').disabled=true;try{await fetch('/auth/logout',{method:'POST',credentials:'same-origin',headers:{Accept:'application/json'}});}finally{location.replace('/login');}};
 render();startLiveStream();poll();connections();const clockTimer=setInterval(renderLive,1000);window.addEventListener('pagehide',()=>{stopped=true;stream?.close();clearInterval(clockTimer);clearTimeout(flashTimer);});
})();
