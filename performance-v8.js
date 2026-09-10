(function(){
  const css=`
  .perf8{margin-top:10px;border:1px solid #27394f;background:linear-gradient(180deg,#0a111b,#060a10);border-radius:16px;padding:12px}
  .perf8-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;margin-bottom:10px}
  .perf8-title{font-size:13px;font-weight:950;letter-spacing:.4px}
  .perf8-sub{font-size:9px;color:#8295ad;line-height:1.45;margin-top:3px}
  .perf8-badge{font-size:9px;border:1px solid #32e38d44;color:#69efaa;border-radius:999px;padding:5px 8px;white-space:nowrap}
  .perf8-kpis{display:grid;grid-template-columns:repeat(8,1fr);gap:7px}
  .perf8-kpi{padding:10px;border:1px solid #1b293a;background:#080e16;border-radius:10px;min-width:0}
  .perf8-kpi span{display:block;font-size:8px;color:#7489a2;text-transform:uppercase;letter-spacing:.45px}
  .perf8-kpi b{display:block;font-size:16px;margin-top:4px}
  .perf8-kpi small{display:block;font-size:8px;color:#6e8299;margin-top:3px;line-height:1.3}
  .perf8-good{color:#32e38d}.perf8-bad{color:#ff6070}.perf8-warn{color:#ffb74b}.perf8-blue{color:#51a8ff}
  .perf8-tabs{display:flex;gap:6px;margin:10px 0 8px;flex-wrap:wrap}
  .perf8-tab{border:1px solid #213147;background:#0a111b;color:#95a8c0;border-radius:8px;padding:7px 10px;font-size:9px;font-weight:800;cursor:pointer}
  .perf8-tab.active{color:#fff;border-color:#51a8ff66;background:#51a8ff12}
  .perf8-grid{display:grid;grid-template-columns:1.08fr .92fr;gap:8px}
  .perf8-box{border:1px solid #1b293a;border-radius:11px;background:#080e16;padding:10px;overflow:hidden}
  .perf8-box h3{font-size:10px;margin:0 0 8px;text-transform:uppercase;letter-spacing:.45px;color:#93a7bf}
  .perf8-table{width:100%;border-collapse:collapse;font-size:9px}
  .perf8-table th,.perf8-table td{padding:7px 6px;border-bottom:1px solid #ffffff0b;text-align:right;white-space:nowrap}
  .perf8-table th:first-child,.perf8-table td:first-child{text-align:left}
  .perf8-table th{color:#71859d;font-size:8px}
  .perf8-outcomes{display:flex;flex-direction:column;gap:6px;max-height:245px;overflow:auto}
  .perf8-trade{display:grid;grid-template-columns:70px 56px 1fr auto;gap:7px;align-items:center;padding:7px;border:1px solid #172536;border-radius:8px;background:#070c13;font-size:9px}
  .perf8-trade .side.BUY{color:#32e38d}.perf8-trade .side.SELL{color:#ff6070}
  .perf8-note{margin-top:8px;padding:9px;border:1px solid #ffb74b28;background:#ffb74b07;border-radius:9px;color:#bca985;font-size:9px;line-height:1.5}
  .perf8-quality{display:grid;grid-template-columns:1fr auto;gap:8px;align-items:center;padding:9px;border:1px solid #1c2a3d;border-radius:9px;background:#070c13;margin-top:8px}
  .perf8-quality b{font-size:11px}.perf8-quality span{font-size:9px;color:#8295ad}
  @media(max-width:1300px){.perf8-kpis{grid-template-columns:repeat(4,1fr)}}
  @media(max-width:900px){.perf8-grid{grid-template-columns:1fr}.perf8-kpis{grid-template-columns:repeat(2,1fr)}}
  `;
  const style=document.createElement('style');style.textContent=css;document.head.appendChild(style);

  const root=document.createElement('section');
  root.id='performanceV8'; root.className='perf8';
  root.innerHTML=`
    <div class="perf8-head">
      <div><div class="perf8-title">ZENCORE V8 — PERFORMANCE ENGINE</div>
      <div class="perf8-sub">Ukur prestasi signal sebenar • benchmark TP1 lawan SL • gred • stability • sesi • regime • data quality</div></div>
      <span class="perf8-badge">AUTO TRADE OFF</span>
    </div>
    <div class="perf8-kpis">
      <div class="perf8-kpi"><span>Total Signal</span><b id="p8Total">—</b><small>BUY + SELL tepat</small></div>
      <div class="perf8-kpi"><span>Resolved</span><b id="p8Resolved">—</b><small>TP1-first / SL-first</small></div>
      <div class="perf8-kpi"><span>Win Rate TP1</span><b id="p8Win">—</b><small>TP1 sebelum SL</small></div>
      <div class="perf8-kpi"><span>Expectancy</span><b id="p8Exp">—</b><small>benchmark ±1R</small></div>
      <div class="perf8-kpi"><span>Profit Factor</span><b id="p8PF">—</b><small>benchmark TP1</small></div>
      <div class="perf8-kpi"><span>TP3 Reach</span><b id="p8TP3">—</b><small>max target dicapai</small></div>
      <div class="perf8-kpi"><span>Avg Max R</span><b id="p8MaxR">—</b><small>target maksimum</small></div>
      <div class="perf8-kpi"><span>Max Drawdown</span><b id="p8DD">—</b><small>benchmark R</small></div>
    </div>
    <div class="perf8-quality"><div><b>Data Quality Pine</b><br><span id="p8QualitySub">Menunggu statistik payload...</span></div><b id="p8Quality">—</b></div>
    <div class="perf8-tabs">
      <button class="perf8-tab active" data-view="grade">Ikut Gred</button>
      <button class="perf8-tab" data-view="stability">Ikut Stability</button>
      <button class="perf8-tab" data-view="session">Ikut Sesi</button>
      <button class="perf8-tab" data-view="regime">Ikut Regime</button>
      <button class="perf8-tab" data-view="side">BUY vs SELL</button>
    </div>
    <div class="perf8-grid">
      <div class="perf8-box"><h3 id="p8TableTitle">Prestasi Ikut Gred</h3><div id="p8Table"></div></div>
      <div class="perf8-box"><h3>Signal & Outcome Terkini</h3><div id="p8Recent" class="perf8-outcomes"></div></div>
    </div>
    <div class="perf8-note"><b>Nota penting:</b> Performance Engine ini mengukur <b>kualiti signal</b>. Win = TP1 dicapai sebelum SL, loss = SL berlaku sebelum TP1. Expectancy dan Profit Factor di sini ialah benchmark ±1R, bukan untung/rugi sebenar MT5. Ini sengaja dipisahkan supaya statistik tidak mengelirukan.</div>
  `;
  const anchor=document.getElementById('v7Pro')||document.querySelector('.v6-head');
  if(anchor)anchor.insertAdjacentElement('afterend',root);else document.querySelector('.wrap')?.appendChild(root);

  const $=id=>document.getElementById(id);
  let data=null,view='grade';
  const f=(v,d=1)=>Number.isFinite(+v)?(+v).toFixed(d):'—';
  const pct=v=>Number.isFinite(+v)?`${(+v).toFixed(1)}%`:'—';
  const cls=v=>!Number.isFinite(+v)?'':+v>=60?'perf8-good':+v>=45?'perf8-warn':'perf8-bad';

  function rowsFor(v){
    if(!data)return[];
    return v==='grade'?data.byGrade:v==='stability'?data.byStability:v==='session'?data.bySession:v==='regime'?data.byRegime:data.bySide;
  }
  function titleFor(v){return({grade:'Prestasi Ikut Gred',stability:'Prestasi Ikut Signal Stability',session:'Prestasi Ikut Sesi',regime:'Prestasi Ikut Market Regime',side:'Prestasi BUY vs SELL'})[v]||'Prestasi'}
  function renderTable(){
    const rows=rowsFor(view), el=$('p8Table'); if(!el)return;
    $('p8TableTitle').textContent=titleFor(view);
    el.innerHTML=rows.length?`<table class="perf8-table"><thead><tr><th>Kumpulan</th><th>Signal</th><th>Resolved</th><th>Win Rate</th><th>Exp.</th><th>TP2</th><th>TP3</th></tr></thead><tbody>${rows.map(r=>`<tr><td><b>${r.key}</b></td><td>${r.total}</td><td>${r.resolved}</td><td class="${cls(r.winRate)}">${pct(r.winRate)}</td><td class="${(+r.expectancy||0)>=0?'perf8-good':'perf8-bad'}">${Number.isFinite(+r.expectancy)?(+r.expectancy).toFixed(2)+'R':'—'}</td><td>${pct(r.tp2Rate)}</td><td>${pct(r.tp3Rate)}</td></tr>`).join('')}</tbody></table>`:'<div class="muted">Belum cukup signal untuk statistik kumpulan.</div>';
  }
  function renderRecent(){
    const el=$('p8Recent');if(!el)return;
    const rows=(data?.recent||[]).slice(0,20);
    el.innerHTML=rows.length?rows.map(t=>{
      const outcome=t.firstOutcome==='TP1'?'WIN TP1':t.firstOutcome==='SL'?'LOSS SL':t.tp3Hit?'TP3':t.tp2Hit?'TP2':t.tp1Hit?'TP1':'OPEN';
      const oc=t.firstOutcome==='TP1'?'perf8-good':t.firstOutcome==='SL'?'perf8-bad':'perf8-warn';
      return `<div class="perf8-trade"><span>${new Date(t.signalTime||t.receivedAt||Date.now()).toLocaleTimeString()}</span><b class="side ${t.side}">${t.side}</b><span>${t.symbol||'—'} • ${t.grade||'—'} • Stability ${Number.isFinite(+t.stabilityScore)?Math.round(+t.stabilityScore):'—'}</span><b class="${oc}">${outcome}</b></div>`
    }).join(''):'<div class="muted">Belum ada signal BUY/SELL tepat direkodkan.</div>';
  }
  function render(){
    if(!data)return;
    const s=data.summary||{};
    $('p8Total').textContent=s.total??'—';
    $('p8Resolved').textContent=s.resolved??'—';
    $('p8Win').textContent=pct(s.winRate); $('p8Win').className=cls(s.winRate);
    $('p8Exp').textContent=Number.isFinite(+s.expectancy)?`${(+s.expectancy).toFixed(2)}R`:'—'; $('p8Exp').className=(+s.expectancy||0)>=0?'perf8-good':'perf8-bad';
    $('p8PF').textContent=s.profitFactorInfinite?'∞':f(s.profitFactor,2);
    $('p8TP3').textContent=pct(s.tp3Rate);
    $('p8MaxR').textContent=Number.isFinite(+s.avgMaxR)?`${(+s.avgMaxR).toFixed(2)}R`:'—';
    $('p8DD').textContent=Number.isFinite(+s.maxDrawdownR)?`${(+s.maxDrawdownR).toFixed(1)}R`:'—';
    const q=data.dataQuality||{};
    $('p8Quality').textContent=Number.isFinite(+q.nativeRate)?`${(+q.nativeRate).toFixed(1)}% NATIVE`:'—';
    $('p8Quality').className=Number.isFinite(+q.nativeRate)&&+q.nativeRate>=95?'perf8-good':Number.isFinite(+q.nativeRate)&&+q.nativeRate>=70?'perf8-warn':'perf8-bad';
    $('p8QualitySub').textContent=`Native ${q.nativePosts??0} • Recovered ${q.recoveredPosts??0} • DB ${q.database||'—'}`;
    renderTable();renderRecent();
  }
  async function refresh(){
    try{const r=await fetch('/api/performance',{cache:'no-store'});if(!r.ok)throw new Error('HTTP '+r.status);data=await r.json();render()}catch(e){
      const q=$('p8QualitySub');if(q)q.textContent='Performance Engine belum tersedia: '+e.message;
    }
  }
  document.querySelectorAll('.perf8-tab').forEach(b=>b.addEventListener('click',()=>{
    document.querySelectorAll('.perf8-tab').forEach(x=>x.classList.remove('active'));b.classList.add('active');view=b.dataset.view;renderTable();
  }));
  try{
    const es=new EventSource('/events');
    es.addEventListener('performance',e=>{try{data=JSON.parse(e.data);render()}catch(_){}});
  }catch(_){}
  const h=document.querySelector('.brand h1');if(h)h.textContent='ZENCORE V8 — PRO ANALYSIS + PERFORMANCE TERMINAL';
  const phase=document.querySelector('.phase-pill');if(phase)phase.textContent='V8: ANALYSIS + PERFORMANCE';
  refresh();setInterval(refresh,15000);
})();
