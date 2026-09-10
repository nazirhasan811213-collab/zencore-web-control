(function(){
  'use strict';
  const symbol=String(window.__ZENCORE_PAIR__||'').toUpperCase();
  if(!symbol)return;
  document.documentElement.dataset.zencorePair=symbol;
  const nativeFetch=window.fetch.bind(window);
  window.fetch=function(input,init){
    let raw=typeof input==='string'?input:(input&&input.url)||'';
    try{
      const u=new URL(raw,location.origin);
      if(u.origin===location.origin){
        if(u.pathname==='/api/latest')raw=`/api/market/${encodeURIComponent(symbol)}`;
        else if(u.pathname==='/api/history')raw=`/api/history/${encodeURIComponent(symbol)}`;
        else if(u.pathname==='/api/journal')raw=`/api/journal/${encodeURIComponent(symbol)}`;
      }
    }catch(_){}
    return nativeFetch(raw||input,init);
  };
  const NativeES=window.EventSource;
  function PairEventSource(url,opts){
    const next=String(url)==='/events'?`/events/${encodeURIComponent(symbol)}`:url;
    return new NativeES(next,opts);
  }
  PairEventSource.prototype=NativeES.prototype;
  PairEventSource.CONNECTING=NativeES.CONNECTING;PairEventSource.OPEN=NativeES.OPEN;PairEventSource.CLOSED=NativeES.CLOSED;
  window.EventSource=PairEventSource;
  window.addEventListener('DOMContentLoaded',()=>{
    const back=document.createElement('a');back.href='/';back.textContent='← MARKET RADAR';back.style.cssText='position:fixed;left:14px;bottom:14px;z-index:9999;padding:9px 12px;border:1px solid #2b4968;border-radius:999px;background:#071522e8;color:#9bcfff;text-decoration:none;font:800 10px Inter,system-ui;backdrop-filter:blur(10px);box-shadow:0 8px 30px #0008';document.body.appendChild(back);
  });
})();
