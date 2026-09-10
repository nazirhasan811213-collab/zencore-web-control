(function(){
  'use strict';

  const css = `
  :root{
    --v14-accent:#48ded7;
    --v14-accent-rgb:72,222,215;
    --v14-side:#8ec8ff;
    --v14-side-rgb:142,200,255;
    --v14-surface:#07111c;
    --v14-surface2:#0a1623;
    --v14-line:#1c3449;
  }
  body{
    background:
      radial-gradient(circle at 14% -8%,rgba(31,103,163,.22),transparent 28%),
      radial-gradient(circle at 88% 8%,rgba(var(--v14-accent-rgb),.055),transparent 28%),
      linear-gradient(180deg,#030810 0%,#05101a 48%,#03080e 100%)!important;
  }
  body[data-z-side="buy"]{--v14-side:#32e38d;--v14-side-rgb:50,227,141}
  body[data-z-side="sell"]{--v14-side:#ff6070;--v14-side-rgb:255,96,112}
  body[data-z-state="wait"]{--v14-accent:#ffb74b;--v14-accent-rgb:255,183,75}
  body[data-z-state="manage"]{--v14-accent:#48ded7;--v14-accent-rgb:72,222,215}
  body[data-z-state="complete"]{--v14-accent:#9b7cff;--v14-accent-rgb:155,124,255}
  body[data-z-state="risk"]{--v14-accent:#ff6070;--v14-accent-rgb:255,96,112}
  body[data-z-state="entry"]{--v14-accent:var(--v14-side);--v14-accent-rgb:var(--v14-side-rgb)}

  .wrap{max-width:1840px!important;padding:16px!important}
  .top{
    border-color:rgba(var(--v14-accent-rgb),.22)!important;
    background:linear-gradient(135deg,rgba(7,18,30,.94),rgba(4,10,17,.91))!important;
    box-shadow:0 18px 55px rgba(0,0,0,.36),inset 0 1px 0 rgba(255,255,255,.025)!important;
  }
  .logo{box-shadow:0 8px 26px rgba(81,168,255,.22),inset 0 1px 0 rgba(255,255,255,.18)}
  .brand h1{font-size:17px!important;letter-spacing:.15px}
  .brand .sub{margin-top:2px;line-height:1.4}
  .pill,.v10-btn,.charttab,.chip{
    backdrop-filter:blur(10px);
    box-shadow:inset 0 1px 0 rgba(255,255,255,.025);
  }
  .pill:hover,.v10-btn:hover,.charttab:hover,.chip:hover{border-color:rgba(var(--v14-accent-rgb),.5)!important}

  #v10Focus{
    position:relative;overflow:hidden;
    border-color:rgba(var(--v14-accent-rgb),.30)!important;
    background:
      radial-gradient(circle at 86% 0%,rgba(var(--v14-accent-rgb),.08),transparent 31%),
      linear-gradient(135deg,#091827 0%,#06111c 58%,#07121d 100%)!important;
    box-shadow:0 22px 60px rgba(0,0,0,.32),inset 0 1px 0 rgba(255,255,255,.03)!important;
  }
  #v10Focus:before{
    content:"";position:absolute;left:0;right:0;top:0;height:2px;
    background:linear-gradient(90deg,transparent,var(--v14-accent),transparent);opacity:.85;
  }
  .v10-decision,.v10-kpi,.v11-card{
    border-color:rgba(119,165,207,.16)!important;
    background:linear-gradient(180deg,rgba(8,20,33,.88),rgba(5,13,22,.94))!important;
    box-shadow:inset 0 1px 0 rgba(255,255,255,.022);
    transition:border-color .2s ease,transform .2s ease,background .2s ease;
  }
  .v10-kpi:hover,.v11-card:hover{border-color:rgba(var(--v14-accent-rgb),.36)!important;transform:translateY(-1px)}
  #v10Decision{font-size:27px!important;letter-spacing:-.35px;text-shadow:0 0 24px rgba(var(--v14-accent-rgb),.14)}
  #v10Signal{color:var(--v14-side)!important;text-shadow:0 0 18px rgba(var(--v14-side-rgb),.16)}
  #v10Stability,#v10Readiness,#v10Grade{font-size:16px!important}
  #v10Zone,#v10Entry{font-size:16px!important}
  #v10Sl{font-size:16px!important;color:#ff7180!important}
  #v10Tp1,#v10Tp3{font-size:16px!important;color:#48e9a1!important}
  .v10-coach{
    border-color:rgba(var(--v14-accent-rgb),.27)!important;
    background:linear-gradient(90deg,rgba(var(--v14-accent-rgb),.07),rgba(8,18,29,.78))!important;
  }
  .v10-coach-icon{border:1px solid rgba(var(--v14-accent-rgb),.22);box-shadow:0 0 24px rgba(var(--v14-accent-rgb),.08)}
  .v10-coach b{color:var(--v14-accent)!important;letter-spacing:.4px}

  #v11Manager{
    border-color:rgba(var(--v14-accent-rgb),.28)!important;
    background:linear-gradient(135deg,rgba(7,20,32,.96),rgba(5,13,22,.98))!important;
    box-shadow:inset 0 1px 0 rgba(255,255,255,.025),0 12px 34px rgba(0,0,0,.18)!important;
  }
  #v11Manager .v11-title{font-size:11px!important;letter-spacing:.65px}
  #v11Mode{border-color:rgba(var(--v14-accent-rgb),.45)!important;color:var(--v14-accent)!important;background:rgba(var(--v14-accent-rgb),.07)}
  #v11Bar{background:linear-gradient(90deg,var(--v14-side),var(--v14-accent))!important;box-shadow:0 0 14px rgba(var(--v14-accent-rgb),.20)}
  .v11-action{font-size:10.5px!important;padding:11px 12px!important}
  .v11-integrity{padding:9px 11px!important}

  .v14-life-step{
    min-height:28px!important;display:flex!important;align-items:center!important;justify-content:center!important;
    border-radius:8px!important;border:1px solid rgba(126,160,195,.15)!important;
    background:#07111c!important;color:#667d97!important;font-size:8px!important;font-weight:900!important;
    letter-spacing:.35px!important;transition:all .22s ease!important;
  }
  .v14-life-step.is-past{color:#7ba3ba!important;border-color:rgba(72,222,215,.19)!important;background:rgba(72,222,215,.035)!important}
  .v14-life-step.is-current{
    color:#fff!important;border-color:rgba(var(--v14-accent-rgb),.65)!important;
    background:rgba(var(--v14-accent-rgb),.12)!important;
    box-shadow:0 0 18px rgba(var(--v14-accent-rgb),.11),inset 0 1px 0 rgba(255,255,255,.05)!important;
    transform:translateY(-1px);
  }

  .v6-grid{gap:12px!important}
  .panel,.card,.sec,.perf8,.v7-pro{
    border-color:rgba(91,132,171,.20)!important;
    box-shadow:0 16px 44px rgba(0,0,0,.23),inset 0 1px 0 rgba(255,255,255,.02)!important;
  }
  .chartpanel{background:linear-gradient(180deg,#07121e 0%,#050d16 100%)!important}
  .charthead{padding-bottom:3px}
  .symbol{font-size:30px!important;letter-spacing:-.6px}
  .price{font-variant-numeric:tabular-nums}
  .charttoolbar{background:rgba(5,13,22,.72)!important;border-color:rgba(89,127,165,.17)!important}
  .chartwrap{
    border-color:rgba(72,222,215,.16)!important;
    box-shadow:inset 0 0 45px rgba(0,0,0,.22),0 14px 40px rgba(0,0,0,.17)!important;
  }
  .chartlegend .lg{backdrop-filter:blur(9px);border-color:rgba(255,255,255,.08)!important}
  .executionstrip{gap:7px!important}
  .execbox{background:linear-gradient(180deg,#07131f,#050d16)!important;border-color:rgba(99,139,177,.18)!important}

  .v6-side .sec,.entrybox{background:linear-gradient(180deg,#081521,#06101a)!important}
  .gate{transition:transform .18s ease,border-color .18s ease}.gate:hover{transform:translateX(2px)}
  .gate.pass{border-color:rgba(50,227,141,.23)!important}.gate.fail{border-color:rgba(255,96,112,.22)!important}.gate.warn{border-color:rgba(255,183,75,.23)!important}
  .entrybox{border-color:rgba(255,183,75,.30)!important;box-shadow:inset 0 1px 0 rgba(255,255,255,.02)}
  .zone{letter-spacing:-.25px}
  .rail{height:6px!important;background:#101d2c!important}
  .level{margin:7px 0!important}

  .v10-btn.active{border-color:rgba(var(--v14-accent-rgb),.62)!important;background:rgba(var(--v14-accent-rgb),.10)!important;color:#fff!important;box-shadow:0 0 16px rgba(var(--v14-accent-rgb),.08)}
  .charttab.active{border-color:rgba(var(--v14-accent-rgb),.55)!important;background:rgba(var(--v14-accent-rgb),.10)!important}

  #feed{font-weight:900;letter-spacing:.2px}
  .dot:not(.off){animation:v14Pulse 2.4s ease-in-out infinite}
  @keyframes v14Pulse{0%,100%{box-shadow:0 0 8px currentColor}50%{box-shadow:0 0 16px currentColor,0 0 0 4px rgba(50,227,141,.05)}}
  @media(prefers-reduced-motion:reduce){.dot:not(.off){animation:none}.v10-kpi,.v11-card,.gate{transition:none!important}}

  @media(max-width:900px){
    .wrap{padding:8px!important}
    #v10Decision{font-size:23px!important}
    .v14-life-step{font-size:7px!important;min-height:26px!important}
  }
  `;

  const style=document.createElement('style');
  style.id='zencoreV14Visual';
  style.textContent=css;
  document.head.appendChild(style);

  const $=id=>document.getElementById(id);
  const text=id=>($(id)?.textContent||'').trim().toUpperCase();
  const stages=['PRE-ENTRY','ENTRY','ACTIVE','PROTECT','PARTIAL','RUNNER','COMPLETE','COOLDOWN'];

  function lifecycleStage(){
    const s=[text('v11Status'),text('v11Mode'),text('v10Decision')].join(' ');
    if(/COOLDOWN|STOPPED|INVALIDATED|\bSL\b/.test(s)) return 'COOLDOWN';
    if(/COMPLETE|TP3/.test(s)) return 'COMPLETE';
    if(/RUNNER/.test(s)) return 'RUNNER';
    if(/PARTIAL|TP1/.test(s) && /PROTECT|PARTIAL/.test(s)) return 'PARTIAL';
    if(/PROTECT|BREAKEVEN|BE \/|PROFIT BERKEMBANG/.test(s)) return 'PROTECT';
    if(/HOLD PLAN|POSITION MANAGEMENT|POSISI .*AKTIF|URUS POSISI/.test(s)) return 'ACTIVE';
    if(/ENTRY .*SEDIA|TIMING KUAT|DALAM ZON/.test(s)) return 'ENTRY';
    return 'PRE-ENTRY';
  }

  function decorateLifecycle(){
    const host=$('v11Manager'); if(!host)return;
    const current=lifecycleStage();
    const ci=Math.max(0,stages.indexOf(current));
    host.querySelectorAll('*').forEach(el=>{
      const t=(el.textContent||'').trim().toUpperCase();
      if(!stages.includes(t))return;
      el.classList.add('v14-life-step');
      const i=stages.indexOf(t);
      el.classList.toggle('is-current',i===ci);
      el.classList.toggle('is-past',i<ci);
    });
  }

  function syncState(){
    const signal=[text('v10Signal'),text('sumAction')].join(' ');
    const side=/SELL|SHORT/.test(signal)?'sell':/BUY|LONG/.test(signal)?'buy':'neutral';
    document.body.dataset.zSide=side;

    const decision=[text('v10Decision'),text('v11Status'),text('v11Mode')].join(' ');
    let state='wait';
    if(/COMPLETE|TP3 COMPLETE|TRADE COMPLETE/.test(decision))state='complete';
    else if(/INVALIDATED|STOPPED|DEKAT INVALIDATION|RISIKO MENINGKAT|LEVEL MISMATCH/.test(decision))state='risk';
    else if(/POSITION MANAGEMENT|URUS POSISI|HOLD PLAN|PROTECT|RUNNER|POSISI .*AKTIF/.test(decision))state='manage';
    else if(/ENTRY .*SEDIA|TIMING KUAT|DALAM ZON/.test(decision))state='entry';
    document.body.dataset.zState=state;

    const h=document.querySelector('.brand h1');
    if(h)h.textContent='ZENCORE V14 — VISUAL INTELLIGENCE TERMINAL';
    const sub=document.querySelector('.brand .sub');
    if(sub)sub.textContent='Trader Focus • AI Trade Lifecycle • Dynamic Market State • Entry / SL / TP • Performance measured';
    const phase=document.querySelector('.phase-pill');
    if(phase)phase.textContent='V14: VISUAL INTELLIGENCE';

    decorateLifecycle();
  }

  let queued=false;
  const schedule=()=>{if(queued)return;queued=true;requestAnimationFrame(()=>{queued=false;syncState()})};
  const obs=new MutationObserver(schedule);
  function init(){
    syncState();
    obs.observe(document.body,{subtree:true,childList:true,characterData:true});
    setInterval(syncState,3000);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(init,600));
  else setTimeout(init,600);
})();
