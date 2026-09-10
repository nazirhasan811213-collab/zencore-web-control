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
  PairEventSource.CONNECTING=NativeES.CONNECTING;
  PairEventSource.OPEN=NativeES.OPEN;
  PairEventSource.CLOSED=NativeES.CLOSED;
  window.EventSource=PairEventSource;
})();
