(()=>{'use strict';
const $=id=>document.getElementById(id);
const fmt=(v,d=3)=>Number.isFinite(+v)?(+v).toLocaleString(undefined,{maximumFractionDigits:d}):'—';
const esc=s=>String(s??'—');
const age=ts=>{if(!ts)return'No live data yet';const s=Math.max(0,Math.floor((Date.now()-ts)/1000));return s<60?s+'s ago':Math.floor(s/60)+'m ago'};
function gateMarkup(g){const pass=!!g.pass;return '<div class="gate '+(pass?'pass':'fail')+'"><span class="icon">'+(pass?'✓':'×')+'</span><div><b>'+esc(g.label)+'</b><small>'+esc(g.detail||'')+'</small></div><strong class="'+(pass?'good':'bad')+'">'+(pass?'PASS':'WAIT')+'</strong></div>'}
function setText(id,v){const el=$(id);if(el)el.textContent=v}
function render(m){
 const n=m?.strategyNormal||{},s=n?.sop||{},p=n?.plan||null;
 window.__lastReceived=m?.receivedAt||null;
 setText('symbol',m?.symbol||'XAUUSD');
 const fresh=m?.freshness||'OFFLINE';setText('feedState',fresh);setText('feedAge',age(m?.receivedAt));$('feedDot').classList.toggle('live',fresh==='LIVE');
 const state=n.state||'WARMING',side=n.side||'WAIT';setText('entryState',state);setText('entrySide','SIDE: '+side);$('entryState').className=state==='READY'?'good':state==='WATCH'?'warn':'';
 setText('heroSignal',state==='READY'?('PRECISION '+side+' READY'):state==='WATCH'?('WATCH '+side+' SETUP'):'WAIT FOR VALID SETUP');
 setText('heroReason',n.reason||'Menunggu Pine V32 feed.');
 setText('entryPrice',fmt(s.entry,3));setText('closePrice','Current: '+fmt(s.close3??m?.price,3));
 setText('marketPower',s.marketPower==null?'—':fmt(s.marketPower,0)+'%');setText('forecast','Forecast: '+esc(s.forecast));setText('sopScore',(s.sopGreen??0)+'/5');
 const gates=Array.isArray(s.gates)?s.gates:[];setText('gateScore',gates.filter(x=>x.pass).length+'/5');
 $('gateList').innerHTML=gates.length?gates.map(gateMarkup).join(''):'<div class="gate fail"><span class="icon">…</span><div><b>Waiting Pine V32 feed</b><small>No entry data received yet</small></div><strong class="warn">WARMING</strong></div>';
 $('sopList').innerHTML=[1,2,3,4,5].map(i=>{const pass=!!s['sop'+i];return '<div class="sop '+(pass?'pass':'fail')+'"><span>SOP '+i+'</span><b class="'+(pass?'good':'bad')+'">'+(pass?'✓':'×')+'</b></div>'}).join('');
 setText('m5Position',s.m5Position||'—');setText('m5Close',fmt(s.m5Close,3));setText('m5Hema20',fmt(s.m5Hema20,3));setText('m5Hema40',fmt(s.m5Hema40,3));
 setText('planTitle',p?(side+' PLAN READY'):'No Active Plan');setText('planEntry',fmt(p?.entry,3));setText('planSL',fmt(p?.sl,3));setText('planTP1',fmt(p?.tp1,3));setText('planTP2',fmt(p?.tp2,3));setText('planTP3',fmt(p?.tp3,3));setText('riskDistance',fmt(p?.riskDistance,3));
 setText('planNote',p?'Hard gates passed. Verify execution and risk before entering.':'Plan hanya muncul apabila semua syarat entry lulus.');
}
async function refresh(){try{const r=await fetch('/api/prediction/XAUUSD',{cache:'no-store'});if(!r.ok)throw new Error('HTTP '+r.status);render(await r.json())}catch(e){setText('feedState','OFFLINE');setText('heroReason','Dashboard waiting for backend: '+e.message)}}
try{const es=new EventSource('/prediction-events/XAUUSD');es.addEventListener('prediction',e=>{try{render(JSON.parse(e.data))}catch(_){}})}catch(_){}
refresh();setInterval(refresh,10000);setInterval(()=>{const t=$('feedAge');if(t&&window.__lastReceived)t.textContent=age(window.__lastReceived)},1000);
})();