(function(){
'use strict';
const $=id=>document.getElementById(id);let data=null,filter='all';
const fmt=(v,d=2)=>Number.isFinite(+v)?(+v).toLocaleString(undefined,{maximumFractionDigits:d}):'—';
const age=ts=>{if(!ts)return'—';const s=Math.max(0,Math.floor((Date.now()-ts)/1000));return s<60?`${s}s`:s<3600?`${Math.floor(s/60)}m`:`${Math.floor(s/3600)}h`};
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const sum=(l,v,c='')=>`<div class="sum"><span>${l}</span><b class="${c}">${v}</b></div>`;
function visible(m){if(filter==='hot')return m.status==='HOT PREDICTION';if(filter==='ready')return ['HOT PREDICTION','PREDICTION READY'].includes(m.status);if(filter==='active')return m.status==='TRADE ACTIVE';if(filter==='live')return m.freshness==='LIVE';return true}
function zoneClass(z){z=String(z||'');return z.includes('IN ENTRY')?'in':z.includes('NEAR')?'near':'wait'}
function card(m){
 const side=(m.prediction||'WAIT').toLowerCase(),hot=m.status==='HOT PREDICTION',trade=m.status==='TRADE ACTIVE',offline=m.freshness==='OFFLINE';
 const bc=hot?'hot':trade?'trade':m.status==='PREDICTION READY'?'ready':m.status==='WATCH'?'watch':m.freshness.toLowerCase();
 const reasons=(m.reasons||[]).slice(0,3).join(' • ')||'Menunggu lebih banyak consensus';
 return `<a class="market ${side} ${hot?'hot':''} ${trade?'trade':''} ${offline?'offline':''}" href="/pair/${encodeURIComponent(m.symbol)}"><div class="mh"><div><div class="pair">${esc(m.symbol)}</div><div class="tf">TF ${esc(m.timeframe||'—')} • ${esc(m.predictionHorizon||'NEXT 1–3 BARS')}</div></div><span class="badge ${bc}">${esc(m.status)}</span></div><div class="signal-row"><div><div class="signal">${esc(m.prediction||'WAIT')}</div><div class="prednote">PREDICTION • Current: <span class="current">${esc(m.currentAction||'WAIT')}</span></div></div><div class="score"><span>CONFIDENCE</span><b class="confidence">${m.predictionConfidence||0}/100</b></div></div><div class="meters"><div class="metric"><span>Pred Stability</span><b>${m.stability||0}/100</b><div class="rail"><i style="width:${Math.max(0,Math.min(100,m.stability||0))}%"></i></div></div><div class="metric"><span>Entry Ready</span><b>${m.readiness||0}/100</b><div class="rail"><i style="width:${Math.max(0,Math.min(100,m.readiness||0))}%"></i></div></div><div class="metric"><span>Consensus</span><b>${m.predictionConsensus||0}/${m.predictionEvidence||0}</b></div><div class="metric"><span>R:R TP3</span><b>${m.rr==null?'—':fmt(m.rr,2)+'R'}</b></div></div><div class="prednote">${esc(reasons)}</div><div class="footrow"><span class="zone ${zoneClass(m.zone)}">${esc(m.zone||'—')}</span><span>${m.price==null?'—':fmt(m.price,5)}</span><span class="fresh ${String(m.freshness||'').toLowerCase()}">${esc(m.freshness)} • ${age(m.receivedAt)} • ${esc(m.feedMode||'')}</span></div></a>`;
}
function render(){
 if(!data)return;const s=data.summary||{};
 $('summary').innerHTML=sum('Markets',s.markets??0)+sum('Live',s.live??0,'good')+sum('Hot Prediction',s.hot??0,'hot')+sum('Prediction Ready',s.ready??0)+sum('Active Trade',s.active??0)+sum('Near Entry',s.near??0)+sum('Watch',s.watch??0)+sum('Offline',s.offline??0);
 const b=data.best;if(b)$('bestSetup').innerHTML=`<span>BEST PREDICTION NOW</span><b>${esc(b.symbol)} • ${esc(b.prediction)} • ${b.predictionConfidence}/100</b><small>${esc(b.predictionHorizon)} • Consensus ${b.predictionConsensus}/${b.predictionEvidence} • Ready ${b.readiness} • ${esc(b.zone)}</small>`;else $('bestSetup').innerHTML='<span>BEST PREDICTION NOW</span><b>Belum ada prediction berkualiti</b><small>Sistem sengaja pilih WAIT apabila consensus belum cukup.</small>';
 const rows=(data.markets||[]).filter(visible);$('marketGrid').innerHTML=rows.length?rows.map(card).join(''):'<div class="empty">Tiada pair memenuhi filter ini sekarang.</div>';
}
async function refresh(){try{const r=await fetch('/api/markets',{cache:'no-store'});data=await r.json();render()}catch(e){$('marketGrid').innerHTML=`<div class="empty">Prediction Radar belum tersedia: ${esc(e.message)}</div>`}}
document.querySelectorAll('.filter').forEach(b=>b.addEventListener('click',()=>{document.querySelectorAll('.filter').forEach(x=>x.classList.remove('active'));b.classList.add('active');filter=b.dataset.filter||'all';render()}));
try{const es=new EventSource('/market-events');es.addEventListener('markets',e=>{try{data=JSON.parse(e.data);render()}catch(_){}})}catch(_){}
refresh();setInterval(refresh,10000);setInterval(()=>{if(data)render()},1000);
})();