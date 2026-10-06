(() => {
 'use strict';
 const root=document.getElementById('dualViews'),pair=document.getElementById('pairSelector'),connection=document.getElementById('dualConnection');
 let selected='both',generation=0,controller=null,timer=null,payload=null,failed=false,stream=null,streamLive=false;
 const cards=new Map();
 const label=v=>({WAITING:'MENUNGGU DATA',WAIT:'TUNGGU',WAIT_DATA:'MENUNGGU DATA',STALE:'DATA LAMA',DISCONNECTED:'TERPUTUS',WATCH:'PEMERHATIAN',PASS:'LULUS',ABOVE:'DI ATAS',BELOW:'DI BAWAH',INTRABAR:'DALAM CANDLE',BAR_CLOSE:'CANDLE DITUTUP'}[v]||v);
 function el(tag,text,className){const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(className)n.className=className;return n;}
 function metric(label,value){const n=el('div',undefined,'metric');n.append(el('small',label),el('b',value));return n;}
 const price=v=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v))?Number(v).toFixed(pair.value==='GBPUSD'?5:3):'—';
 for(const tf of [2,15]){
  const card=el('article',undefined,'tf-card');card.dataset.timeframe=String(tf);
  const header=el('header'),title=el('div');title.append(el('span','XAUUSD / HEMA '(tf===2?'2 / 3':'15 / 30'),'eyebrow'),el('h2','TF'+tf+' • '+(tf===2?'Scalping':'Intraday')));
  const badge=el('span','WAITING','feed-pill');header.append(title,badge);
  const content=el('div'),chartButton=el('button','Buka chart '+tf+' min'),chart=el('div',undefined,'chart-host');chartButton.type='button';
  chartButton.onclick=()=>{if(chart.children.length){chart.replaceChildren();chartButton.textContent='Buka chart '+tf+' min';return;}chartButton.textContent='Tutup chart '+tf+' min';const script=document.createElement('script');script.src='https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';script.async=true;script.textContent=JSON.stringify({autosize:true,symbol:'OANDA:'+pair.value,interval:String(tf),timezone:'Asia/Kuala_Lumpur',theme:'dark',style:'1',locale:'en',allow_symbol_change:false,support_host:'https://www.tradingview.com'});chart.append(el('div',undefined,'tradingview-widget-container__widget'),script);};
  card.append(header,content,chartButton,chart);root.append(card);cards.set(tf,{card,badge,content,chart});
 }
 function render(){
  for(const tf of [2,15]){
   const c=cards.get(tf);c.card.hidden=selected!=='both'&&selected!==String(tf);
   const view=payload?.views?.find(v=>v.timeframe===tf),m=view?.market,n=m?.strategyNormal||{},s=n.sop||{};
   const age=m?.receivedAt?Math.max(0,Date.now()-m.receivedAt):null;
   const sourceAge=m?.signalObservedAt?Math.max(0,Date.now()-m.signalObservedAt):age;
   const live=!failed&&view?.status==='LIVE'&&age!==null&&age<=30000&&sourceAge!==null&&sourceAge<=30000;
   c.badge.textContent=label(live?'LIVE':failed?'DISCONNECTED':view?.status==='LIVE'?'STALE':view?.status||'WAITING');c.badge.className='feed-pill'+(live?' live':'');
   const focused=c.content.contains(document.activeElement)?document.activeElement.closest('details')?.dataset.section:null;
   const open=new Set([...c.content.querySelectorAll('details[open]')].map(d=>d.dataset.section));
   const nodes=[el('div',live?(n.state==='READY'?'SOLID '+n.side:label(n.state||'WAIT')+' • '+(n.side||'WAIT')):'MENUNGGU FEED TF'+tf,'signal'+(live&&n.state==='READY'?' ready '+(n.side==='SELL'?'sell':'buy'):'')),el('p',live?n.reason||'':m?'Data terakhir sahaja. Signal tidak aktif sehingga feed baharu diterima.':'Feed TF'+tf+' belum diterima untuk '+pair.value+'.')];
   const metrics=el('div',undefined,'metrics primary-metrics');metrics.append(metric(live?'HARGA XAUUSD':'HARGA TERAKHIR',price(m?.price)),metric('FORECAST • 10 CANDLE',s.forecast||'—'),metric('KEKUATAN MARKET',s.marketPower==null?'—':s.marketPower+'%'),metric('SOP HIJAU',s.sopGreen==null?'—':s.sopGreen+'/5'),metric('SOLID SETUP',n.solid==null?'—':n.solid?'AKTIF':'BELUM'));nodes.push(metrics);
   nodes.push(el('h3','Arah HEMA'));const hema=el('div',undefined,'hema');for(const h of [tf,tf===2?3:30])hema.append(metric('HEMA TF'+h,label(s['hema'+h]?.mode||'WAIT_DATA')));nodes.push(hema);
   if(s.hemaShape)nodes.push(el('div','Bentuk HEMA: '+s.hemaShape.state+(live&&s.hemaShape.pass?' • LULUS':''),'hema-shape'+(live&&s.hemaShape.pass?' pass':'')));
   nodes.push(el('h3',(live?'Pelan trade':'Pelan terakhir')+' • '+(n.side||'WAIT')+(!live&&m?' • DATA LAMA':'')));
   const levels=el('div',undefined,'levels');for(const [k,name] of [['entry','ENTRY'],['sl','SL'],['tp1','TP1'],['tp2','TP2'],['tp3','TP3']])levels.append(metric(name,price(n.plan?.[k])));nodes.push(levels);
   function disclosure(key,title,content){const d=el('details',undefined,'inspection');d.dataset.section=key;d.open=open.has(key);d.append(el('summary',title),content);return d;}
   const gates=el('div');if(!s.gates?.length)gates.append(el('p','Menunggu checklist daripada feed.'));else for(const g of s.gates){const row=el('div',undefined,'gate');row.append(el('span',g.label),el('b',(live?(g.pass?'✓ ':'○ '):'DATA LAMA • ')+(g.detail||(g.pass?'LULUS':'TUNGGU')),live&&g.pass?'pass':'fail'));gates.append(row);}
   nodes.push(disclosure('sop','Checklist SOP · '+(live&&s.gates?.length?s.gates.filter(g=>g.pass).length+'/'+s.gates.length+' lulus':'menunggu data'),gates));
   const technical=el('div',undefined,'metrics secondary-metrics');technical.append(metric('USIA DATA PINE',sourceAge==null?'—':(sourceAge/1000).toFixed(1)+'s'),metric('MASA PENGHANTARAN',view?.transportLagMs==null?'—':(view.transportLagMs/1000).toFixed(2)+'s'),metric('DATA',label(m?.feedMode||'—')),metric('TINDAKAN POSISI',m?.positionManagement?.action||'—'),metric('SL SEMASA',price(m?.positionManagement?.activeSl)),metric('SL LOCK',m?.positionManagement?.slLockLabel||'—'));
   if(s.pullback)technical.append(metric('CANDLE BESAR',s.pullback.required?'YA':'TIDAK'),metric('PULLBACK',s.pullback.required?(s.pullback.fraction==null?'—':Math.max(0,s.pullback.fraction*100).toFixed(1)+'% / 40%'):s.pullback.state),metric('PARAS PULLBACK',price(s.pullback.level)));
   nodes.push(disclosure('details','Pengurusan posisi & data feed',technical));
   nodes.push(el('p',m?'Diterima '+new Date(m.receivedAt).toLocaleTimeString('ms-MY',{timeZone:'Asia/Kuala_Lumpur'})+' MYT':'Tiada data • TF'+tf,'stamp'));c.content.replaceChildren(...nodes);if(focused)c.content.querySelector('details[data-section="'+focused+'"] summary')?.focus({preventScroll:true});
  }
  root.classList.toggle('single',selected!=='both');
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
  active.addEventListener('timeframes',e=>{if(g!==generation)return;try{acceptPayload(JSON.parse(e.data));streamLive=true;clearTimeout(timer);connection.textContent='Feed push TF2 & TF15 • Sambungan aktif';render();}catch(_){}});
  active.addEventListener('unavailable',()=>{if(g===generation&&!controller)poll();});
  active.onerror=()=>{if(g!==generation)return;streamLive=false;connection.textContent='Menyambung semula feed push • polling aktif';if(!controller){clearTimeout(timer);poll();}};
 }
 async function poll(){const g=generation;const activeController=new AbortController();controller=activeController;const timeout=setTimeout(()=>activeController.abort(),8000);try{const r=await fetch('/api/analysis/timeframes?symbol='+encodeURIComponent(pair.value),{credentials:'same-origin',cache:'no-store',signal:activeController.signal});if(!r.ok)throw new Error('HTTP '+r.status);const j=await r.json();if(g!==generation)return;acceptPayload(j);connection.textContent=streamLive?'Feed push TF2 & TF15 • Sambungan aktif':'Feed TF2 & TF15 • Polling sementara';}catch(e){if(g!==generation)return;if(!streamLive){failed=true;connection.textContent='Sambungan feed terputus. Mencuba semula…';}}finally{clearTimeout(timeout);if(g===generation){controller=null;render();if(!streamLive)timer=setTimeout(poll,1000);}}}
 pair.onchange=()=>{generation++;stream?.close();streamLive=false;clearTimeout(timer);controller?.abort();controller=null;payload=null;failed=false;for(const c of cards.values())c.chart.replaceChildren();connection.textContent='Menyambung '+pair.value+'…';render();startStream();poll();};
 const params=new URLSearchParams(location.search);if(['XAUUSD'].includes(params.get('pair')))pair.value=params.get('pair');if(['2','15'].includes(params.get('tf'))){selected=params.get('tf');document.querySelectorAll('[data-view]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.view===selected)));}
 render();startStream();poll();setInterval(render,1000);
 window.addEventListener('pagehide',()=>{generation++;clearTimeout(timer);controller?.abort();stream?.close();});
})();
