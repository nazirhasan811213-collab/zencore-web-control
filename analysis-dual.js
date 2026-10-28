(() => {
 'use strict';
 const root=document.getElementById('dualViews'),pair=document.getElementById('pairSelector'),connection=document.getElementById('dualConnection');
 let selected='both',generation=0,controller=null,timer=null,payload=null,failed=false,stream=null,streamLive=false,lastStreamAt=0;
 const cards=new Map();
 const delivery=document.createElement('p');delivery.className='dual-note';delivery.setAttribute('aria-label','Masa penghantaran feed');connection.after(delivery);
 const label=v=>({WAITING:'TUNGGU DATA',WAIT:'TUNGGU',WAIT_DATA:'TUNGGU DATA',STALE:'DATA LAMA',DISCONNECTED:'TERPUTUS',WATCH:'MONITOR DULU',PASS:'LULUS',ABOVE:'DI ATAS',BELOW:'DI BAWAH',INTRABAR:'DALAM CANDLE',BAR_CLOSE:'CANDLE DAH CLOSE'}[v]||v);
 function el(tag,text,className){const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(className)n.className=className;return n;}
 function metric(label,value){const n=el('div',undefined,'metric');n.append(el('small',label),el('b',value));return n;}
 const stageNames={WAIT_SOLID:'TUNGGU SOLID',WAIT_SOP:'TUNGGU SOP',WAIT_PLAN:'TUNGGU PELAN',EVENT_EXPIRED:'EVENT LUPUT',ENTRY_EVENT_READY:'EVENT ENTRY SAH',REENTRY_CANDIDATE:'CALON RE-ENTRY',SOP_COMPLETE:'SOP LENGKAP'};
 const price=v=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v))?Number(v).toFixed(pair.value==='GBPUSD'?5:3):'—';
 for(const tf of [2,15]){
  const card=el('article',undefined,'tf-card');card.dataset.timeframe=String(tf);
  const header=el('header'),title=el('div');title.append(el('span','XAUUSD / HEMA '+(tf===15?'15 · MTF 15/30/45':String(tf)),'eyebrow'),el('h2','TF'+tf+' • '+(tf===15?'Intraday':'Scalping')));
  const badge=el('span','WAITING','feed-pill');header.append(title,badge);
  const content=el('div'),nativeHost=el('div'),actions=el('div',undefined,'zc-chart-actions'),chart=el('div',undefined,'zc-tv-reference');
  const nativeChart=window.ZenCoreIndicatorChart?.mount(nativeHost,tf);
  const chartButton=el('button','Tutup chart ZenCore TF'+tf),referenceButton=el('button','Harga TradingView (rujukan)');chartButton.type=referenceButton.type='button';
  chartButton.setAttribute('aria-pressed','true');referenceButton.setAttribute('aria-pressed','false');
  chartButton.onclick=()=>{nativeHost.hidden=!nativeHost.hidden;chartButton.textContent=(nativeHost.hidden?'Buka':'Tutup')+' chart ZenCore TF'+tf;chartButton.setAttribute('aria-pressed',String(!nativeHost.hidden));nativeChart?.resize();};
  referenceButton.onclick=()=>{if(chart.children.length){chart.replaceChildren();referenceButton.setAttribute('aria-pressed','false');return;}referenceButton.setAttribute('aria-pressed','true');const script=document.createElement('script');script.src='https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';script.async=true;script.textContent=JSON.stringify({autosize:true,symbol:'OANDA:'+pair.value,interval:String(tf),timezone:'Asia/Kuala_Lumpur',theme:'dark',style:'1',locale:'en',allow_symbol_change:false,support_host:'https://www.tradingview.com'});chart.append(el('div',undefined,'tradingview-widget-container__widget'),script);};
  actions.append(chartButton,referenceButton);
  card.append(header,nativeHost,actions,chart,content);root.append(card);cards.set(tf,{card,badge,content,chart,nativeChart});
 }
 function render(){
  for(const tf of [2,15]){
   const c=cards.get(tf);c.card.hidden=selected!=='both'&&selected!==String(tf);
   const view=payload?.views?.find(v=>v.timeframe===tf),m=view?.market,n=m?.strategyNormal||{},s=n.sop||{};
   const age=m?.receivedAt?Math.max(0,Date.now()-m.receivedAt):null;
   const sourceAge=m?.signalObservedAt?Math.max(0,Date.now()-m.signalObservedAt):age;
   const freshnessLimitMs=tf===2?60000:30000;
   const live=!failed&&view?.status==='LIVE'&&age!==null&&age<=freshnessLimitMs&&sourceAge!==null&&sourceAge<=freshnessLimitMs;
   c.nativeChart?.update(m,live);
   c.badge.textContent=label(live?'LIVE':failed?'DISCONNECTED':view?.status==='LIVE'?'STALE':view?.status||'WAITING');c.badge.className='feed-pill'+(live?' live':'');
   const focused=c.content.contains(document.activeElement)?document.activeElement.closest('details')?.dataset.section:null;
   const open=new Set([...c.content.querySelectorAll('details[open]')].map(d=>d.dataset.section));
   const nodes=[el('div',live?(n.state==='READY'?'SOP LENGKAP '+n.side:label(n.state||'WAIT')+' • '+(n.side||'WAIT')):'TUNGGU DATA TF'+tf,'signal'+(live&&n.state==='READY'?' ready '+(n.side==='SELL'?'sell':'buy'):'')),el('p',live?n.reason||'':m?'Ini data terakhir sahaja. Signal tak aktif sampai data fresh masuk.':'Feed TF'+tf+' belum diterima untuk '+pair.value+'.')];
   const metrics=el('div',undefined,'metrics primary-metrics');metrics.append(metric(live?'HARGA XAUUSD':'HARGA TERAKHIR',price(m?.price)),metric('FORECAST • 10 CANDLE',s.forecast||'—'),metric('POWER MARKET',s.marketPower==null?'—':s.marketPower+'%'),metric('SOP HIJAU',s.sopGreen==null?'—':s.sopGreen+'/5'),metric(tf===2?'SOLID CHART TERAKHIR':'SOLID SETUP',tf===2&&s.chartSignal?.present?'SOLID '+s.chartSignal.side:n.solid==null?'—':n.solid?'AKTIF':'BELUM'));nodes.push(metrics);
   if(n.lifecycleState){const stages=el('div',undefined,'metrics');stages.append(metric('STATUS SETUP',stageNames[n.lifecycleState]||n.lifecycleState),metric('SOLID → SOP',s.qualifiedAt&&s.triggerAt?((s.qualifiedAt-s.triggerAt)/1000).toFixed(1)+'s':'BELUM LENGKAP'),metric('STATUS ORDER','SEMAK AKTIVITI AUTO TRADE'));nodes.push(stages);}
   if(tf===2&&s.chartSignal?.present){const signal=s.chartSignal;nodes.push(el('p','SOLID '+signal.side+' pada chart · '+new Date(signal.triggeredAt).toLocaleTimeString('ms-MY',{timeZone:'Asia/Kuala_Lumpur'})+' MYT · '+(live&&signal.current?(signal.held?'SOLID dipegang hingga ribbon bertentangan / CLOSE ALL':'signal baru diterima'):'rekod signal terakhir')+'. Status order: '+(live&&n.state==='READY'?'LAYAK':(signal.held&&signal.current?'TUNGGU SOP LENGKAP':'BELUM LAYAK / TUNGGU SIGNAL BARU'))+'.','chart-solid-note'));}
   if(n.entrySopVersion==='NORMAL_20261001_TF2_SOLID_80PCT_V12'){const q=el('div',undefined,'metrics');q.append(metric('KELENGKAPAN SOP',s.passed+'/6 · '+Number(s.scorePercent).toFixed(2)+'%'),metric('HEMA40 WAJIB',s.hema40?'LULUS':'BATAL'),metric('MTF SCORE',s.mtfScore??'—'));nodes.push(q,el('p','80% ialah kelengkapan SOP, bukan win rate. Tiada tunggu candle berikutnya.'));}
   const advisor=s.advisor||m?.dashboard;nodes.push(window.ZenCorePineInsights.card({tf,advisor,live,observedAt:m?.signalObservedAt||m?.receivedAt,expanded:open.has('pine-coach-'+tf)}));
   nodes.push(el('h3',s.hema2?.state==='ABOVE'||s.hema2?.state==='BELOW'||s.hema2?.state==='INSIDE'?'Harga vs HEMA':'Arah HEMA'));const hema=el('div',undefined,'hema');for(const h of tf===15&&n.entrySopVersion!=='NORMAL_20261001_TF15_RIBBON_V1'?[15,30]:[tf])hema.append(metric('HEMA TF'+(h===2&&n.entrySopVersion?.includes('SEP24')?5:h),label(s['hema'+h]?.state||s['hema'+h]?.mode||'WAIT_DATA')));nodes.push(hema);
   if(s.hemaShape)nodes.push(el('div','Bentuk HEMA: '+s.hemaShape.state+(live&&s.hemaShape.pass?' • LULUS':''),'hema-shape'+(live&&s.hemaShape.pass?' pass':'')));
   nodes.push(el('h3',(live?'Plan trade':'Plan terakhir')+' • '+(n.side||'WAIT')+(!live&&m?' • DATA LAMA':'')));
   const levels=el('div',undefined,'levels');for(const [k,name] of [['entry','ENTRY'],['sl','SL'],['tp1','TP1'],['tp2','TP2'],['tp3','TP3']])levels.append(metric(name,price(n.plan?.[k])));nodes.push(levels);
   function disclosure(key,title,content){const d=el('details',undefined,'inspection');d.dataset.section=key;d.open=open.has(key);d.append(el('summary',title),content);return d;}
   const gates=el('div');if(!s.gates?.length)gates.append(el('p','Tunggu data checklist masuk dulu.'));else for(const g of s.gates){const row=el('div',undefined,'gate');row.append(el('span',g.label),el('b',(live?(g.pass?'✓ ':'○ '):'DATA LAMA • ')+(g.detail||(g.pass?'LULUS':'TUNGGU')),live&&g.pass?'pass':'fail'));gates.append(row);}
   nodes.push(disclosure('sop','Checklist SOP · '+(live&&s.gates?.length?s.gates.filter(g=>g.pass).length+'/'+s.gates.length+' lulus':'menunggu data'),gates));
   const technical=el('div',undefined,'metrics secondary-metrics');technical.append(metric('UMUR DATA PINE',sourceAge==null?'—':(sourceAge/1000).toFixed(1)+'s'),metric('DELAY DATA',view?.transportLagMs==null?'—':(view.transportLagMs/1000).toFixed(2)+'s'),metric('DATA',label(m?.feedMode||'—')),metric('ARAHAN MANAGE POSISI',m?.positionManagement?.action||'—'),metric('SL SEMASA',price(m?.positionManagement?.activeSl)),metric('SL LOCK',m?.positionManagement?.slLockLabel||'—'));
   if(s.pullback)technical.append(metric('CANDLE BESAR',s.pullback.required?'YA':'TIDAK'),metric('PULLBACK',s.pullback.required?(s.pullback.fraction==null?'—':Math.max(0,s.pullback.fraction*100).toFixed(1)+'% / 40%'):s.pullback.state),metric('PARAS PULLBACK',price(s.pullback.level)));
   nodes.push(disclosure('details','Manage posisi & info data',technical));
   nodes.push(el('p',m?'Diterima '+new Date(m.receivedAt).toLocaleTimeString('ms-MY',{timeZone:'Asia/Kuala_Lumpur'})+' MYT':'Tiada data • TF'+tf,'stamp'));c.content.replaceChildren(...nodes);if(focused)c.content.querySelector('details[data-section="'+focused+'"] summary')?.focus({preventScroll:true});
  }
  root.classList.toggle('single',selected!=='both');
  const lags=[2,15].map(tf=>{const lag=payload?.views?.find(v=>v.timeframe===tf)?.transportLagMs;return 'TF'+tf+' '+(Number.isFinite(lag)?(lag/1000).toFixed(2)+'s':'—');});
  delivery.textContent='Pine → server: '+lags.join(' · ')+'. Laman semak semula setiap 5s. Masa ini tidak termasuk sela antara alert Pine.';
 }
 for(const button of document.querySelectorAll('[data-view]'))button.onclick=()=>{selected=button.dataset.view;document.querySelectorAll('[data-view]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));render();};
 function acceptPayload(j){
  if(!j.ok||j.symbol!==pair.value||!Array.isArray(j.views))throw new Error('INVALID_RESPONSE');
  if(payload?.symbol===j.symbol){
   j.views=j.views.map(v=>{const old=payload.views?.find(x=>x.timeframe===v.timeframe);const a=old?.market,b=v.market;
    return a&&Date.now()-Number(a.receivedAt)<=18000000&&(!b||Number(b.receivedAt)<Number(a.receivedAt)||Number(b.signalObservedAt)>0&&Number(a.signalObservedAt)>0&&Number(b.signalObservedAt)<Number(a.signalObservedAt))?old:v;});
  }
  payload=j;failed=false;
 }
 function startStream(){
  const g=generation;stream?.close();streamLive=false;
  if(!window.EventSource)return;
  const active=new EventSource('/api/analysis/timeframes/events?symbol='+encodeURIComponent(pair.value));stream=active;
  active.addEventListener('timeframes',e=>{if(g!==generation)return;try{acceptPayload(JSON.parse(e.data));streamLive=true;lastStreamAt=Date.now();clearTimeout(timer);connection.textContent='Push aktif • semak semula setiap 5s';render();}catch(_){}});
  active.addEventListener('unavailable',()=>{if(g===generation&&!controller)poll();});
  active.onerror=()=>{if(g!==generation)return;streamLive=false;connection.textContent='Tengah connect balik • masih check data sementara';if(!controller){clearTimeout(timer);poll();}};
 }
 async function poll(){const g=generation;const activeController=new AbortController();controller=activeController;const timeout=setTimeout(()=>activeController.abort(),8000);try{const r=await fetch('/api/analysis/timeframes?symbol='+encodeURIComponent(pair.value),{credentials:'same-origin',cache:'no-store',signal:activeController.signal});if(!r.ok)throw new Error('HTTP '+r.status);const j=await r.json();if(g!==generation)return;acceptPayload(j);connection.textContent=streamLive?'Push aktif • semak semula setiap 5s':'Data TF2 & TF15 • semakan berkala aktif';}catch(e){if(g!==generation)return;if(!streamLive){failed=true;connection.textContent='Feed terputus. Tengah cuba connect balik…';}}finally{clearTimeout(timeout);if(g===generation){controller=null;render();if(!streamLive)timer=setTimeout(poll,1000);}}}
 // Reconcile both TFs every five seconds even when SSE appears healthy.
 // Waiting for the source to become stale adds 30–60s to a missed update.
 function recover(){
  if(document.visibilityState==='hidden'||controller)return;
  clearTimeout(timer);poll();
 }
 function resume(){
  if(document.visibilityState==='hidden')return;
  startStream();clearTimeout(timer);if(!controller)poll();
 }
 const recoveryTimer=setInterval(recover,5000);
 document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')resume();});
 window.addEventListener('online',resume);
 pair.onchange=()=>{generation++;stream?.close();streamLive=false;clearTimeout(timer);controller?.abort();controller=null;payload=null;failed=false;for(const c of cards.values()){c.chart.replaceChildren();c.nativeChart?.clear();}connection.textContent='Menyambung '+pair.value+'…';render();startStream();poll();};
 const params=new URLSearchParams(location.search);if(['XAUUSD'].includes(params.get('pair')))pair.value=params.get('pair');if(['2','15'].includes(params.get('tf'))){selected=params.get('tf');document.querySelectorAll('[data-view]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.view===selected)));}
 render();startStream();poll();setInterval(render,1000);
 window.addEventListener('pagehide',()=>{generation++;clearTimeout(timer);clearInterval(recoveryTimer);controller?.abort();stream?.close();});
})();

