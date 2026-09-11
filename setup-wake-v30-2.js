(function(){
'use strict';
const q=id=>document.getElementById(id);
const U=v=>String(v||'').toUpperCase();
let sleeping=null,lastSig='';

const css=`
#v302Standby{
  display:none;
  margin:0 0 12px;
  border:1px solid #28475b;
  border-radius:16px;
  background:linear-gradient(145deg,#07131d,#061019);
  padding:18px;
  box-shadow:0 12px 30px #0004
}
#v302Standby .v302-grid{
  display:grid;
  grid-template-columns:64px minmax(0,1.6fr) repeat(3,minmax(120px,.45fr));
  gap:10px;
  align-items:stretch
}
#v302Standby .v302-icon{
  display:grid;place-items:center;
  border:1px solid #24445a;border-radius:14px;
  background:#081722;font-size:30px
}
#v302Standby .v302-main,
#v302Standby .v302-kpi{
  border:1px solid #173447;border-radius:12px;
  background:#061019;padding:12px;min-width:0
}
#v302Standby span{
  display:block;
  font:850 7px Inter,system-ui;
  color:#71899d;
  text-transform:uppercase;
  letter-spacing:.65px
}
#v302Standby b{
  display:block;
  margin-top:6px;
  font:950 13px Inter,system-ui;
  color:#e5f0f7;
  white-space:nowrap;
  overflow:hidden;
  text-overflow:ellipsis
}
#v302Standby .v302-main b{
  font-size:22px;
  color:#ffbf58
}
#v302Standby small{
  display:block;
  margin-top:6px;
  font:700 9px/1.45 Inter,system-ui;
  color:#90a5b5
}
#v302Standby .v302-scan{
  margin-top:10px;height:4px;border-radius:999px;
  background:#102532;overflow:hidden
}
#v302Standby .v302-scan i{
  display:block;width:28%;height:100%;
  border-radius:inherit;background:#58b7e8;
  animation:v302Scan 2.8s ease-in-out infinite
}
@keyframes v302Scan{
  0%{transform:translateX(-110%)}
  50%{transform:translateX(260%)}
  100%{transform:translateX(-110%)}
}

body.zc-setup-sleep #v302Standby{display:block}
body.zc-setup-sleep #v23ActionBar,
body.zc-setup-sleep #v25Cockpit,
body.zc-setup-sleep #v22Market,
body.zc-setup-sleep #v22Position,
body.zc-setup-sleep #v22Analysis,
body.zc-setup-sleep #v22TradePlan,
body.zc-setup-sleep #v22Chart{
  display:none!important
}
body.zc-setup-sleep .v23-goodpulse,
body.zc-setup-sleep .v23-waitbreathe,
body.zc-setup-sleep .v23-badshake,
body.zc-setup-sleep .v23-float,
body.zc-setup-sleep .v23-arrowup,
body.zc-setup-sleep .v23-arrowdown,
body.zc-setup-sleep .v25-burst{
  animation:none!important
}
body.zc-setup-awake #v302Standby{display:none!important}

@media(max-width:900px){
  #v302Standby .v302-grid{grid-template-columns:54px 1fr 1fr}
  #v302Standby .v302-main{grid-column:2/-1}
}
@media(max-width:620px){
  #v302Standby .v302-grid{grid-template-columns:48px 1fr}
  #v302Standby .v302-main{grid-column:auto}
  #v302Standby .v302-kpi{grid-column:1/-1}
}
`;
const st=document.createElement('style');
st.id='v302WakeStyle';
st.textContent=css;
document.head.appendChild(st);

function ensure(){
  let e=q('v302Standby');if(e)return e;
  e=document.createElement('section');e.id='v302Standby';
  e.innerHTML=`
    <div class="v302-grid">
      <div class="v302-icon">🔍</div>
      <div class="v302-main">
        <span>SISTEM STANDBY</span>
        <b id="v302Title">TUNGGU SETUP ENTRY</b>
        <small id="v302Why">ZenCore tengah scan market. Panel akan aktif automatik bila setup entry valid muncul.</small>
        <div class="v302-scan"><i></i></div>
      </div>
      <div class="v302-kpi"><span>Strategi</span><b id="v302Mode">—</b></div>
      <div class="v302-kpi"><span>Price Live</span><b id="v302Price">—</b></div>
      <div class="v302-kpi"><span>Data Feed</span><b id="v302Feed">—</b></div>
    </div>`;
  const selector=q('v29StrategySwitch');
  if(selector)selector.insertAdjacentElement('afterend',e);
  else{
    const h=document.querySelector('header.top');
    if(h)h.insertAdjacentElement('afterend',e);
    else document.body.prepend(e);
  }
  return e;
}
function selected(){
  const p=window.__ZENCORE_PREDICTION_STATE__;
  const mode=window.__ZENCORE_STRATEGY_MODE__==='FAST'?'FAST':'NORMAL';
  return{mode,data:mode==='FAST'?p?.strategyFast:p?.strategyNormal};
}
function tradeActive(){
  const x=window.__ZENCORE_SECURE_STATE__;
  if(!x)return false;
  return !['IDLE','CLOSED','STOP'].includes(U(x.state));
}
function shouldWake(){
  if(tradeActive())return{wake:true,why:'Position sedang berjalan — panel management kekal aktif.'};
  const s=selected().data;
  const ready=U(s?.state)==='READY'&&!!s?.plan;
  if(ready)return{wake:true,why:'Setup entry dah READY dan trade plan dah lengkap.'};
  return{wake:false,why:s?.reason||'Belum ada setup entry valid.'};
}
function text(id,v){const e=q(id);if(e)e.textContent=v}
function paint(){
  const e=ensure(),sel=selected(),gate=shouldWake();
  const price=q('price')?.textContent?.trim()||'—';
  const feed=q('feed')?.textContent?.trim()||'—';
  const state=U(sel.data?.state||'WAIT');
  const sig=JSON.stringify([sel.mode,state,!!sel.data?.plan,tradeActive(),price,feed,gate.wake,gate.why]);
  if(sig===lastSig)return;lastSig=sig;

  sleeping=!gate.wake;
  document.body.classList.toggle('zc-setup-sleep',sleeping);
  document.body.classList.toggle('zc-setup-awake',!sleeping);

  text('v302Mode',sel.mode==='FAST'?'⚡ FAST TRADE 1M':'🧠 NORMAL SCALPING 3M');
  text('v302Price',price);
  text('v302Feed',feed);

  if(state==='PAUSE'){
    text('v302Title','MARKET TAK SESUAI — TUNGGU');
    text('v302Why',sel.data?.reason||'Market tengah serabut. Sistem tak aktifkan panel entry.');
  }else if(state==='COOLDOWN'){
    text('v302Title','TRADE SELESAI — TUNGGU SETUP BARU');
    text('v302Why',sel.data?.reason||'Jangan guna setup lama. Sistem tengah cari setup fresh.');
  }else if(state==='WARMING'){
    text('v302Title','ANALYSIS TENGAH WARMING');
    text('v302Why',sel.data?.reason||'Data belum cukup untuk setup entry.');
  }else if(state==='WATCH'){
    text('v302Title','SETUP BELUM CONFIRM');
    text('v302Why',sel.data?.reason||'Arah ada, tapi belum cukup solid untuk aktifkan panel entry.');
  }else{
    text('v302Title','TUNGGU SETUP ENTRY');
    text('v302Why',gate.why+' Panel akan aktif automatik bila setup READY.');
  }

  try{document.dispatchEvent(new CustomEvent('zencore:wake-state',{detail:{awake:!sleeping,mode:sel.mode,state}}))}catch(_){}
}
function init(){
  setTimeout(()=>{ensure();paint()},2200);
  document.addEventListener('zencore:prediction-state',paint);
  document.addEventListener('zencore:secure-state',paint);
  document.addEventListener('zencore:strategy-change',()=>{lastSig='';paint()});
  document.addEventListener('zencore:flow-updated',paint);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)paint()});
  setInterval(()=>{if(!document.hidden)paint()},3000);
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();