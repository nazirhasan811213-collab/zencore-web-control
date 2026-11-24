(() => {
 'use strict';
 const $=id=>document.getElementById(id),symbols=['XAUUSD','BTCUSD'];
 let payload=null,failed=false,stopped=false,streams=[],pushedViews=new Map();
 const Live=window.ZenCoreDashboardLive,activity=[],activityState=new Map(),cardsBySymbol=new Map();
 const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
 const format=(v,symbol)=>v==null||v===''||!Number.isFinite(Number(v))?'—':Number(v).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:symbol==='XAUUSD'?3:2});
 const link=(symbol,tf)=>'/analysis?pair='+encodeURIComponent(symbol)+'&tf='+tf;
 const settingsFrame=$('dashboardAutoSettingsFrame');
 let settingsObserver;
 function fitSettingsFrame(){
  settingsObserver?.disconnect();
  const panel=settingsFrame.contentDocument?.querySelector('.dashboard-settings-view .autotrade-shell');
  if(!panel)return;
  const fit=()=>{
   const height=Math.ceil(panel.getBoundingClientRect().height);
   settingsFrame.height=String(height);
  };
  settingsObserver=new ResizeObserver(fit);
  settingsObserver.observe(panel);
  fit();
 }
 settingsFrame?.addEventListener('load',fitSettingsFrame);
 if(settingsFrame?.contentDocument?.readyState==='complete')fitSettingsFrame();
 function fresh(v){return !failed&&Live.fresh(v);}
 function ready(v){const observed=Number(v.market?.signalObservedAt);return fresh(v)&&v.entryReady&&Number.isFinite(observed)&&Date.now()-observed<=30000;}
 function state(v){return !fresh(v)?'WAITING':ready(v)?'SOLID '+v.market.strategyNormal.side:v.displayState==='READY'?'WAIT CONFIRMATION':(v.displayState||v.market?.strategyNormal?.state||'WATCH').replaceAll('_',' ');}
 function tone(v){return ready(v)?v.market.strategyNormal.side==='BUY'?'buy':'sell':'';}
 function dot(id,live){$(id).classList.toggle('live',live);}
 async function api(path,body){
  const options={credentials:'same-origin',cache:'no-store',headers:{Accept:'application/json'},signal:AbortSignal.timeout(8000)};
  if(body){options.method='POST';options.body=JSON.stringify(body);options.headers['Content-Type']='application/json';}
  const r=await fetch(path,options);
  if(r.status===401){stopped=true;location.replace('/login');throw Error('SESSION');}
  if(!r.ok){
   const data=body?await r.json().catch(()=>null):null;
   throw Error(data?.error||'UNAVAILABLE');
  }
  return r.json();
 }
 function views(){
  return symbols.flatMap(symbol=>[1,15].map(timeframe=>{
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
 const dashboardCharts=new Map();
 let chartTf=1;
 function selectChart(){
  const symbol=$('chartPair').value;
  for(const pair of symbols)for(const tf of [1,15]){
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
   const plan=n?.plan,assessment=current?(v.assessment?.status==='AVAILABLE'?v.assessment:v.marketAssessment):null;
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
   fields.analysisSummary.textContent=context?'TF'+tf+' · '+context.summary:'Menunggu bacaan Pine TF'+tf+'.';
   fields.analysisReason.textContent=available?n?.reason||context.guide:'';
   fields.analysis.href=link(symbol,tf);
  }
 }
 async function poll(){if(stopped)return;try{payload=await api('/api/trading-cockpit');if(!payload.ok||!Array.isArray(payload.pairs))throw Error('DATA');failed=false;trackActivity();}catch(_){failed=true;}render();if(!stopped)setTimeout(poll,2000);}
 function renderAccount(a){
  const v=Live.accountOverview(a),set=(id,value)=>{if($(id))$(id).textContent=value;};
  set('overviewAccount',v.account);set('overviewServer',v.server);set('overviewPositions',v.count??'—');
  set('overviewModes',v.count===null?'Menunggu laporan MT5':`TF1: ${v.tf1} • TF15: ${v.tf15}`);
  const snapshotLabel={FRESH:'Snapshot MT5',DELAYED:'Snapshot MT5 · '+v.ageSeconds+'s lalu',
    STALE:'Snapshot MT5 tamat tempoh',UNAVAILABLE:'Status MT5 tidak tersedia',WAITING:'Menunggu snapshot MT5'}[v.snapshotStatus];
  set('overviewLot',v.lot===null?snapshotLabel:v.lot.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:3})+' total lot');
  set('overviewFloating',v.floating===null?'—':'USD '+v.floating.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}));
  set('overviewFloatingSource',snapshotLabel);
  $('quickProfitCard').classList.toggle('profit',v.floating>0);
  $('quickProfitCard').classList.toggle('loss',v.floating<0);
  set('overviewSeen',v.lastSeen?'Laporan terakhir MT5 '+new Date(v.lastSeen).toLocaleTimeString('ms-MY',{timeZone:'Asia/Kuala_Lumpur'})+' MYT':snapshotLabel);
 }
 const quickForm=$('quickOrder'),quickStatus=$('quickStatus'),quickCloseAll=$('quickCloseAll');
 const quickConfirm=$('quickConfirm'),quickConfirmSend=$('quickConfirmSend');
 let quickReady=false,quickPending=false,quickAccount='',closeAllBinding=null,draftOrder=null;
 function draftReady(order){
  if(!order||quickPending||order.accountMask!==quickAccount)return false;
  return order.side==='CLOSE_ALL'?!!closeAllBinding&&order.binding===closeAllBinding:quickReady;
 }
 function updateQuickButtons(){
  quickForm.querySelectorAll('button[type=submit]').forEach(b=>{b.disabled=!quickReady||quickPending;});
  quickCloseAll.disabled=!quickAccount||!closeAllBinding||quickPending;
  quickCloseAll.title=closeAllBinding?'':'Memerlukan sambungan MT5 dan EA / Connector yang menyokong CLOSE ALL.';
  quickConfirmSend.disabled=!draftReady(draftOrder);
 }
 function confirmQuickOrder(order,details){
  if(quickConfirm.open||!draftReady(order))return;
  draftOrder=order;
  $('quickConfirmTitle').textContent=order.side==='CLOSE_ALL'?'Sahkan CLOSE ALL':'Sahkan order MT5';
  $('quickConfirmDetails').textContent=details;
  quickConfirmSend.textContent=order.side==='CLOSE_ALL'?'TUTUP SEMUA POSISI':'HANTAR '+order.side;
  quickConfirmSend.dataset.side=order.side;
  quickConfirm.returnValue='';
  updateQuickButtons();
  quickConfirm.showModal();
 }
 quickForm.addEventListener('submit',e=>{
  e.preventDefault();
  const side=e.submitter?.value,symbol=$('quickPair').value,lot=Number($('quickLot').value);
  if(!['BUY','SELL'].includes(side)||!quickForm.reportValidity())return;
  confirmQuickOrder({side,symbol,lot,accountMask:quickAccount},
   `${side} ${symbol} · ${lot} lot · MT5 ${quickAccount}. SL ikut tetapan Auto Trade.`);
 });
 quickCloseAll.addEventListener('click',()=>{
  confirmQuickOrder({side:'CLOSE_ALL',accountMask:quickAccount,binding:closeAllBinding},
   `Tutup semua posisi terbuka pada MT5 ${quickAccount}, termasuk posisi manual dan Auto Trade. Pending order kekal aktif. Auto Trade boleh membuka posisi baharu.`);
 });
 quickConfirm.addEventListener('close',()=>{
  const order=draftOrder;
  draftOrder=null;
  if(quickConfirm.returnValue!=='send'||!order)return;
  if(!draftReady(order)){
   quickStatus.textContent='Sambungan atau akaun MT5 berubah. Semak dashboard.';
   return;
  }
  submitQuickOrder(order);
 });
 async function submitQuickOrder(order){
  const closing=order.side==='CLOSE_ALL';
  const endpoint=closing?'/api/auto-trade/manual-close-all':'/api/auto-trade/manual-order';
  const payload=closing?{confirmation:'CLOSE_ALL',binding:order.binding}:order;
  quickPending=true;
  updateQuickButtons();
  quickStatus.textContent='Menghantar ke MT5…';
  try{
   const r=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify({...payload,requestId:crypto.randomUUID()}),signal:AbortSignal.timeout(8000)});
   const data=await r.json();
   if(r.status>=500)throw Error('Status penghantaran belum disahkan. Semak MT5 sebelum cuba lagi.');
   if(!r.ok)throw Error(data.error||'Arahan ditolak.');
   const statusUrl='/api/auto-trade/manual-order?id='+encodeURIComponent(data.commandId);
   const deadline=Date.now()+25000;
   quickStatus.textContent='Arahan diterima ZenCore. Menunggu Connector…';
   while(!stopped&&Date.now()<deadline){
    let order;
    try{
     const response=await fetch(statusUrl,{credentials:'same-origin',cache:'no-store',headers:{Accept:'application/json'},signal:AbortSignal.timeout(3500)});
     if(response.status===401||response.status===403||response.status===404){
      quickStatus.textContent='Status order tidak dapat disemak. Semak MT5 sebelum cuba lagi.';
      return;
     }
     if(response.ok)order=await response.json();
    }catch(_){/* A status check can be retried without submitting another order. */}
    if(order?.status==='EXECUTED'){
     quickStatus.textContent=closing
      ?(order.code==='NO_OPEN_POSITIONS'?'Tiada posisi terbuka pada MT5.':'MT5 sahkan semua posisi ditutup.')
      :'MT5 sahkan order dilaksanakan.';
     return;
    }
    if(['FAILED','REJECTED','CANCELLED','CANCELED'].includes(order?.status)){
     quickStatus.textContent=closing
      ?(order.code==='POSITIONS_REMAIN'?'Masih ada posisi terbuka. Semak MT5.':'CLOSE ALL tidak disahkan · '+(order.code||order.status))
      :'Order tidak disahkan: '+(order.code||order.status);
     return;
    }
    if(order?.status==='EXPIRED'){
     quickStatus.textContent='Tempoh arahan tamat tanpa pengesahan MT5. Semak posisi sebelum cuba lagi.';return;
    }
    if(order?.status==='DELIVERED')quickStatus.textContent='Arahan dihantar ke Connector. Menunggu pengesahan MT5…';
    if(!order)quickStatus.textContent='Menyemak semula status order…';
    await new Promise(resolve=>setTimeout(resolve,500));
   }
   quickStatus.textContent='MT5 belum mengesahkan order. Semak posisi sebelum cuba lagi.';
  }catch(error){
   quickStatus.textContent=['TimeoutError','AbortError','TypeError','SyntaxError'].includes(error.name)
    ?'Status penghantaran belum disahkan. Semak MT5 sebelum cuba lagi.':error.message;
  }
  finally{quickPending=false;updateQuickButtons();}
 }
 const autoCard=$('quickAutoTrade'),autoDialog=$('quickAutoDialog');
 const autoOn=$('quickAutoOn'),autoStop=$('quickAutoStop'),autoSend=$('quickAutoSend');
 const autoCancel=$('quickAutoCancel'),autoError=$('quickAutoError'),autoConfirmation=$('quickAutoConfirmation');
 let autoAccount=null,autoAction=null,autoPending=false,autoPaused=false,autoRevision=0;
 function canChangeAuto(action){
  const c=autoAccount?.control,s=c?.effectiveState;
  if(autoPending||autoAccount?.viewerMode||!s)return false;
  return action==='on'?c.canTurnOn===true&&!['ON','ARMING','STOPPING','EMERGENCY_CLOSING'].includes(s):
   !['UNPROVISIONED','STOPPED','STOPPING','EMERGENCY_CLOSING'].includes(s);
 }
 function renderAutoControls(){
  const c=autoAccount?.control,s=c?.effectiveState;
  autoCard.hidden=autoAccount?.viewerMode===true;
  const shown=s==='ON'&&autoPaused?'PAUSED':s;
  autoCard.dataset.state=shown||'';
  $('quickAutoState').textContent=shown?.replaceAll('_',' ')||'SEMAK STATUS';
  $('quickAutoNote').textContent=c?.lastError||({
   ON:c?.canEnter?'Setup READY boleh dihantar ke MT5.':'Entry baharu disekat buat masa ini.',
   PAUSED:'Penghantaran entry sedang dijeda.',
   ARMING:'Menunggu pengesahan ON daripada MT5.',
   STOPPING:'Menunggu pengesahan STOP daripada MT5.',
   STOPPED:'Entry baharu dihentikan.',
   UNPROVISIONED:'Sambungkan akaun MT5 dahulu.'
  }[shown]||'Status sistem belum tersedia.');
  autoOn.disabled=!canChangeAuto('on');
  autoStop.disabled=!canChangeAuto('stop');
 }
 function openAutoDialog(action){
  if(!canChangeAuto(action))return;
  const on=action==='on',pod=autoAccount.pod,phrase='AKTIFKAN '+(pod?.tradeMode==='REAL'?'REAL':'DEMO');
  autoAction={action,phrase,mask:pod?.accountMask,mode:pod?.tradeMode};
  $('quickAutoDialogTitle').textContent=on?'Hidupkan Auto Trade':'Hentikan entry baharu';
  $('quickAutoDialogNote').textContent=on
   ?'Taip frasa pengesahan untuk benarkan entry Auto Trade'+(pod?.accountMask?' pada MT5 '+pod.accountMask:'.')
   :'Posisi terbuka akan terus diurus oleh sistem exit.';
  $('quickAutoPhrase').textContent=phrase;
  $('quickAutoConfirmLabel').hidden=!on;
  autoConfirmation.value='';
  autoConfirmation.required=on;
  autoError.textContent='';
  autoSend.textContent=on?'ON SISTEM':'STOP ENTRY';
  autoDialog.showModal();
 }
 autoOn.addEventListener('click',()=>openAutoDialog('on'));
 autoStop.addEventListener('click',()=>openAutoDialog('stop'));
 autoCancel.addEventListener('click',()=>autoDialog.close());
 autoDialog.addEventListener('cancel',e=>{if(autoPending)e.preventDefault();});
 $('quickAutoForm').addEventListener('submit',async e=>{
  e.preventDefault();
  const draft=autoAction,pod=autoAccount?.pod;
  if(!draft||autoPending)return;
  if(!canChangeAuto(draft.action)||draft.mask!==pod?.accountMask||draft.mode!==pod?.tradeMode){
   autoError.textContent='Status sistem atau akaun MT5 berubah. Buka semula pengesahan.';
   return;
  }
  const turningOn=draft.action==='on';
  const confirmation=autoConfirmation.value.trim().toUpperCase();
  if(turningOn&&confirmation!==draft.phrase){autoError.textContent='Taip '+draft.phrase+' untuk meneruskan.';return;}
  autoPending=true;
  autoRevision++;
  autoSend.disabled=autoCancel.disabled=autoConfirmation.disabled=true;
  autoError.textContent='';
  renderAutoControls();
  try{
   autoAccount=await api('/api/auto-trade/'+draft.action,turningOn?{confirmation}:{});
   autoDialog.close();
  }catch(error){
   autoError.textContent=error.name==='TimeoutError'||error.name==='TypeError'||error.message==='UNAVAILABLE'
    ?'Arahan belum disahkan. Semak status sistem sebelum cuba lagi.':error.message;
  }finally{
   autoRevision++;
   autoPending=false;
   autoSend.disabled=autoCancel.disabled=autoConfirmation.disabled=false;
   renderAutoControls();
  }
 });
 async function connections(){
  if(stopped)return;
  const otherStatus=Promise.allSettled([api('/api/analysis-alerts/settings'),api('/ready')]);
  const revision=autoRevision;
  const account=await api('/api/auto-trade/state').catch(()=>null);
  if(!autoPending&&revision===autoRevision){autoAccount=account;renderAutoControls();}
  quickForm.hidden=account?.viewerMode===true;
  const wasReady=quickReady;
  quickReady=account?.manualOrderReady===true;
  quickAccount=account?.pod?.accountMask||'';
  closeAllBinding=account?.manualCloseAllBinding||null;
  updateQuickButtons();
  if(!quickPending&&(wasReady!==quickReady||quickStatus.textContent==='Menyemak sambungan MT5…')) {
   quickStatus.textContent=quickReady?'MT5 '+quickAccount:'Sambungan MT5 untuk order belum tersedia.';
  }
  renderAccount(account);
  $('mt5State').textContent=account?.connection?.label||'STATUS BELUM ADA';
  dot('mt5Dot',account?.connection?.connected===true||account?.connection?.state==='CONNECTED');
  const [alerts,health]=await otherStatus;
  const state=account?.control?.effectiveState||'STOPPED';
  const paused=health.status==='fulfilled'?health.value?.autoEntry?.signalsPaused:null;
  if(paused!==null&&paused!==undefined){autoPaused=paused;renderAutoControls();}
  $('tradeState').textContent=!account?'STATUS BELUM ADA':paused===true?'PAUSED':state==='ON'&&paused===null?'ON • SEMAK STATUS':state.replaceAll('_',' ');
  dot('tradeDot',!!account&&state==='ON'&&paused===false);
  const p=alerts.status==='fulfilled'?alerts.value.settings:null;
  const enabled=p?.verified&&p.telegramEnabled&&p.telegramAvailable;
  $('telegramState').textContent=enabled?'AKTIF':p?.telegramAvailable?'BELUM DIAKTIFKAN':p?'BELUM ADA':'STATUS BELUM ADA';
  dot('telegramDot',!!enabled);
  if(!stopped)setTimeout(connections,5000);
 }
 api('/auth/me').then(j=>{$('welcomeName').textContent=j.user?.displayName||'Trader';}).catch(()=>{});
 $('logoutButton').onclick=async()=>{$('logoutButton').disabled=true;try{await fetch('/auth/logout',{method:'POST',credentials:'same-origin',headers:{Accept:'application/json'}});}finally{location.replace('/login');}};
 selectChart();render();startLiveStream();poll();connections();const clockTimer=setInterval(render,1000);window.addEventListener('pagehide',()=>{stopped=true;streams.forEach(stream=>stream.close());clearInterval(clockTimer);});
})();

