(() => {
 'use strict';
 const root=document.getElementById('dualViews'),pair=document.getElementById('pairSelector'),connection=document.getElementById('dualConnection');
 let selected='both',generation=0,controller=null,timer=null,payload=null,failed=false;
 const cards=new Map();
 const label=v=>({WAITING:'MENUNGGU DATA',WAIT:'TUNGGU',WAIT_DATA:'MENUNGGU DATA',STALE:'DATA LAMA',DISCONNECTED:'TERPUTUS',WATCH:'PEMERHATIAN',PASS:'LULUS',ABOVE:'DI ATAS',BELOW:'DI BAWAH',INTRABAR:'DALAM CANDLE',BAR_CLOSE:'CANDLE DITUTUP'}[v]||v);
 function el(tag,text,className){const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(className)n.className=className;return n;}
 function metric(label,value){const n=el('div',undefined,'metric');n.append(el('small',label),el('b',value));return n;}
 const price=v=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v))?Number(v).toFixed(pair.value==='GBPUSD'?5:3):'—';
 for(const tf of [2,15]){
  const card=el('article',undefined,'tf-card');card.dataset.timeframe=String(tf);
  const header=el('header'),title=el('div');title.append(el('span','SOP 1/10 + HEMA '+(tf===2?'2 / 3':'15 / 30'),'eyebrow'),el('h2','TF'+tf+' • '+(tf===2?'Scalping':'Intraday')));
  const badge=el('span','WAITING','feed-pill');header.append(title,badge);
  const content=el('div'),chartButton=el('button','Buka chart '+tf+' min'),chart=el('div',undefined,'chart-host');chartButton.type='button';
  chartButton.onclick=()=>{chart.replaceChildren();const script=document.createElement('script');script.src='https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';script.async=true;script.textContent=JSON.stringify({autosize:true,symbol:'OANDA:'+pair.value,interval:String(tf),timezone:'Asia/Kuala_Lumpur',theme:'dark',style:'1',locale:'en',allow_symbol_change:false,support_host:'https://www.tradingview.com'});chart.append(el('div',undefined,'tradingview-widget-container__widget'),script);};
  card.append(header,content,chartButton,chart);root.append(card);cards.set(tf,{card,badge,content,chart});
 }
 function render(){
  for(const tf of [2,15]){
   const c=cards.get(tf);c.card.hidden=selected!=='both'&&selected!==String(tf);
   const view=payload?.views?.find(v=>v.timeframe===tf),m=view?.market,n=m?.strategyNormal||{},s=n.sop||{};
   const age=m?.receivedAt?Math.max(0,Date.now()-m.receivedAt):null;
   const live=!failed&&view?.status==='LIVE'&&age!==null&&age<=30000;
   c.badge.textContent=label(live?'LIVE':failed?'DISCONNECTED':view?.status==='LIVE'?'STALE':view?.status||'WAITING');c.badge.className='feed-pill'+(live?' live':'');
   const nodes=[el('div',live?(n.state==='READY'?'SOLID ENTRY • '+n.side:label(n.state||'WAIT')+' • '+(n.side||'WAIT')):'MENUNGGU FEED TF'+tf,'signal'+(live&&n.state==='READY'?' ready':'')),el('p',live?n.reason||'':m?'Data terakhir sahaja. Signal tidak aktif sehingga feed baharu diterima.':'Feed TF'+tf+' belum diterima untuk '+pair.value+'.')];
   const metrics=el('div',undefined,'metrics');metrics.append(metric('HARGA XAUUSD',price(m?.price)),metric('SOP HIJAU',s.sopGreen==null?'—':s.sopGreen+'/5'),metric('FORECAST • 10 CANDLE',s.forecast||'—'),metric('KEKUATAN MARKET',s.marketPower==null?'—':s.marketPower+'%'),metric('SOLID',n.solid==null?'—':n.solid?'YA':'BELUM'),metric('DATA',label(m?.feedMode||'—')));nodes.push(metrics,el('h3','Pengesahan SOP'));
   const gates=el('div');if(!s.gates?.length)gates.append(el('p','Menunggu checklist daripada feed.'));else for(const g of s.gates){const row=el('div',undefined,'gate');row.append(el('span',g.label),el('b',(g.pass?'✓ ':'○ ')+(g.detail|| (g.pass?'LULUS':'TUNGGU')),g.pass?'pass':'fail'));gates.append(row);}nodes.push(gates);
   if(tf===2&&s.marketRegime)nodes.push(el('p','Market regime: '+(s.marketRegime.pass?'CLEAR':s.marketRegime.reason)+' • CHOP '+(s.marketRegime.chop??'—')));
   nodes.push(el('h3','Kekuatan HEMA'));const hema=el('div',undefined,'hema');hema.append(metric('Harga vs HEMA5',label(s.m5Position||'WAIT_DATA')),metric('Pengesahan HEMA5',s.m5Pass?'LULUS':'TUNGGU'));for(const h of [tf,tf===2?3:30])hema.append(metric('HEMA TF'+h,label(s['hema'+h]?.mode||'WAIT_DATA')));  nodes.push(hema,el('h3','Pelan trade • '+(n.side||'WAIT')));
   const levels=el('div',undefined,'levels');for(const [k,label] of [['entry','ENTRY'],['sl','SL'],['tp1','TP1'],['tp2','TP2'],['tp3','TP3']])levels.append(metric(label,price(n.plan?.[k])));nodes.push(levels,el('h3','Pengurusan posisi'));const management=el('div',undefined,'metrics');management.append(metric('TINDAKAN',m?.positionManagement?.action||'—'),metric('SL SEMASA',price(m?.positionManagement?.activeSl)),metric('SL LOCK',m?.positionManagement?.slLockLabel||'—'));nodes.push(management,el('p',m?'Diterima '+new Date(m.receivedAt).toLocaleString('ms-MY',{timeZone:'Asia/Kuala_Lumpur'})+' MYT • '+Math.floor(age/1000)+'s lalu':'Tiada data • TF'+tf,'stamp'));c.content.replaceChildren(...nodes);
  }
  root.classList.toggle('single',selected!=='both');
 }
 for(const button of document.querySelectorAll('[data-view]'))button.onclick=()=>{selected=button.dataset.view;document.querySelectorAll('[data-view]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));render();};
 async function poll(){const g=generation;const activeController=new AbortController();controller=activeController;const timeout=setTimeout(()=>activeController.abort(),8000);try{const r=await fetch('/api/analysis/timeframes?symbol='+encodeURIComponent(pair.value),{credentials:'same-origin',cache:'no-store',signal:activeController.signal});if(!r.ok)throw new Error('HTTP '+r.status);const j=await r.json();if(g!==generation)return;if(!j.ok||j.symbol!==pair.value||!Array.isArray(j.views))throw new Error('INVALID_RESPONSE');payload=j;failed=false;connection.textContent='Feed berasingan TF2 & TF15 • Kemaskini automatik';}catch(e){if(g!==generation)return;failed=true;connection.textContent='Sambungan feed terputus. Mencuba semula…';}finally{clearTimeout(timeout);if(g===generation){render();timer=setTimeout(poll,1000);}}}
 pair.onchange=()=>{generation++;clearTimeout(timer);controller?.abort();payload=null;failed=false;for(const c of cards.values())c.chart.replaceChildren();connection.textContent='Menyambung '+pair.value+'…';render();poll();};
 const params=new URLSearchParams(location.search);if(['XAUUSD'].includes(params.get('pair')))pair.value=params.get('pair');if(['2','15'].includes(params.get('tf'))){selected=params.get('tf');document.querySelectorAll('[data-view]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.view===selected)));}
 render();poll();setInterval(render,1000);
})();
