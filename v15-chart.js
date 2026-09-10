(function(){
  'use strict';
  const $=id=>document.getElementById(id);
  const N=v=>{if(v===null||v===undefined||v===''||v==='null')return null;const x=Number(v);return Number.isFinite(x)?x:null};
  const U=v=>String(v||'').toUpperCase();
  const fmt=(v,d=2)=>N(v)==null?'—':N(v).toLocaleString(undefined,{minimumFractionDigits:d,maximumFractionDigits:d});
  let latest=null,history=[],lastRecv=0;

  const css=`
  .chartpanel{position:relative!important;overflow:visible!important}
  .chartwrap{position:relative!important;background:linear-gradient(rgba(255,255,255,.025) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.025) 1px,transparent 1px),radial-gradient(circle at 80% 18%,rgba(var(--v14-accent-rgb,72,222,215),.035),transparent 26%),#050b12!important;background-size:100% 52px,76px 100%,100% 100%,100% 100%!important}
  #chart{filter:saturate(1.04) contrast(1.02)}
  #chart text{font-family:Inter,system-ui,-apple-system,Segoe UI,sans-serif;font-variant-numeric:tabular-nums}
  #chart polygon{filter:drop-shadow(0 3px 6px rgba(0,0,0,.45))}
  .v15-hud{position:absolute;inset:0;z-index:6;pointer-events:none;overflow:hidden;border-radius:13px}
  .v15-top-hud{position:absolute;top:10px;right:12px;display:flex;align-items:center;gap:6px;max-width:62%;flex-wrap:wrap;justify-content:flex-end}
  .v15-hud-pill{display:flex;gap:6px;align-items:center;padding:6px 9px;border-radius:9px;border:1px solid rgba(112,151,190,.18);background:rgba(4,11,19,.83);backdrop-filter:blur(10px);font-size:8px;font-weight:850;letter-spacing:.25px;color:#91a9c2;box-shadow:0 8px 24px rgba(0,0,0,.22)}
  .v15-hud-pill b{font-size:9px;color:#eef6ff;font-variant-numeric:tabular-nums}.v15-hud-pill.buy b{color:#39e997}.v15-hud-pill.sell b{color:#ff7180}.v15-hud-pill.wait b{color:#ffc166}
  .v15-dot{width:6px;height:6px;border-radius:50%;background:#32e38d;box-shadow:0 0 9px #32e38d;animation:v15Pulse 1.8s ease-in-out infinite}
  @keyframes v15Pulse{50%{opacity:.45;transform:scale(.78)}}
  .v15-price-tag{position:absolute;right:0;transform:translateY(-50%);min-width:105px;padding:5px 9px 5px 10px;border-radius:8px 0 0 8px;border:1px solid currentColor;border-right:0;background:rgba(5,12,20,.93);backdrop-filter:blur(8px);font-size:8px;font-weight:900;line-height:1.15;letter-spacing:.2px;box-shadow:-7px 4px 16px rgba(0,0,0,.25);transition:top .25s ease;white-space:nowrap}
  .v15-price-tag span{opacity:.72;font-size:7px;margin-right:4px}.v15-price-tag.live{color:#7fc2ff;background:rgba(17,52,82,.94);box-shadow:-8px 0 22px rgba(81,168,255,.16)}.v15-price-tag.entry{color:#ffc35b}.v15-price-tag.sl{color:#ff7180}.v15-price-tag.tp{color:#42e99a}.v15-price-tag.zone{color:#ffd482;background:rgba(55,40,15,.9)}
  .v15-live-ray{position:absolute;left:4.8%;right:7.8%;height:1px;background:linear-gradient(90deg,transparent,rgba(81,168,255,.28) 8%,rgba(81,168,255,.7) 72%,rgba(81,168,255,.95));box-shadow:0 0 10px rgba(81,168,255,.16);transition:top .25s ease}
  .v15-focus-line{position:absolute;top:11%;bottom:7%;right:7.8%;width:1px;background:linear-gradient(180deg,transparent,rgba(var(--v14-accent-rgb,72,222,215),.08),transparent)}
  .v15-trade-summary{display:grid;grid-template-columns:repeat(4,minmax(105px,1fr));gap:6px;margin:8px 0 2px}
  .v15-summary-card{position:relative;overflow:hidden;padding:8px 10px;border:1px solid rgba(107,145,183,.16);border-radius:10px;background:linear-gradient(180deg,rgba(8,21,34,.9),rgba(5,13,22,.94));min-width:0}
  .v15-summary-card:before{content:"";position:absolute;left:0;top:0;bottom:0;width:2px;background:var(--v15-card,#51a8ff);opacity:.85}.v15-summary-card span{display:block;font-size:7px;color:#70869f;text-transform:uppercase;letter-spacing:.45px}.v15-summary-card b{display:block;margin-top:3px;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-variant-numeric:tabular-nums}.v15-summary-card small{display:block;margin-top:2px;color:#6d8198;font-size:7px}
  .v15-summary-card.signal{--v15-card:var(--v14-side,#48ded7)}.v15-summary-card.entry{--v15-card:#ffb74b}.v15-summary-card.target{--v15-card:#32e38d}.v15-summary-card.risk{--v15-card:#ff6070}
  .v15-bottom-badge{position:absolute;left:12px;bottom:11px;display:flex;gap:6px;align-items:center;padding:6px 9px;border-radius:8px;border:1px solid rgba(106,143,180,.16);background:rgba(4,10,17,.82);backdrop-filter:blur(8px);font-size:8px;color:#8198b2}.v15-bottom-badge b{color:#d8e7f8}
  .v15-exact{position:absolute;right:13%;top:72px;padding:7px 10px;border-radius:9px;border:1px solid currentColor;background:rgba(4,11,19,.9);font-size:9px;font-weight:950;letter-spacing:.35px;box-shadow:0 8px 24px rgba(0,0,0,.28)}.v15-exact.buy{color:#32e38d}.v15-exact.sell{color:#ff6070}.v15-exact.bias{color:#8ec8ff}
  @media(max-width:900px){.v15-top-hud{left:10px;right:10px;max-width:none;justify-content:flex-start}.v15-hud-pill:nth-child(3){display:none}.v15-price-tag{min-width:88px;font-size:7px;padding:4px 6px}.v15-trade-summary{grid-template-columns:1fr 1fr}.v15-exact{right:10px;top:78px}}
  @media(prefers-reduced-motion:reduce){.v15-dot{animation:none}.v15-price-tag,.v15-live-ray{transition:none}}
  `;
  const style=document.createElement('style');style.id='v15ChartStyle';style.textContent=css;document.head.appendChild(style);

  function side(d){const a=U(d?.action);if(/SELL|SHORT/.test(a))return'sell';if(/BUY|LONG/.test(a))return'buy';if(d?.tradeIsBuy===true)return'buy';if(d?.tradeIsBuy===false)return'sell';return'wait'}
  function zone(d){const e=N(d?.entry),a=N(d?.atr);if(e==null||a==null)return null;const pct=(N($('zonePct')?.value)||15)/100;return[e-a*pct,e+a*pct]}
  function sr(data){const v=data.filter(b=>N(b.high)!=null&&N(b.low)!=null).slice(-20);if(!v.length)return{s:null,r:null};return{s:Math.min(...v.map(b=>N(b.low))),r:Math.max(...v.map(b=>N(b.high)))}}
  function scale(data,d){let vals=[];for(const b of data){['open','high','low','close','ema9','ema20','ema50','hemaFast','hemaSlow'].forEach(k=>{const v=N(b[k]);if(v!=null)vals.push(v)})}['entry','sl','tp1','tp2','tp3','bullObTop','bullObBottom','bearObTop','bearObBottom'].forEach(k=>{const v=N(d?.[k]);if(v!=null)vals.push(v)});const z=zone(d),s=sr(data);if(z)vals.push(...z);if(s.s!=null)vals.push(s.s);if(s.r!=null)vals.push(s.r);if(!vals.length)return null;let lo=Math.min(...vals),hi=Math.max(...vals),pad=(hi-lo||1)*.07;return{lo:lo-pad,hi:hi+pad,z}}
  function yPct(v,sc){if(N(v)==null||!sc)return null;const T=28,H=560,B=34;const yy=T+(sc.hi-N(v))/(sc.hi-sc.lo)*(H-T-B);return yy/H*100}
  function ensure(){
    const wrap=document.querySelector('.chartwrap');if(!wrap)return null;
    let hud=$('v15Hud');if(!hud){hud=document.createElement('div');hud.id='v15Hud';hud.className='v15-hud';hud.innerHTML='<div class="v15-focus-line"></div><div class="v15-top-hud"><div id="v15Feed" class="v15-hud-pill"><i class="v15-dot"></i><span>FEED</span><b>LIVE</b></div><div id="v15Sig" class="v15-hud-pill wait"><span>SIGNAL</span><b>WAIT</b></div><div class="v15-hud-pill"><span>BAR</span><b id="v15Clock">--:--</b></div></div><div id="v15Tags"></div><div id="v15Exact"></div><div class="v15-bottom-badge">ZENCORE CHART <b id="v15Bars">0 BARS</b></div>';wrap.appendChild(hud)}
    const panel=wrap.closest('.chartpanel');if(panel&&!$('v15Summary')){const s=document.createElement('div');s.id='v15Summary';s.className='v15-trade-summary';s.innerHTML='<div class="v15-summary-card signal"><span>Market / Signal</span><b id="v15Market">—</b><small id="v15MarketSub">Menunggu feed</small></div><div class="v15-summary-card entry"><span>Entry Timing</span><b id="v15EntryState">—</b><small id="v15EntryDist">—</small></div><div class="v15-summary-card target"><span>Target Seterusnya</span><b id="v15Target">—</b><small id="v15TargetDist">—</small></div><div class="v15-summary-card risk"><span>Risk / Protection</span><b id="v15Risk">—</b><small id="v15RR">—</small></div>';const tabs=panel.querySelector('.charttabs');if(tabs)tabs.insertAdjacentElement('beforebegin',s);else panel.prepend(s)}
    return hud;
  }
  function tag(label,val,type,sc){const top=yPct(val,sc);if(top==null||top<3||top>97)return'';return `<div class="v15-price-tag ${type}" style="top:${top}%"><span>${label}</span>${fmt(val,2)}</div>`}
  function render(){const hud=ensure();if(!hud||!latest)return;const data=history.slice(-80),sc=scale(data,latest);if(!sc)return;const sd=side(latest),act=U(latest.action)||'WAIT';
    const sig=$('v15Sig');if(sig){sig.className=`v15-hud-pill ${sd}`;sig.querySelector('b').textContent=act}
    const age=lastRecv?Math.max(0,Date.now()-lastRecv):Infinity,feed=$('v15Feed');if(feed){feed.querySelector('b').textContent=age<180000?'LIVE':'STALE';const dot=feed.querySelector('.v15-dot');if(dot)dot.style.background=age<180000?'#32e38d':'#ff6070'}
    const tags=[];const close=N(latest.close);if(close!=null){const p=yPct(close,sc);tags.push(`<div class="v15-live-ray" style="top:${p}%"></div>`);tags.push(tag('LIVE',close,'live',sc))}tags.push(tag('ENTRY',latest.entry,'entry',sc),tag('SL',latest.sl,'sl',sc),tag('TP1',latest.tp1,'tp',sc),tag('TP2',latest.tp2,'tp',sc),tag('TP3',latest.tp3,'tp',sc));if(sc.z)tags.push(tag('ZONE',((sc.z[0]+sc.z[1])/2),'zone',sc));$('v15Tags').innerHTML=tags.join('');
    const exact=$('v15Exact');if(exact){if(act==='BUY'||act==='SELL'){exact.className=`v15-exact ${act.toLowerCase()}`;exact.textContent=`${act} • ${fmt(latest.close,2)}`}else{exact.className='v15-exact bias';exact.textContent=act.replace('_',' ')}}
    $('v15Bars').textContent=`${data.length} BARS`;
    const e=N(latest.entry),c=N(latest.close),a=N(latest.atr),sl=N(latest.sl),tp1=N(latest.tp1),tp2=N(latest.tp2),tp3=N(latest.tp3);const dist=e!=null&&c!=null?Math.abs(c-e):null,z=sc.z;let entryState='TUNGGU ZON';if(z&&c!=null){entryState=c>=z[0]&&c<=z[1]?'DALAM ENTRY ZONE':dist!=null&&a&&dist<=a*.4?'HAMPIR ZON':'DI LUAR ZON'}
    const market=$('v15Market');if(market)market.textContent=`${latest.symbol||'—'} • ${act.replace('_',' ')}`;if($('v15MarketSub'))$('v15MarketSub').textContent=`${latest.timeframe||'—'}m • ${latest.marketStructure||latest.hemaTrend||'Market live'}`;if($('v15EntryState'))$('v15EntryState').textContent=entryState;if($('v15EntryDist'))$('v15EntryDist').textContent=dist==null?'Jarak entry —':`Jarak ${fmt(dist,3)}${a?` • ${(dist/a).toFixed(2)} ATR`:''}`;
    const buy=latest.tradeIsBuy===true||(latest.tradeIsBuy!==false&&sd==='buy');let next=latest.tp1Hit?latest.tp2Hit?latest.tp3Hit?null:tp3:tp2:tp1,nextName=latest.tp1Hit?latest.tp2Hit?latest.tp3Hit?'COMPLETE':'TP3':'TP2':'TP1';if($('v15Target'))$('v15Target').textContent=nextName;if($('v15TargetDist'))$('v15TargetDist').textContent=next==null||c==null?'Trade complete':`Jarak ${fmt(Math.abs(next-c),3)}`;
    const risk=e!=null&&sl!=null?Math.abs(e-sl):null,rr=risk&&tp3!=null?Math.abs(tp3-e)/risk:null;if($('v15Risk'))$('v15Risk').textContent=latest.tradeActive?'POSISI AKTIF':latest.riskState||'RISK PLAN';if($('v15RR'))$('v15RR').textContent=rr==null?'R:R —':`R:R TP3 ${rr.toFixed(2)}R`;
  }
  function clock(){const tf=Math.max(1,N(latest?.timeframe)||1),period=tf*60;const now=Math.floor(Date.now()/1000),left=period-(now%period);const m=Math.floor(left/60),s=left%60;if($('v15Clock'))$('v15Clock').textContent=`${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`}
  async function bootstrap(){try{const [l,h]=await Promise.all([fetch('/api/latest',{cache:'no-store'}).then(r=>r.json()),fetch('/api/history',{cache:'no-store'}).then(r=>r.json())]);latest=l&&Object.keys(l).length?l:null;lastRecv=N(latest?.receivedAt)||Date.now();history=Array.isArray(h)?h.slice().sort((a,b)=>(N(a.time)||N(a.receivedAt)||0)-(N(b.time)||N(b.receivedAt)||0)):[];render()}catch(_){}
    try{const es=new EventSource('/events');es.onmessage=e=>{try{const d=JSON.parse(e.data);if(!d||!Object.keys(d).length)return;latest=d;lastRecv=N(d.receivedAt)||Date.now();const t=N(d.time)||N(d.receivedAt)||Date.now(),i=history.findIndex(x=>(N(x.time)||N(x.receivedAt))===t);if(i>=0)history[i]=d;else history.push(d);history.sort((a,b)=>(N(a.time)||N(a.receivedAt)||0)-(N(b.time)||N(b.receivedAt)||0));if(history.length>220)history=history.slice(-220);setTimeout(render,40)}catch(_){}}}catch(_){}
  }
  function brand(){const h=document.querySelector('.brand h1');if(h&&/ZENCORE V1[0-4]/i.test(h.textContent))h.textContent='ZENCORE V15 — PREMIUM CHART EXPERIENCE';const sub=document.querySelector('.brand .sub');if(sub)sub.textContent='Trader Focus • Pro Chart HUD • AI Trade Lifecycle • Entry / SL / TP • Performance measured';const ph=document.querySelector('.phase-pill');if(ph)ph.textContent='V15: CHART EXPERIENCE'}
  function init(){ensure();bootstrap();brand();setInterval(clock,500);setInterval(render,2500);setInterval(brand,2500);document.addEventListener('input',e=>{if(e.target?.id==='zonePct')render()})}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(init,900));else setTimeout(init,900);
})();
