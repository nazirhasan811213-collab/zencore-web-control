/* Read-only bridge to authenticated Errante analysis. No execution endpoints. */
(function(){
 'use strict';
 const desk=window.ZenCoreFusionDesk;
 if(!desk||document.querySelector('meta[name="zencore-desk-host"]')?.content!=='errante')return;
 const status=document.createElement('p');status.className='native-feed-status';status.setAttribute('role','status');
 status.style.cssText='color:#a7b2ba;font-size:12px;margin:8px 0 18px';
 document.querySelector('.analysis-view-switch')?.after(status);
 let busy=false,lastTf=null,lastAt=0;
 const bridge=new URLSearchParams(location.search).get('bridge')==='1',site='https://zencore-signal-desk.magicpeony2.chatgpt.site';
 const say=text=>{status.textContent=text;window.ZenCoreLive?.status(text);};
 say('Menyambung data Pine/Errante sebenar · baca sahaja.');
 window.addEventListener('message',event=>{
  if(event.origin!==location.origin||event.source!==parent||event.data?.type!=='zencore-desk-timeframe')return;
  desk.setTimeframe(event.data.tf);refresh();
 });
 async function get(url,signal){
  const response=await fetch(url,{credentials:'same-origin',cache:'no-store',signal});
  if(!response.ok)throw new Error(response.status===401||response.redirected?'Sesi tamat. Log masuk semula.':'Data server belum tersedia.');
  return response.json();
 }
 async function refresh(){
  if((document.hidden&&!bridge)||!['live','paired'].includes(desk.getView())||busy)return;
  const tf=desk.getTimeframe();if(lastTf===tf&&Date.now()-lastAt<5000)return;
  busy=true;lastTf=tf;lastAt=Date.now();const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000);
  try{
   const analysis=await get('/api/analysis/timeframes?symbol=XAUUSD',controller.signal);
   for(const selected of (bridge?['2','15']:[tf])){
   try{
   const history=await get('/api/analysis/chart?symbol=XAUUSD&tf='+selected,controller.signal);
   const tf=selected;
   const view=analysis?.views?.find(row=>String(row.timeframe)===tf),m=view?.market;
   if(analysis?.ok!==true||analysis.symbol!=='XAUUSD'||history?.ok!==true||history.source!=='PINE_FEED'||history.symbol!=='XAUUSD'||String(history.timeframe)!==tf||!m||m.symbol!=='XAUUSD'||String(m.timeframe)!==tf)throw new Error('Tunggu data Pine dan candle TF'+tf+' daripada server.');
   // Whitelist market-only fields. Preserve actual timestamps and confirmation.
   const pine={};for(const key of ['symbol','timeframe','sourceBarTime','time','signalObservedAt','receivedAt','confirmed','normal3Close','close','price','normal3Entry','initialSl','tp1','tp2','tp3','setupMeta','strategyNormal','hemaConfirmation'])if(m[key]!==undefined)pine[key]=m[key];
   const packet={pine,history:{symbol:history.symbol,timeframe:history.timeframe,candles:history.candles}};
   if(window.ZenCoreLive){window.ZenCoreLive.acceptHost(packet);if(bridge&&window.opener)window.opener.postMessage({type:'zencore-real-data',packet:window.ZenCoreLive.project(packet)},site);}
   if(desk.getView()==='paired')desk.acceptHostPacket(packet);
   say('Data Analysis ZenCore diterima · TF'+tf+' · baca sahaja. Semak masa data dan perkara yang masih menunggu.');
   }catch(error){say(error.message);}
   }
  }catch(error){say(error.name==='AbortError'?'Sambungan lambat. Cuba semula sebentar lagi.':error.message==='Unexpected token'?'Sesi tidak tersedia. Log masuk semula.':error.message);}
  finally{clearTimeout(timer);busy=false;}
 }
 document.addEventListener('click',()=>setTimeout(refresh,0));
 document.addEventListener('visibilitychange',refresh);
 setInterval(refresh,5000);refresh();
})();
