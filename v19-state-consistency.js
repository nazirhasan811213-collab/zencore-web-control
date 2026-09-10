(function(){
'use strict';
const symbol=String(window.__ZENCORE_PAIR__||'XAUUSD').toUpperCase();
const N=v=>{if(v===null||v===undefined||v===''||v==='null')return null;const x=Number(v);return Number.isFinite(x)?x:null};
const U=v=>String(v||'').toUpperCase();
const q=id=>document.getElementById(id);
let latest=null;
const LIVE_MS=90000;
function set(id,text,color){const e=q(id);if(!e)return;if(e.textContent!==text)e.textContent=text;if(color)e.style.color=color;}
function side(d){return d?.tradeIsBuy===true?'BUY':d?.tradeIsBuy===false?'SELL':(/BUY|LONG/.test(U(d?.action))?'BUY':/SELL|SHORT/.test(U(d?.action))?'SELL':'TRADE');}
function feedState(d){const t=N(d?.receivedAt);const age=t?Math.max(0,Date.now()-t):Infinity;return{age,live:age<LIVE_MS};}
function ageText(ms){if(!Number.isFinite(ms))return'Kemaskini —';const s=Math.floor(ms/1000);return s<60?`Last ${s}s ago`:`Last ${Math.floor(s/60)}m ago`;}
function paintFeed(d){const f=feedState(d);const feed=q('feed'),dot=q('dot'),fresh=q('fresh');if(feed){feed.textContent=f.live?'PINE FEED LIVE':'PINE FEED STALE';feed.classList.toggle('v9-feed-fresh',f.live);feed.classList.toggle('v9-feed-stale',!f.live);}if(dot)dot.classList.toggle('off',!f.live);if(fresh)fresh.textContent=ageText(f.age);return f;}
function brand(){const h=document.querySelector('header.top .brand h1');if(h)h.textContent='ZENCORE V19 — PRECISION ANALYSIS TERMINAL';const phases=document.querySelectorAll('header.top .phase-pill');if(phases.length)phases[phases.length-1].textContent='V19: PRECISION GATE';}
function precisionLifecycle(d,f){const box=q('v19Precision');if(!box)return;const dec=box.querySelector('.v19decision'),sub=box.querySelector('.v19sub'),score=box.querySelector('.v19score b'),scoreSub=box.querySelector('.v19score small');const s=side(d),tp3=d?.tp3Hit===true,sl=d?.slHit===true&&!tp3,active=d?.tradeActive===true&&!tp3&&!sl;
  if(tp3){if(dec){dec.textContent='TRADE COMPLETE — TP3';dec.style.color='#43e9a0'}if(sub)sub.innerHTML=`Lifecycle: <b>${s} SELESAI</b> • TP3 dicapai. COOLDOWN dan tunggu setup baru.${f.live?'':' Feed semasa stale.'}`;if(score)score.textContent='—';if(scoreSub)scoreSub.textContent='Trade complete • quality baru belum dinilai';}
  else if(sl){if(dec){dec.textContent='TRADE STOPPED — SL';dec.style.color='#ff6878'}if(sub)sub.innerHTML=`Lifecycle: <b>${s} STOPPED</b> • Jangan revenge trade. Tunggu setup baru.${f.live?'':' Feed semasa stale.'}`;if(score)score.textContent='—';if(scoreSub)scoreSub.textContent='Cooldown • quality baru belum dinilai';}
  else if(active&&!f.live){if(dec){dec.textContent=`MANAGE ${s} ACTIVE — FEED STALE`;dec.style.color='#ffbf58'}if(sub)sub.innerHTML=`Posisi masih aktif tetapi feed melebihi ${LIVE_MS/1000}s. <b>Jangan tambah posisi</b> sehingga data kembali LIVE.`;}
}
function topLifecycle(d,f){const s=side(d),tp3=d?.tp3Hit===true,sl=d?.slHit===true&&!tp3,active=d?.tradeActive===true&&!tp3&&!sl;
  if(tp3){set('v10Decision','TRADE COMPLETE — TP3','#43e9a0');set('v10DecisionSub',`${s} selesai. TP3 dicapai; masuk COOLDOWN dan tunggu setup baru.`);set('v10Signal',`${s} • SELESAI`,'#43e9a0');set('v10Stability','—','#91a7bb');set('v10Readiness','COOLDOWN','#51a8ff');set('v10Grade','SELESAI','#43e9a0');set('v10Coach','Trade selesai. Jangan re-entry berdasarkan prediction lama; tunggu plan baru lengkap.');set('v10Shield','COOLDOWN — NO RE-ENTRY','#ffbf58');set('v10ShieldReason','Prediction selepas TP3 hanya observation sehingga setup baru dibentuk.');}
  else if(sl){set('v10Decision','TRADE STOPPED — SL','#ff6878');set('v10DecisionSub',`${s} ditutup pada invalidation. Masuk COOLDOWN.`);set('v10Signal',`${s} • STOPPED`,'#ff6878');set('v10Stability','—','#91a7bb');set('v10Readiness','COOLDOWN','#51a8ff');set('v10Grade','SELESAI','#ff6878');set('v10Coach','SL telah dicapai. Jangan revenge trade; tunggu setup baru lulus Precision Gate.');set('v10Shield','COOLDOWN — NO REVENGE ENTRY','#ffbf58');set('v10ShieldReason','Reset hanya selepas plan baru dan feed LIVE.');}
  else if(active){const suffix=f.live?'': ' — FEED STALE';set('v10Decision',`URUS ${s} AKTIF${suffix}`,f.live?'#51a8ff':'#ffbf58');set('v10Signal',`${s} AKTIF`,s==='BUY'?'#32e38d':'#ff6070');if(!f.live){set('v10Coach','Posisi aktif tetapi feed stale. Jangan tambah posisi; utamakan perlindungan risiko sehingga data kembali LIVE.');set('v10Shield','FEED STALE — DO NOT ADD','#ffbf58');set('v10ShieldReason','Management aktif, tetapi keputusan baru dibekukan kerana data tidak cukup segar.');}}
}
function apply(){if(!latest)return;brand();const f=paintFeed(latest);topLifecycle(latest,f);precisionLifecycle(latest,f);}
async function refresh(){try{const r=await fetch(`/api/market/${encodeURIComponent(symbol)}`,{cache:'no-store'});if(r.ok){latest=await r.json();apply();}}catch(_){}}
refresh();setInterval(refresh,3000);setInterval(apply,500);
})();
