(function(){
'use strict';
window.__ZENCORE_DISPLAY_STATE_LOCK__=true;
const symbol=String(window.__ZENCORE_PAIR__||'XAUUSD').toUpperCase();
const N=v=>{if(v===null||v===undefined||v===''||v==='null')return null;const x=Number(v);return Number.isFinite(x)?x:null};
const U=v=>String(v||'').toUpperCase();
const q=id=>document.getElementById(id);
let latest=null,pred=null,painting=false;
const LIVE_MS=90000;
function set(id,text,color){const e=q(id);if(!e)return;if(e.textContent!==text)e.textContent=text;if(color)e.style.color=color;}
function side(d){return d?.tradeIsBuy===true?'BUY':d?.tradeIsBuy===false?'SELL':(/BUY|LONG/.test(U(d?.action))?'BUY':/SELL|SHORT/.test(U(d?.action))?'SELL':'TRADE');}
function predSide(){const s=U(pred?.prediction);return /BUY|LONG|BULL/.test(s)?'BUY':/SELL|SHORT|BEAR/.test(s)?'SELL':'WAIT';}
function feedState(d){const t=N(d?.receivedAt);const age=t?Math.max(0,Date.now()-t):Infinity;return{age,live:age<LIVE_MS};}
function ageText(ms){if(!Number.isFinite(ms))return'Last update —';const s=Math.floor(ms/1000);return s<60?`Last ${s}s ago`:`Last ${Math.floor(s/60)}m ago`;}
function paintFeed(d){const f=feedState(d),feed=q('feed'),dot=q('dot'),fresh=q('fresh');if(feed){feed.textContent=f.live?'DATA LIVE':'DATA DELAY';feed.classList.toggle('v9-feed-fresh',f.live);feed.classList.toggle('v9-feed-stale',!f.live);}if(dot)dot.classList.toggle('off',!f.live);if(fresh)fresh.textContent=ageText(f.age);return f;}
function brand(){const h=document.querySelector('header.top .brand h1');if(h)h.textContent='ZENCORE V19 — TRADER ANALYSIS TERMINAL';const phases=document.querySelectorAll('header.top .phase-pill');if(phases.length)phases[phases.length-1].textContent='LIVE ANALYSIS';const sig=q('v10Signal')?.previousElementSibling;if(sig)sig.textContent='BIAS / TRADE';}
function translateDecision(s){let x=U(s);if(!x)return'TUNGGU SETUP';if(x.includes('ENTRY BUY CONFIRMED'))return'BUY DAH CUN — CARI ENTRY';if(x.includes('ENTRY SELL CONFIRMED'))return'SELL DAH CUN — CARI ENTRY';if(x.includes('PREPARE BUY'))return'BUY NAK CUN — TUNGGU TRIGGER';if(x.includes('PREPARE SELL'))return'SELL NAK CUN — TUNGGU TRIGGER';if(x.includes('WAIT CONFIRMATION BUY'))return'BUY BELUM CONFIRM';if(x.includes('WAIT CONFIRMATION SELL'))return'SELL BELUM CONFIRM';if(x.includes('WAIT PRICE BUY'))return'BUY BIAS CUN — TUNGGU PRICE';if(x.includes('WAIT PRICE SELL'))return'SELL BIAS CUN — TUNGGU PRICE';if(x.includes('WAIT NEW BUY PLAN'))return'BUY PLAN TAK CUN — TUNGGU';if(x.includes('WAIT NEW SELL PLAN'))return'SELL PLAN TAK CUN — TUNGGU';if(x.includes('WATCH BUY'))return'BUY ADA POTENSI — TUNGGU';if(x.includes('WATCH SELL'))return'SELL ADA POTENSI — TUNGGU';if(x.includes('NO TRADE — CHOP'))return'MARKET SERABUT — TAK PAYAH MASUK';if(x.includes('NO TRADE — R:R'))return'R:R TAK CUN — SKIP';if(x.includes('NO TRADE'))return'TAK PAYAH MASUK';if(x.includes('FEED STALE')||x.includes('NO LIVE DATA'))return'DATA LAMBAT — TUNGGU';return s;}
function precisionLifecycle(d,f){const box=q('v19Precision');if(!box)return;const dec=box.querySelector('.v19decision'),sub=box.querySelector('.v19sub'),score=box.querySelector('.v19score b'),scoreSub=box.querySelector('.v19score small');const s=side(d),tp3=d?.tp3Hit===true,sl=d?.slHit===true&&!tp3,active=d?.tradeActive===true&&!tp3&&!sl;
  if(tp3){if(dec){dec.textContent='TP3 SETTLE — TRADE CLOSED';dec.style.color='#43e9a0'}if(sub)sub.innerHTML=`<b>${s} settle.</b> TP3 dah kena. Tunggu setup baru.${f.live?'':' Data tengah delay.'}`;if(score)score.textContent='—';if(scoreSub)scoreSub.textContent='Trade settle • tunggu setup baru';}
  else if(sl){if(dec){dec.textContent='SL KENA — TRADE CLOSED';dec.style.color='#ff6878'}if(sub)sub.innerHTML=`<b>${s} kena SL.</b> Jangan revenge trade. Tunggu setup baru.${f.live?'':' Data tengah delay.'}`;if(score)score.textContent='—';if(scoreSub)scoreSub.textContent='Trade closed • tunggu setup baru';}
  else if(active&&!f.live){if(dec){dec.textContent=`${s} RUNNING — DATA DELAY`;dec.style.color='#ffbf58'}if(sub)sub.innerHTML=`Trade masih jalan tapi data lambat. <b>Jangan tambah position dulu.</b>`;}
}
function topState(d,f){const s=side(d),ps=predSide(),tp3=d?.tp3Hit===true,sl=d?.slHit===true&&!tp3,active=d?.tradeActive===true&&!tp3&&!sl;
  if(tp3){set('v10Decision','TP3 SETTLE — TRADE CLOSED','#43e9a0');set('v10DecisionSub',`${s} dah settle. Jangan kejar entry baru; tunggu setup fresh.`);set('v10Signal',`${s} SETTLE`,'#43e9a0');set('v10Stability','—','#91a7bb');set('v10Readiness','WAIT NEXT SETUP','#51a8ff');set('v10Grade','SETTLE','#43e9a0');set('v10Coach','TP3 dah kena. Nice. Rehat dulu, tunggu setup baru yang fresh.');set('v10Shield','WAIT NEXT SETUP','#ffbf58');set('v10ShieldReason','Bias lama jangan guna untuk re-entry. Tunggu plan baru.');return;}
  if(sl){set('v10Decision','SL KENA — TRADE CLOSED','#ff6878');set('v10DecisionSub',`${s} kena SL. Jangan revenge entry.`);set('v10Signal',`${s} CLOSED`,'#ff6878');set('v10Stability','—','#91a7bb');set('v10Readiness','WAIT NEXT SETUP','#51a8ff');set('v10Grade','CLOSED','#ff6878');set('v10Coach','SL dah kena. Jangan balas market. Tunggu setup baru betul-betul cun.');set('v10Shield','JANGAN REVENGE TRADE','#ffbf58');set('v10ShieldReason','Tunggu setup baru dan data kembali fresh.');return;}
  if(active){const c=s==='BUY'?'#32e38d':'#ff6070';set('v10Decision',`${s} RUNNING${f.live?'':' — DATA DELAY'}`,f.live?'#51a8ff':'#ffbf58');set('v10DecisionSub',f.live?'Trade tengah jalan. Fokus manage position, jangan tambah entry sesuka hati.':'Trade tengah jalan tapi data lambat. Jangan tambah position dulu.');set('v10Signal',`${s} RUNNING`,c);if(!f.live){set('v10Coach','Data tengah lambat. Position masih jalan — jaga risk, jangan tambah lot.');set('v10Shield','DATA DELAY — JANGAN ADD POSITION','#ffbf58');set('v10ShieldReason','Tunggu data kembali LIVE sebelum buat keputusan baru.');}return;}
  const pbox=q('v19Precision'),rawDec=pbox?.querySelector('.v19decision')?.textContent||'TUNGGU SETUP',rawSub=pbox?.querySelector('.v19sub')?.textContent||'';
  const td=translateDecision(rawDec);set('v10Decision',td,td.includes('BUY')?'#32e38d':td.includes('SELL')?'#ff6070':'#ffbf58');set('v10DecisionSub',rawSub||'Tunggu setup yang betul-betul cun.');set('v10Signal',ps==='WAIT'?'WAIT':`BIAS ${ps}`,ps==='BUY'?'#32e38d':ps==='SELL'?'#ff6070':'#ffbf58');
}
function apply(){if(!latest||painting||document.hidden)return;painting=true;try{brand();const f=paintFeed(latest);topState(latest,f);precisionLifecycle(latest,f);}finally{painting=false;}}
async function refresh(){try{const [mr,pr]=await Promise.all([fetch(`/api/market/${encodeURIComponent(symbol)}`,{cache:'no-store'}),fetch(`/api/prediction/${encodeURIComponent(symbol)}`,{cache:'no-store'})]);if(mr.ok)latest=await mr.json();if(pr.ok)pred=await pr.json();apply();}catch(_){}}
function liveStreams(){
  try{const re=new EventSource('/events');re.onmessage=ev=>{try{const d=JSON.parse(ev.data);if(d&&U(d.symbol)===symbol){latest=d;apply()}}catch(_){}}}catch(_){}
  try{const pe=new EventSource(`/prediction-events/${encodeURIComponent(symbol)}`);pe.addEventListener('prediction',ev=>{try{pred=JSON.parse(ev.data);apply()}catch(_){}})}catch(_){}
}
refresh();liveStreams();
setInterval(()=>{if(!document.hidden)refresh()},30000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh()});
})();
