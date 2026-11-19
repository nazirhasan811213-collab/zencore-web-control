(() => {
 'use strict';
 const $=id=>document.getElementById(id),symbols=['XAUUSD','BTCUSD'];
 let payload=null,failed=false,filter='both',stopped=false,streams=[],pushedViews=new Map();
 const Live=window.ZenCoreDashboardLive,activity=[],activityState=new Map(),cardsBySymbol=new Map();
 const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
 const format=(v,symbol)=>v==null||v===''||!Number.isFinite(Number(v))?'—':Number(v).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:symbol==='XAUUSD'?3:2});
 const link=(symbol,tf)=>'/analysis?pair='+encodeURIComponent(symbol)+'&tf='+tf;
 function fresh(v){return !failed&&Live.fresh(v);}
 function ready(v){const observed=Number(v.market?.signalObservedAt);return fresh(v)&&v.entryReady&&Number.isFinite(observed)&&Date.now()-observed<=30000;}
 function state(v){return !fresh(v)?'WAITING':ready(v)?'SOLID '+v.market.strategyNormal.side:v.displayState==='READY'?'WAIT CONFIRMATION':(v.displayState||v.market?.strategyNormal?.state||'WATCH').replaceAll('_',' ');}
 function tone(v){return ready(v)?v.market.strategyNormal.side==='BUY'?'buy':'sell':'';}
 function dot(id,live){$(id).classList.toggle('live',live);}
 async function api(path){const r=await fetch(path,{credentials:'same-origin',cache:'no-store',headers:{Accept:'application/json'},signal:AbortSignal.timeout(8000)});if(r.status===401){stopped=true;location.replace('/login');throw Error('SESSION');}if(!r.ok)throw Error('UNAVAILABLE');return r.json();}
 function views(){
  return symbols.flatMap(symbol=>[2,15].map(timeframe=>{
   const view=payload?.pairs?.find(p=>p.symbol===symbol)?.views?.find(v=>Number(v.timeframe)===timeframe);
   const pushed=pushedViews.get(symbol)?.find(v=>Number(v.timeframe)===timeframe);
   return {...(Live.latestView(view,pushed)||{timeframe,status:'WAITING',displayState:'WAITING',market:null}),symbol,timeframe};
  }));
 }
 function quotesFor(symbol){
  return [...(failed?[]:views().filter(v=>v.symbol===symbol)),...(pushedViews.get(symbol)||[])].filter(v=>v.market?.symbol===symbol);
 }
 for(const symbol of symbols){
  const card=$('pairCardTemplate').content.firstElementChild.cloneNode(true);
  card.dataset.pair=symbol;
  const fields=Object.fromEntries([...card.querySelectorAll('[data-field]')].map(node=>[node.dataset.field,node]));
  fields.symbol.textContent=symbol;
  fields.name.textContent=symbol==='XAUUSD'?'Gold':'Bitcoin';
  fields.timeframe.setAttribute('aria-label','Timeframe pelan '+symbol);
  fields.timeframe.onchange=render;
  cardsBySymbol.set(symbol,{fields,tape:Live.createTape()});
  $('pairCards').append(card);
 }
 const marketRows=new Map();
 for(const symbol of symbols)for(const timeframe of [2,15]){
  const row=el('details',undefined,'compact-market-row'),summary=el('summary');
  const pair=el('span',symbol,'compact-market-pair');
  pair.append(el('small','TF'+timeframe));
  const status=el('span',undefined,'compact-market-state');
  const metrics=el('span',undefined,'compact-market-metrics');
  summary.append(pair,status,metrics);
  const body=el('div',undefined,'compact-market-body');
  const message=el('p','Butiran tersedia apabila data Pine segar.');
  const readings=el('dl',undefined,'compact-market-readings');
  const values=['Keadaan market','Panduan ZenCore','Rumusan AI','Nasihat'].map(label=>{
   const item=el('div'),value=el('dd');
   item.append(el('dt',label),value);readings.append(item);return value;
  });
  const analysis=el('a','Analisis penuh →');
  analysis.href=link(symbol,timeframe);
  body.append(message,readings,analysis);row.append(summary,body);
  $('marketGrid').append(row);
  marketRows.set(symbol+'|'+timeframe,{row,status,metrics,message,readings,values});
 }
 const dashboardCharts=new Map();
 let chartTf=2;
 function selectChart(){
  const symbol=$('chartPair').value;
  for(const pair of symbols)for(const tf of [2,15]){
   const host=$(pair==='XAUUSD'?'dashboardChart'+tf:'dashboardBitcoinChart'+tf);
   const key=pair+'|'+tf;
   host.hidden=pair!==symbol||tf!==chartTf;
   if(pair===symbol&&!dashboardCharts.has(key))dashboardCharts.set(key,window.ZenCoreIndicatorChart?.mount(host,tf,pair));
  }
  renderLive();
  dashboardCharts.get(symbol+'|'+chartTf)?.resize();
 }
 $('chartPair').onchange=selectChart;
 for(const button of document.querySelectorAll('[data-chart-tf]'))button.onclick=()=>{
  chartTf=Number(button.dataset.chartTf);
  for(const choice of document.querySelectorAll('[data-chart-tf]'))choice.setAttribute('aria-pressed',String(choice===button));
  selectChart();
 };
 function renderLive(){
  const now=Date.now();
  for(const [symbol,{fields,tape}] of cardsBySymbol){
   const q=Live.quote(quotesFor(symbol),now);
   if(q)tape.push(q);
   const last=tape.points().at(-1);
   fields.price.textContent=format(last?.price,symbol);
   fields.quoteStatus.textContent=q?'FEED LIVE':last?'DATA LAMA':'TUNGGU DATA';
   fields.quoteStatus.classList.toggle('live',!!q);
   const delta=q?last?.delta:null;
   fields.delta.textContent=delta==null?'':(delta>0?'↑ +':delta<0?'↓ −':'')+format(Math.abs(delta),symbol)+' USD';
   fields.delta.className=delta>0?'buy':delta<0?'sell':'';
   fields.source.textContent=last?'Pine TF'+last.timeframe+' · '+new Date(last.at).toLocaleTimeString('en-GB',{timeZone:'Asia/Kuala_Lumpur',hour12:false})+' MYT':'Menunggu data Pine';
  }
  const chartSymbol=$('chartPair').value;
  const latest=quotesFor(chartSymbol).filter(v=>Number(v.timeframe)===chartTf).sort((a,b)=>Number(b.market.signalObservedAt||b.market.receivedAt)-Number(a.market.signalObservedAt||a.market.receivedAt))[0];
  dashboardCharts.get(chartSymbol+'|'+chartTf)?.update(latest?.market||null,!!latest&&Live.fresh(latest));
  const all=views();
  document.dispatchEvent(new CustomEvent('zencore:dashboard',{detail:{views:all.filter(v=>v.symbol==='XAUUSD'),failed}}));
  $('liveTfSummary').replaceChildren(...all.filter(v=>v.symbol===chartSymbol).map(v=>el('span',chartSymbol+' · TF'+v.timeframe+' · '+state(v),tone(v))));

 }
 function trackActivity(){
  let changed=false;
  for(const v of views()){
   if(!fresh(v))continue;const n=v.market.strategyNormal||{},s=n.sop||{},key=v.symbol+'|'+v.timeframe,fingerprint=[state(v),n.side,s.hemaShape?.state,v.market.positionManagement?.action].join('|');
   if(activityState.get(key)===fingerprint)continue;activityState.set(key,fingerprint);
   changed=true;activity.unshift({at:Number(v.market.signalObservedAt)||Number(v.market.receivedAt),text:v.symbol+' · TF'+v.timeframe+' · '+state(v)+(s.hemaShape?' · HEMA '+s.hemaShape.state:'')+(!['HOLD','IDLE','NONE'].includes(v.market.positionManagement?.action||'HOLD')?' · ARAHAN PINE '+v.market.positionManagement.action:'')});
  }
  activity.splice(6);if(changed&&activity.length)$('marketActivity').replaceChildren(...activity.map(a=>{const li=el('li');li.append(el('time',new Date(a.at).toLocaleTimeString('en-GB',{timeZone:'Asia/Kuala_Lumpur',hour12:false})+' MYT'),el('span',a.text));return li;}));
 }
 function startLiveStream(){
  if(!window.EventSource)return;
  for(const symbol of symbols){
   const stream=new EventSource('/api/analysis/timeframes/events?symbol='+symbol);
   streams.push(stream);
   stream.addEventListener('timeframes',e=>{try{
    const j=JSON.parse(e.data);
    if(j.ok&&j.symbol===symbol&&Array.isArray(j.views)){
     pushedViews.set(symbol,j.views);render();
    }
   }catch(_){}});
   const disconnected=()=>{pushedViews.delete(symbol);renderLive();};
   stream.addEventListener('unavailable',disconnected);stream.onerror=disconnected;
  }
 }
 function render(){
  renderLive();const all=views();
  const live=all.filter(fresh).length;dot('feedDot',live>0);$('feedState').textContent=failed?'TERPUTUS':live?live+'/'+(symbols.length*2)+' FEED LIVE':'TUNGGU DATA';
  for(const [symbol,{fields}] of cardsBySymbol){
   const tf=Number(fields.timeframe.value),v=all.find(v=>v.symbol===symbol&&v.timeframe===tf);
   const current=fresh(v),available=Live.available(v)&&v.market?.symbol===symbol;
   const n=available?v.market.strategyNormal:null,context=available?Live.context(v):null;
   const plan=n?.plan,assessment=current?v.assessment:null;
   const setup=ready(v)?'Signal '+n?.side:n?.side?'Menunggu entry · '+n.side:'Menunggu setup';
   fields.state.textContent=current?setup:available?'Analisis terakhir · '+context.ageSeconds+'s · '+(n?.side||'Tunggu setup'):'Menunggu data Pine';
   fields.state.className='dashboard-pair-state '+tone(v);
   for(const key of ['entry','sl','tp1','tp2','tp3'])fields[key].textContent=format(plan?.[key],symbol);
   const range=assessment?.range;
   const technicalScore=assessment?.status==='AVAILABLE'&&Number.isFinite(assessment.overall)?assessment.overall:null;
   const score=technicalScore??context?.score;
   const scored=score!==null&&score!==undefined;
   fields.strengthTf.textContent='TF'+tf+(technicalScore===null&&scored?' · Pine':'');
   fields.strengthScore.textContent=scored?score+'%':'—';
   fields.strengthPanel.classList.toggle('has-score',scored);
   fields.strength.textContent=scored
    ?range?'Julat '+format(range.low,symbol)+'–'+format(range.high,symbol):''
    :assessment?.reason||n?.reason||'';
   fields.analysis.href=link(symbol,tf);
  }
  for(const view of all){
   const {symbol,timeframe}=view;
   const {row,status,metrics,message,readings,values}=marketRows.get(symbol+'|'+timeframe);
   row.hidden=filter!=='both'&&String(timeframe)!==filter;
   const m=view.market,n=m?.strategyNormal,levels=view.nearbyLevels||{};
   const current=fresh(view)&&m?.symbol===symbol;
   const context=m?.symbol===symbol?Live.context(view):null,available=!!context;
   const side=available&&['BUY','SELL'].includes(n?.side)?n.side:null;
   status.textContent=available?(side||'Tunggu setup')+(current?'':' · Data terakhir '+context.ageSeconds+'s'):'Tiada data Pine semasa';
   status.className='compact-market-state '+(side==='BUY'?'buy':side==='SELL'?'sell':'');
   message.hidden=available;
   readings.hidden=!available;
   const momentum=context?.momentum;
   const support=format(m?.nearestSupport??levels.supports?.[0],symbol);
   const resistance=format(m?.nearestResistance??levels.resistances?.[0],symbol);
   const facts=[typeof momentum==='string'&&momentum.trim()?momentum:null,support!=='—'?'Support '+support:null,resistance!=='—'?'Resistance '+resistance:null].filter(Boolean);
   metrics.textContent=available?facts.join(' · '):'';
   if(available){
    const data=[context.trend,context.guide,context.summary,context.advice];
    values.forEach((value,index)=>{value.textContent=data[index];});
   }
  }
 }
 for(const button of document.querySelectorAll('[data-tf]'))button.onclick=()=>{filter=button.dataset.tf;document.querySelectorAll('[data-tf]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));render();};
 async function poll(){if(stopped)return;try{payload=await api('/api/trading-cockpit');if(!payload.ok||!Array.isArray(payload.pairs))throw Error('DATA');failed=false;trackActivity();$('feedConnection').textContent='Dikemas kini '+new Date(payload.serverTime).toLocaleTimeString('ms-MY',{timeZone:'Asia/Kuala_Lumpur'})+' MYT';}catch(_){failed=true;$('feedConnection').textContent='Sambungan feed terganggu. Cuba menyambung semula…';}render();if(!stopped)setTimeout(poll,2000);}
 function renderAccount(a){
  const v=Live.accountOverview(a),set=(id,value)=>{if($(id))$(id).textContent=value;};
  set('overviewAccount',v.account);set('overviewServer',v.server);set('overviewPositions',v.count??'—');
  set('overviewModes',v.count===null?'Menunggu laporan MT5':`TF2: ${v.tf2} • TF15: ${v.tf15}`);
  set('overviewLot',v.lot===null?'—':v.lot.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:3}));
  set('overviewFloating',v.floating===null?'—':v.floating.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}));
  set('overviewSeen',v.lastSeen?'Laporan MT5 '+new Date(v.lastSeen).toLocaleTimeString('ms-MY',{timeZone:'Asia/Kuala_Lumpur'})+' MYT':'Data belum disahkan / tidak segar');
 }
 async function connections(){if(stopped)return;const results=await Promise.allSettled([api('/api/auto-trade/state'),api('/api/analysis-alerts/settings'),api('/ready')]);
  if(results[0].status==='fulfilled'){const a=results[0].value;renderAccount(a);$('mt5State').textContent=a.connection?.label||'BELUM CONNECT';dot('mt5Dot',a.connection?.connected===true||a.connection?.state==='CONNECTED');const state=a.control?.effectiveState||'STOPPED';const paused=results[2]?.status==='fulfilled'?results[2].value?.autoEntry?.signalsPaused:null;$('tradeState').textContent=paused===true?'PAUSED':state==='ON'&&paused===null?'ON • SEMAK STATUS':state.replaceAll('_',' ');dot('tradeDot',state==='ON'&&paused===false);}else{renderAccount(null);$('mt5State').textContent='STATUS BELUM ADA';$('tradeState').textContent='STATUS BELUM ADA';dot('mt5Dot',false);dot('tradeDot',false);}
  if(results[1].status==='fulfilled'){const p=results[1].value.settings||{};const enabled=p.verified&&p.telegramEnabled&&p.telegramAvailable;$('telegramState').textContent=enabled?'AKTIF':p.telegramAvailable?'BELUM DIAKTIFKAN':'BELUM ADA';dot('telegramDot',!!enabled);}else{$('telegramState').textContent='STATUS BELUM ADA';dot('telegramDot',false);}if(!stopped)setTimeout(connections,5000);
 }
 api('/auth/me').then(j=>{$('welcomeName').textContent=j.user?.displayName||'Trader';}).catch(()=>{});
 $('logoutButton').onclick=async()=>{$('logoutButton').disabled=true;try{await fetch('/auth/logout',{method:'POST',credentials:'same-origin',headers:{Accept:'application/json'}});}finally{location.replace('/login');}};
 selectChart();render();startLiveStream();poll();connections();const clockTimer=setInterval(render,1000);window.addEventListener('pagehide',()=>{stopped=true;streams.forEach(stream=>stream.close());clearInterval(clockTimer);});
})();

