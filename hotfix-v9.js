(function(){
  'use strict';

  const NUM_KEYS=['time','barIndex','open','high','low','close','volume','ema9','ema20','ema50','hemaFast','hemaSlow','rsi','waveTrend1','waveTrend2','chopIndex','relativeVolume','globalTrend','setupProbability','confluenceStars','atr','bullObTop','bullObBottom','bearObTop','bearObBottom','entry','sl','tp1','tp2','tp3','mtf1','mtf2','mtf3','mtfTotal','marketPower'];
  const safeNum=v=>{
    if(v===null||v===undefined||v===''||v==='null'||v==='NaN')return null;
    const x=Number(v);return Number.isFinite(x)?x:null;
  };
  function sanitize(o){
    if(!o||typeof o!=='object')return o;
    for(const k of NUM_KEYS){
      if(Object.prototype.hasOwnProperty.call(o,k)){
        const v=safeNum(o[k]);
        if(v===null)delete o[k];else o[k]=v;
      }
    }
    return o;
  }
  function cleanGlobals(){
    try{
      if(typeof bars!=='undefined'&&Array.isArray(bars))bars.forEach(sanitize);
      if(typeof latest!=='undefined')sanitize(latest);
    }catch(_){}
  }

  const esc9=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  try{
    if(typeof renderAlertTape==='function'){
      renderAlertTape=function(){
        const el=document.getElementById('alertTape');if(!el)return;
        let rows=[];
        try{
          rows=(typeof zcAlerts!=='undefined'&&Array.isArray(zcAlerts)?zcAlerts:[])
            .filter(a=>!String(a?.message||'').trim().startsWith('{"schemaVersion":"8.0"'))
            .slice(-40).reverse();
        }catch(_){}
        el.innerHTML=rows.length?rows.map(a=>`<div style="padding:8px 0;border-bottom:1px solid #ffffff0c"><div style="font-size:9px;color:#7c8ea7">${new Date(a.time||Date.now()).toLocaleTimeString()}</div><div style="font-size:10px;line-height:1.45;margin-top:3px">${esc9(a.message)}</div></div>`).join(''):'<div class="muted">Belum ada aktiviti signal teks.</div>';
      };
    }
  }catch(_){}

  const css=`
  .v9-maturity{margin-top:8px;padding:10px 11px;border-radius:10px;border:1px solid #ffb74b35;background:#ffb74b08;font-size:9px;line-height:1.55;color:#cbb690}
  .v9-maturity.good{border-color:#32e38d44;background:#32e38d08;color:#a7dbc0}
  .v9-feed-stale{color:#ff6070!important}
  .v9-feed-fresh{color:#32e38d!important}
  `;
  const st=document.createElement('style');st.textContent=css;document.head.appendChild(st);

  function ensureMaturityBox(){
    const perf=document.getElementById('performanceV8');if(!perf)return null;
    let box=document.getElementById('v9Maturity');
    if(!box){
      box=document.createElement('div');box.id='v9Maturity';box.className='v9-maturity';
      const quality=perf.querySelector('.perf8-quality');
      if(quality)quality.insertAdjacentElement('afterend',box);else perf.appendChild(box);
    }
    return box;
  }

  async function updateHealth(){
    cleanGlobals();
    try{
      const [sr,pr]=await Promise.all([
        fetch('/api/status',{cache:'no-store'}),
        fetch('/api/performance',{cache:'no-store'})
      ]);
      const s=await sr.json(),p=await pr.json();

      const feed=document.getElementById('feed'),dot=document.getElementById('dot'),fresh=document.getElementById('fresh');
      const age=s.lastReceivedAt?Date.now()-Number(s.lastReceivedAt):Infinity;
      if(feed){
        if(age>180000){feed.textContent='PINE FEED STALE';feed.classList.add('v9-feed-stale');feed.classList.remove('v9-feed-fresh');}
        else{feed.textContent='PINE FEED LIVE';feed.classList.add('v9-feed-fresh');feed.classList.remove('v9-feed-stale');}
      }
      if(dot){dot.classList.toggle('off',age>180000);}
      if(fresh&&Number.isFinite(age)){
        const sec=Math.max(0,Math.floor(age/1000));
        fresh.textContent=sec<60?`Last ${sec}s ago`:sec<3600?`Last ${Math.floor(sec/60)}m ago`:`Last ${Math.floor(sec/3600)}h ago`;
      }

      const q=p.dataQuality||{};
      const qSub=document.getElementById('p8QualitySub'),qMain=document.getElementById('p8Quality');
      if(qSub)qSub.textContent=`Snapshot ${q.snapshotPosts??(q.nativePosts??0)+(q.recoveredPosts??0)} • Native ${q.nativePosts??0} • Recovered ${q.recoveredPosts??0} • Text alert ${q.textAlerts??'—'} • DB ${q.database||'—'}`;
      if(qMain&&Number.isFinite(+q.nativeRate))qMain.textContent=`${(+q.nativeRate).toFixed(1)}% NATIVE`;

      const sum=p.summary||{},box=ensureMaturityBox();
      if(box){
        const r=Number(sum.resolved||0),a=Number(sum.ambiguous||0),sp=Number(sum.superseded||0);
        if(r>=50){
          box.className='v9-maturity good';
          box.innerHTML=`<b>DATA PERFORMANCE SEDANG MEMBINA.</b> ${r} signal resolved. Ambiguous ${a} • Superseded ${sp}. Terus kumpul ke 200+ signal sebelum tuning agresif.`;
        }else{
          box.className='v9-maturity';
          box.innerHTML=`<b>DATA BELUM MATANG — ${r} signal resolved.</b> Win rate awal belum boleh digunakan untuk menilai sistem. Sasaran minimum 50–100, lebih baik 200+ signal. Ambiguous ${a} • Superseded ${sp}.`;
        }
      }

      const h=document.querySelector('.brand h1');if(h)h.textContent='ZENCORE V9 — PRO ANALYSIS INTELLIGENCE TERMINAL';
      const sub=document.querySelector('.brand .sub');if(sub)sub.textContent='Decision Engine • Signal Stability • No-Trade Shield • AI Coach Bahasa Malaysia • Performance Verification • Auto trade OFF';
      const phase=document.querySelector('.phase-pill');if(phase)phase.textContent='V9: ANALYSIS INTELLIGENCE';
    }catch(_){}
    try{ if(typeof drawChart==='function')drawChart(); }catch(_){}
    try{ if(typeof renderAlertTape==='function')renderAlertTape(); }catch(_){}
  }

  cleanGlobals();
  setTimeout(updateHealth,600);
  setInterval(updateHealth,10000);
})();