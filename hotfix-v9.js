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
    }catch(_){}
    try{ if(!document.hidden&&typeof renderAlertTape==='function')renderAlertTape(); }catch(_){}
  }

  cleanGlobals();
  setTimeout(updateHealth,600);
  setInterval(()=>{if(!document.hidden)updateHealth()},30000);
})();

(function(){
  'use strict';
  const css=`
  .v10-switch{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-left:auto}
  .v10-btn{border:1px solid #29405b;background:#09131f;color:#8fa6c1;padding:7px 11px;border-radius:9px;font-size:9px;font-weight:900;cursor:pointer}
  .v10-btn.active{border-color:#51a8ff88;background:#51a8ff16;color:#d9edff}
  .v10-focus{margin-top:10px;border:1px solid #29405b;background:linear-gradient(135deg,#0a1724,#071019);border-radius:16px;padding:12px;box-shadow:0 16px 44px #0004}
  .v10-top{display:grid;grid-template-columns:minmax(270px,1.4fr) repeat(4,minmax(100px,.55fr));gap:7px}
  .v10-decision,.v10-kpi{padding:10px;border:1px solid #203248;border-radius:11px;background:#07101a;min-width:0}
  .v10-decision{padding:12px}
  .v10-decision .eyebrow,.v10-kpi span{display:block;font-size:8px;color:#7188a2;text-transform:uppercase;letter-spacing:.55px}
  .v10-decision b{display:block;font-size:24px;line-height:1.08;margin-top:4px;color:#51a8ff}
  .v10-decision small{display:block;font-size:9px;color:#a8bbd1;line-height:1.4;margin-top:5px}
  .v10-kpi b{display:block;font-size:15px;margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .v10-plan{display:grid;grid-template-columns:1.35fr repeat(5,.72fr);gap:7px;margin-top:7px}
  .v10-plan .v10-kpi{background:#080f18}
  .v10-coach{margin-top:7px;display:grid;grid-template-columns:auto 1fr;gap:10px;align-items:center;padding:10px;border:1px solid #51a8ff35;background:#51a8ff09;border-radius:11px}
  .v10-coach-icon{width:38px;height:38px;border-radius:10px;background:#102137;display:grid;place-items:center;font-size:20px}
  .v10-coach b{font-size:10px;color:#8ec8ff}.v10-coach div div{font-size:10px;line-height:1.5;margin-top:3px;color:#d1dceb}
  .v10-shield{margin-top:7px;padding:8px 10px;border-radius:9px;border:1px solid #ffb74b35;background:#ffb74b08;font-size:9px;line-height:1.45;color:#d6c29d}
  body.zc-focus .v6-head,body.zc-focus #v7Pro,body.zc-focus #performanceV8,body.zc-focus .summary{display:none!important}
  body.zc-focus .v6-grid{grid-template-columns:minmax(0,1.7fr) minmax(310px,.68fr);margin-top:10px}
  body.zc-focus .v6-side>section:nth-of-type(3),body.zc-focus .v6-side>section:nth-of-type(4),body.zc-focus .v6-side>.auto-later{display:none!important}
  body.zc-focus .coach-v6{display:none!important}
  body.zc-focus .lower{display:none!important}
  body.zc-focus .chartwrap{min-height:590px}
  body.zc-focus #chart{min-height:590px}
  body.zc-focus .chartpanel{min-height:760px}
  body.zc-full .v10-focus{display:none!important}
  body.zc-performance .v10-focus,body.zc-performance .v6-grid,body.zc-performance .v6-head,body.zc-performance #v7Pro,body.zc-performance .summary,body.zc-performance .lower,body.zc-performance .coach-v6{display:none!important}
  body.zc-performance #performanceV8{display:block!important;margin-top:10px}
  @media(max-width:1200px){.v10-top{grid-template-columns:1.2fr repeat(2,1fr)}.v10-plan{grid-template-columns:repeat(3,1fr)}body.zc-focus .v6-grid{grid-template-columns:1fr}}
  @media(max-width:720px){.v10-top{grid-template-columns:1fr 1fr}.v10-decision{grid-column:1/-1}.v10-plan{grid-template-columns:1fr 1fr}.v10-coach{grid-template-columns:1fr}.v10-coach-icon{display:none}.v10-decision b{font-size:21px}}
  `;
  const style=document.createElement('style');style.id='v10FocusStyle';style.textContent=css;document.head.appendChild(style);
  const q=id=>document.getElementById(id),read=id=>q(id)?.textContent?.trim()||'—';
  function addSwitch(){
    const status=document.querySelector('.statuses');if(!status||q('v10Switch'))return;
    const w=document.createElement('div');w.className='v10-switch';w.id='v10Switch';
    w.innerHTML='<button class="v10-btn active" data-mode="focus">TRADER FOCUS</button><button class="v10-btn" data-mode="full">ANALISIS PENUH</button><button class="v10-btn" data-mode="performance">PERFORMANCE</button>';
    status.appendChild(w);w.addEventListener('click',e=>{const b=e.target.closest('[data-mode]');if(b)setMode(b.dataset.mode);});
  }
  function addFocus(){
    if(q('v10Focus'))return;const header=document.querySelector('header.top');if(!header)return;
    const s=document.createElement('section');s.id='v10Focus';s.className='v10-focus';
    s.innerHTML=`<div class="v10-top"><div class="v10-decision"><span class="eyebrow">Keputusan ZenCore Sekarang</span><b id="v10Decision">MENUNGGU ANALISIS</b><small id="v10DecisionSub">ZenCore sedang membaca keadaan pasaran.</small></div><div class="v10-kpi"><span>Signal</span><b id="v10Signal">—</b></div><div class="v10-kpi"><span>Stability</span><b id="v10Stability">—</b></div><div class="v10-kpi"><span>Entry Readiness</span><b id="v10Readiness">—</b></div><div class="v10-kpi"><span>Setup</span><b id="v10Grade">—</b></div></div><div class="v10-plan"><div class="v10-kpi"><span>Zon Entry</span><b id="v10Zone">—</b></div><div class="v10-kpi"><span>Entry</span><b id="v10Entry">—</b></div><div class="v10-kpi"><span>Stop Loss</span><b id="v10Sl">—</b></div><div class="v10-kpi"><span>TP1</span><b id="v10Tp1">—</b></div><div class="v10-kpi"><span>TP3</span><b id="v10Tp3">—</b></div><div class="v10-kpi"><span>R:R TP3</span><b id="v10RR">—</b></div></div><div class="v10-coach"><div class="v10-coach-icon">🧠</div><div><b>AI COACH — APA PERLU BUAT SEKARANG</b><div id="v10Coach">Menunggu analisis...</div></div></div><div class="v10-shield"><b id="v10Shield">NO-TRADE SHIELD MENILAI</b> <span id="v10ShieldReason">Tunggu data mencukupi.</span></div>`;
    header.insertAdjacentElement('afterend',s);
  }
  function setMode(mode){
    document.body.classList.remove('zc-focus','zc-full','zc-performance');document.body.classList.add(mode==='full'?'zc-full':mode==='performance'?'zc-performance':'zc-focus');
    document.querySelectorAll('#v10Switch .v10-btn').forEach(b=>b.classList.toggle('active',b.dataset.mode===mode));localStorage.setItem('zcViewMode',mode);
  }
  function paint(id,val,color){const e=q(id);if(!e)return;e.textContent=val||'—';if(color)e.style.color=color}
  function sync(){
    if(document.hidden)return;
    if(!window.__ZENCORE_DISPLAY_STATE_LOCK__){const decision=read('v6Decision');paint('v10Decision',decision,decision.includes('NO TRADE')?'#ff6070':decision.includes('ENTRY')?'#32e38d':decision.includes('URUS')?'#51a8ff':'#ffb74b');paint('v10DecisionSub',read('v6DecisionSub'));const sig=read('sumAction');paint('v10Signal',sig,sig.includes('LONG')||sig==='BUY'?'#32e38d':sig.includes('SHORT')||sig==='SELL'?'#ff6070':'#ffb74b');}
    const stab=read('v7Stability'),ready=read('v7Readiness');paint('v10Stability',stab,parseInt(stab)>=75?'#32e38d':parseInt(stab)>=55?'#ffb74b':'#ff6070');paint('v10Readiness',ready,parseInt(ready)>=75?'#32e38d':parseInt(ready)>=55?'#ffb74b':'#ff6070');paint('v10Grade',`${read('v6Grade')} • ${read('v6Score')}`);
    paint('v10Zone',read('zoneRange'),'#ffb74b');paint('v10Entry',read('entry'),'#ffb74b');paint('v10Sl',read('sl'),'#ff6070');paint('v10Tp1',read('tp1'),'#32e38d');paint('v10Tp3',read('tp3'),'#32e38d');paint('v10RR',read('rr3'));
    const action=read('v6CoachAction');paint('v10Coach',action!=='—'?action:read('v7Next'));
    const shield=read('v7ShieldTitle');paint('v10Shield',shield,shield.includes('AKTIF')?'#ff6070':shield.includes('BOLEH')?'#32e38d':'#ffb74b');paint('v10ShieldReason',read('v7ShieldReason'));
  }
  function label(){const h=document.querySelector('.brand h1');if(h)h.textContent='ZENCORE V10 — TRADER FOCUS ANALYSIS TERMINAL';const sub=document.querySelector('.brand .sub');if(sub)sub.textContent='Keputusan jelas • Chart ZenCore • Entry / SL / TP • AI Coach Bahasa Malaysia • Performance measured';const phase=document.querySelector('.phase-pill');if(phase)phase.textContent='V10: TRADER FOCUS';}
  function init(){addSwitch();addFocus();label();const saved=localStorage.getItem('zcViewMode');setMode(['full','performance'].includes(saved)?saved:'focus');sync();setInterval(sync,3000)}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(init,300));else setTimeout(init,300);
})();