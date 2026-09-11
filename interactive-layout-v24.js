(function(){
'use strict';

const q=id=>document.getElementById(id);
const U=v=>String(v||'').toUpperCase();
const IDS=['v22Market','v22Position','v22Analysis','v22Prediction','v22TradePlan','v22Chart'];
let stateObs=null,viewObs=null;

const css=`
/* V24 mixed desktop dashboard */
#v22Flow{display:grid!important;grid-template-columns:repeat(12,minmax(0,1fr));gap:12px!important;align-items:start}
#v22Flow>.v22-flow-head,#v22Flow>.v22-legend,#v22Flow>#v23ActionBar{grid-column:1/-1;margin-bottom:0!important}
#v22Market{grid-column:1/span 5}
#v22Position{grid-column:6/span 7}
#v22Analysis{grid-column:1/span 6}
#v22Prediction{grid-column:7/span 6}
#v22TradePlan{grid-column:1/span 5}
#v22Chart{grid-column:6/span 7}
.v22-section{margin:0!important;content-visibility:auto;contain:layout style paint;contain-intrinsic-size:360px}
.v22-sh{grid-template-columns:42px minmax(0,1fr) auto 30px!important;cursor:pointer;transition:background .18s ease,transform .18s ease}
.v22-sh:hover{transform:translateY(-1px)}
.v24-toggle{width:28px;height:28px;border:1px solid #29475a;border-radius:8px;background:#07131d;color:#9cb0bf;font:900 14px Inter,system-ui;cursor:pointer;display:grid;place-items:center;transition:transform .2s ease,background .2s ease}
.v24-toggle:hover{background:#0c2130}.v24-collapsed .v24-toggle{transform:rotate(-90deg)}
.v24-collapsed>.v22-body{display:none!important}.v24-collapsed{contain-intrinsic-size:62px}
.v24-controls{display:flex;gap:6px;flex-wrap:wrap;margin-left:auto}
.v24-btn{border:1px solid #29475a;border-radius:9px;background:#07131d;color:#91a7b8;padding:6px 9px;font:900 8px Inter,system-ui;cursor:pointer}
.v24-btn:hover,.v24-btn.active{color:#e8f3fa;border-color:#3c6985;background:#0c2130}
.v24-live-chip{display:flex;align-items:center;gap:6px;padding:5px 8px;border:1px solid #29475a;border-radius:999px;background:#07131d;font:900 8px Inter,system-ui;color:#ffbf58}
.v24-live-chip.live{color:#3be497;border-color:#235c45}.v24-live-chip.bad{color:#ff6878;border-color:#63313b}
.v24-live-dot{width:7px;height:7px;border-radius:50%;background:currentColor;animation:v24Live 2.4s ease-in-out infinite}
@keyframes v24Live{0%,100%{opacity:.45;transform:scale(.85)}50%{opacity:1;transform:scale(1.18)}}

/* State-change burst only: transform/opacity, no animated shadows */
.v24-burst-good .v22-sh{animation:v24Good .72s ease 3}
.v24-burst-wait .v22-sh{animation:v24Wait .85s ease 2}
.v24-burst-bad .v22-sh{animation:v24Bad .48s ease 4}
@keyframes v24Good{0%,100%{transform:translateY(0)}50%{transform:translateY(-2px)}}
@keyframes v24Wait{0%,100%{opacity:.82}50%{opacity:1}}
@keyframes v24Bad{0%,100%{transform:translateX(0)}35%{transform:translateX(-2px)}70%{transform:translateX(2px)}}

/* Off-screen sections don't animate */
.v22-section:not(.v24-onview) .v23-icon,
.v22-section:not(.v24-onview) .v23-pill-dot,
.v22-section:not(.v24-onview) .v22-sh{animation-play-state:paused!important}

/* Keep chart comfortable */
#v22Chart .v22-body{padding:8px!important}
#v22Chart .v6-grid{grid-template-columns:1fr!important}
#v22Chart .v6-side{display:none!important}
#v22Chart .chartpanel{min-height:620px!important}
#v22Chart .chartwrap,#v22Chart #chart{min-height:520px!important}

/* Trade plan is action focused */
#v22TradePlan .v10-plan{grid-template-columns:1.15fr repeat(2,1fr)!important}
#v22TradePlan .v10-plan .v10-kpi:nth-child(5),
#v22TradePlan .v10-plan .v10-kpi:nth-child(6){display:none!important}

/* Responsive */
@media(max-width:1180px){
  #v22Market,#v22Position,#v22Analysis,#v22Prediction,#v22TradePlan,#v22Chart{grid-column:1/-1}
  #v22Flow{grid-template-columns:1fr!important}
  #v22Chart .chartpanel{min-height:660px!important}
}
@media(max-width:700px){
  .v22-sh{grid-template-columns:36px minmax(0,1fr) 28px!important}
  .v22-state{grid-column:1/-1!important;max-width:none!important}
  .v24-controls{width:100%;margin-left:0}
  .v22-flow-head{flex-wrap:wrap}
}
@media(prefers-reduced-motion:reduce){
  .v24-live-dot,.v24-burst-good .v22-sh,.v24-burst-wait .v22-sh,.v24-burst-bad .v22-sh{animation:none!important}
}
`;
const st=document.createElement('style');st.id='v24LayoutStyle';st.textContent=css;document.head.appendChild(st);

function toneOf(sec){
  if(sec.classList.contains('v22-bad'))return'bad';
  if(sec.classList.contains('v22-good'))return'good';
  return'wait';
}
function addControls(){
  const head=document.querySelector('#v22Flow>.v22-flow-head');if(!head||q('v24Controls'))return;
  const c=document.createElement('div');c.id='v24Controls';c.className='v24-controls';
  c.innerHTML='<div id="v24Live" class="v24-live-chip"><span class="v24-live-dot"></span><span>DATA —</span></div><button class="v24-btn" data-v24="compact">RINGKAS</button><button class="v24-btn" data-v24="open">BUKA SEMUA</button>';
  head.appendChild(c);
  c.addEventListener('click',e=>{
    const b=e.target.closest('[data-v24]');if(!b)return;
    const mode=b.dataset.v24;
    document.querySelectorAll('.v24-btn').forEach(x=>x.classList.toggle('active',x===b));
    if(mode==='compact'){
      ['v22Analysis','v22Chart'].forEach(id=>q(id)?.classList.add('v24-collapsed'));
      ['v22Market','v22Position','v22Prediction','v22TradePlan'].forEach(id=>q(id)?.classList.remove('v24-collapsed'));
      try{localStorage.setItem('zcV24Mode','compact')}catch(_){}
    }else{
      IDS.forEach(id=>q(id)?.classList.remove('v24-collapsed'));
      try{localStorage.setItem('zcV24Mode','open')}catch(_){}
    }
  });
}
function makeInteractive(sec){
  if(!sec||sec.dataset.v24Ready)return;
  sec.dataset.v24Ready='1';
  const h=sec.querySelector('.v22-sh');if(!h)return;
  const btn=document.createElement('button');btn.className='v24-toggle';btn.type='button';btn.setAttribute('aria-label','Buka atau tutup section');btn.textContent='▾';h.appendChild(btn);
  h.addEventListener('click',e=>{
    if(e.target.closest('.v22-state'))return;
    sec.classList.toggle('v24-collapsed');
  });
}
function applySavedMode(){
  let mode='';try{mode=localStorage.getItem('zcV24Mode')||''}catch(_){}
  if(mode==='compact'){
    ['v22Analysis','v22Chart'].forEach(id=>q(id)?.classList.add('v24-collapsed'));
  }
}
function burst(sec){
  const tone=toneOf(sec),cls='v24-burst-'+tone;
  sec.classList.remove('v24-burst-good','v24-burst-wait','v24-burst-bad');
  void sec.offsetWidth;
  sec.classList.add(cls);
  clearTimeout(sec._v24t);sec._v24t=setTimeout(()=>sec.classList.remove(cls),3000);
}
function watchStates(){
  if(stateObs)return;
  stateObs=new MutationObserver(list=>{
    const touched=new Set();
    list.forEach(m=>{const sec=m.target?.closest?.('.v22-section');if(sec)touched.add(sec)});
    touched.forEach(burst);
    updateLive();
  });
  IDS.forEach(id=>{const s=q(id),state=s?.querySelector('.v22-state');if(state)stateObs.observe(state,{subtree:true,childList:true,characterData:true})});
}
function watchViewport(){
  if(viewObs||!('IntersectionObserver'in window))return;
  viewObs=new IntersectionObserver(entries=>entries.forEach(en=>en.target.classList.toggle('v24-onview',en.isIntersecting)),{rootMargin:'100px 0px'});
  IDS.forEach(id=>{const s=q(id);if(s)viewObs.observe(s)});
}
function updateLive(){
  const chip=q('v24Live');if(!chip)return;
  const feed=T('feed'),u=U(feed);chip.classList.remove('live','bad');
  if(/LIVE/.test(u))chip.classList.add('live');else if(/OFFLINE|ERROR/.test(u))chip.classList.add('bad');
  const t=chip.querySelector('span:last-child');if(t)t.textContent=feed;
}
function T(id){return q(id)?.textContent?.trim()||'DATA —'}
function brand(){
  const h=document.querySelector('header.top .brand h1');if(h)h.textContent='ZENCORE V24 — INTERACTIVE TRADER DASHBOARD';
  const phases=document.querySelectorAll('header.top .phase-pill');if(phases.length)phases[phases.length-1].textContent='MIXED FLOW';
}
function init(){
  setTimeout(()=>{
    IDS.forEach(id=>makeInteractive(q(id)));
    addControls();applySavedMode();watchStates();watchViewport();updateLive();brand();
  },1400);
  document.addEventListener('zencore:flow-updated',()=>{updateLive();brand()});
  document.addEventListener('visibilitychange',()=>document.body.classList.toggle('zc-motion-paused',document.hidden));
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();