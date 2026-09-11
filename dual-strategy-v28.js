(function(){
'use strict';
const q=id=>document.getElementById(id);
const U=v=>String(v||'').toUpperCase();
const N=v=>{const x=Number(v);return Number.isFinite(x)?x:null};
let mode='NORMAL',last='';

const css=
'#v28Strategies{margin:0 0 10px;border:1px solid #23475d;border-radius:14px;background:#061019;padding:10px}'+
'#v27Modes{display:none!important}#v26OppBar{display:none!important}'+
'.v28-head{display:flex;justify-content:space-between;gap:10px;align-items:center;margin-bottom:9px}.v28-head b{font:950 11px Inter,system-ui;color:#eef6fb}.v28-tabs{display:flex;gap:6px;flex-wrap:wrap}.v28-tab{border:1px solid #29475a;border-radius:9px;background:#07131d;color:#8ea4b5;padding:7px 10px;font:900 8px Inter,system-ui;cursor:pointer}.v28-tab.active{background:#0d2433;color:#fff;border-color:#4b7b98}'+
'.v28-grid{display:grid;grid-template-columns:1fr 1fr;gap:9px}.v28-card{border:1px solid #173447;border-radius:12px;background:#07131d;padding:11px}.v28-card.active{border-color:#477a98}.v28-card.good{border-color:#235c45}.v28-card.bad{border-color:#63313b}.v28-card .lab{font:850 7px Inter,system-ui;color:#71899d;text-transform:uppercase}.v28-card .main{display:block;margin-top:5px;font:950 18px Inter,system-ui;color:#ffbf58}.v28-card.good .main{color:#3be497}.v28-card.bad .main{color:#ff6878}.v28-card .sub{display:block;margin-top:5px;font:650 8.5px/1.4 Inter,system-ui;color:#91a6b6}.v28-kpis{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}.v28-kpis span{padding:5px 7px;border:1px solid #193447;border-radius:999px;background:#061019;color:#8ca1b1;font:850 7px Inter,system-ui}'+
'.v28-confirm{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}.v28-confirm b{padding:5px 7px;border-radius:8px;border:1px solid #29475a;color:#ffbf58;font:900 7px Inter,system-ui}.v28-confirm b.pass{color:#3be497;border-color:#235c45}.v28-note{margin-top:9px;padding:9px 10px;border:1px solid #224156;border-radius:10px;background:#081722;color:#c7d6e1;font:800 9px/1.45 Inter,system-ui}@media(max-width:800px){.v28-grid{grid-template-columns:1fr}.v28-head{align-items:flex-start;flex-direction:column}}';
const st=document.createElement('style');st.textContent=css;document.head.appendChild(st);

function ensure(){
  let e=q('v28Strategies');if(e)return e;
  e=document.createElement('section');e.id='v28Strategies';
  e.innerHTML='<div class="v28-head"><b>V28 — PILIH STRATEGI</b><div class="v28-tabs"><button class="v28-tab" id="v28FastBtn">⚡ FAST TRADE 1M</button><button class="v28-tab" id="v28NormalBtn">🧠 NORMAL SCALPING 3M</button></div></div>'+
  '<div class="v28-grid">'+
  '<div class="v28-card" id="v28FastCard"><span class="lab">⚡ FAST TRADE • TF1 MIN</span><b class="main" id="v28FastMain">WAIT</b><span class="sub" id="v28FastSub">Analysis, entry, TP dan SL semua dari 1m.</span><div class="v28-kpis"><span id="v28FastScore">Score —</span><span>Target 20–30 pips</span><span id="v28FastSL">SL —</span></div></div>'+
  '<div class="v28-card" id="v28NormalCard"><span class="lab">🧠 NORMAL SCALPING • TF3 MIN</span><b class="main" id="v28NormalMain">WAIT</b><span class="sub" id="v28NormalSub">3m utama + confirmation 1m/3m/5m.</span><div class="v28-kpis"><span id="v28NormalScore">Score —</span><span id="v28NormalCond">Condition —</span></div><div class="v28-confirm"><b id="v28C1">1M WAIT</b><b id="v28C3">3M WAIT</b><b id="v28C5">5M WAIT</b></div></div>'+
  '</div><div class="v28-note" id="v28Note">Normal Scalping dipilih. Sistem hanya bagi entry bila alignment cukup solid.</div>';
  const cockpit=q('v25Cockpit'),head=cockpit&&cockpit.querySelector('.v25-head');if(head)head.insertAdjacentElement('afterend',e);
  const fb=q('v28FastBtn'),nb=q('v28NormalBtn');if(fb)fb.onclick=()=>setMode('FAST');if(nb)nb.onclick=()=>setMode('NORMAL');return e;
}
function activeTrade(){const x=window.__ZENCORE_SECURE_STATE__;return !!x&&!['IDLE','CLOSED','STOP'].includes(U(x.state))}
function fmt(v,d=3){return N(v)==null?'—':Number(v).toFixed(d)}
function setMode(m){mode=m==='FAST'?'FAST':'NORMAL';window.__ZENCORE_STRATEGY_MODE__=mode;try{localStorage.setItem('zcStrategyMode',mode)}catch(_){}last='';paint();try{document.dispatchEvent(new CustomEvent('zencore:strategy-change'))}catch(_){}}
function restore(){try{mode=localStorage.getItem('zcStrategyMode')==='FAST'?'FAST':'NORMAL'}catch(_){mode='NORMAL'}window.__ZENCORE_STRATEGY_MODE__=mode}
function paintCard(card,state){if(!card)return;card.classList.remove('good','bad');if(state==='READY')card.classList.add('good');if(state==='PAUSE')card.classList.add('bad')}
function planToLevels(plan){
  if(activeTrade()||!plan)return;
  [['v25LiveEntry',plan.entry],['v25LiveSl',plan.sl],['v25LiveTp1',plan.tp1],['v25LiveTp2',plan.tp2],['v25LiveTp3',plan.tp3]].forEach(a=>{const e=q(a[0]);if(e)e.textContent=N(a[1])==null?'—':fmt(a[1])});
}
function confirm(id,label,v){const b=q(id);if(!b)return;b.textContent=label+' '+(v||'WAIT');b.classList.toggle('pass',v==='PASS')}
function paint(){
  const e=ensure(),p=window.__ZENCORE_PREDICTION_STATE__;if(!e||!p)return;
  const f=p.strategyFast||{},n=p.strategyNormal||{},sig=JSON.stringify([mode,f.state,f.side,f.score,f.plan,n.state,n.side,n.score,n.plan]);if(sig===last)return;last=sig;
  q('v28FastBtn').classList.toggle('active',mode==='FAST');q('v28NormalBtn').classList.toggle('active',mode==='NORMAL');q('v28FastCard').classList.toggle('active',mode==='FAST');q('v28NormalCard').classList.toggle('active',mode==='NORMAL');
  const fs=U(f.state),fside=U(f.side);
  q('v28FastMain').textContent=fs==='READY'?'FAST '+fside+' READY':fs==='WATCH'?'WATCH '+fside:fs==='PAUSE'?'FAST PAUSE':'FAST WAIT';
  q('v28FastSub').textContent=f.reason||'1m tunggu setup.';q('v28FastScore').textContent='Score '+Math.round(N(f.score)||0)+'/100';q('v28FastSL').textContent=f.plan&&f.plan.slPips?'SL '+f.plan.slPips+' pips':'SL dynamic';paintCard(q('v28FastCard'),fs);
  const ns=U(n.state),nside=U(n.side);
  q('v28NormalMain').textContent=ns==='READY'?'SOLID '+nside+' ENTRY':ns==='WATCH'?'WATCH '+nside:ns==='PAUSE'?'NORMAL PAUSE':ns==='WARMING'?'NORMAL WARMING':'NORMAL WAIT';
  q('v28NormalSub').textContent=n.reason||'3m tunggu confirmation.';q('v28NormalScore').textContent='Score '+Math.round(N(n.score)||0)+'/100';q('v28NormalCond').textContent=n.plan&&n.plan.condition?n.plan.condition:'Dynamic market plan';confirm('v28C1','1M',n.confirmations&&n.confirmations.m1);confirm('v28C3','3M',n.confirmations&&n.confirmations.m3);confirm('v28C5','5M',n.confirmations&&n.confirmations.m5);paintCard(q('v28NormalCard'),ns);
  const sel=mode==='FAST'?f:n;planToLevels(sel.plan);
  q('v28Note').innerHTML=mode==='FAST'?'<b>FAST 1M:</b> signal berdiri sendiri. Target pendek 20–30 pips. Bila choppy, sistem pause.':'<b>NORMAL 3M:</b> entry hanya bila 1m + 3m + 5m cukup sehala. TP/SL ikut volatility dan structure.';
  const brand=document.querySelector('header.top .brand h1');if(brand)brand.textContent='ZENCORE V28 — DUAL STRATEGY ENGINE';const phases=document.querySelectorAll('header.top .phase-pill');if(phases.length)phases[phases.length-1].textContent='FAST 1M • NORMAL 3M';
}
function init(){restore();setTimeout(()=>{ensure();paint()},1700);document.addEventListener('zencore:prediction-state',paint);document.addEventListener('zencore:flow-updated',paint);document.addEventListener('visibilitychange',()=>{if(!document.hidden)paint()})}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();