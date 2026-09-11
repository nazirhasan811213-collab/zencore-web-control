(function(){
'use strict';

const q=id=>document.getElementById(id);
const U=v=>String(v||'').toUpperCase();
const T=id=>q(id)?.textContent?.trim()||'—';
let lastSig='';

const ICONS={
  v22Market:{base:'📡',good:'📡',wait:'👀',bad:'⚠️'},
  v22Position:{base:'🛡️',good:'💰',wait:'🛡️',bad:'🚪'},
  v22Analysis:{base:'🔥',good:'✅',wait:'⏳',bad:'⚠️'},
  v22Prediction:{base:'🔮',good:'🎯',wait:'🔮',bad:'🚫'},
  v22TradePlan:{base:'🎯',good:'🎯',wait:'⏳',bad:'🛑'},
  v22Chart:{base:'📈',good:'📈',wait:'⏱️',bad:'⚠️'}
};

const css=`
#v23ActionBar{margin:0 0 12px;border:1px solid #244a61;border-radius:16px;background:linear-gradient(135deg,#081722,#061019);padding:12px;box-shadow:0 12px 30px #0004;overflow:hidden;position:relative}
#v23ActionBar:before{content:'';position:absolute;inset:0 auto 0 0;width:4px;background:#ffbf58}
#v23ActionBar.good:before{background:#3be497}#v23ActionBar.bad:before{background:#ff6878}
.v23-action-grid{display:grid;grid-template-columns:52px minmax(0,1.4fr) repeat(3,minmax(110px,.55fr));gap:9px;align-items:stretch}
.v23-orb{display:grid;place-items:center;border:1px solid #234157;border-radius:13px;background:#07131d;font-size:26px;min-height:64px;will-change:transform}
.v23-copy,.v23-kpi{border:1px solid #173246;border-radius:12px;background:#061019;padding:10px;min-width:0}
.v23-copy span,.v23-kpi span{display:block;font:850 7px Inter,system-ui;color:#71899d;text-transform:uppercase;letter-spacing:.65px}
.v23-copy b{display:block;margin-top:5px;font:950 22px/1.06 Inter,system-ui;color:#ffbf58}.v23-copy small{display:block;margin-top:5px;font:650 9px/1.4 Inter,system-ui;color:#9eb0be}
.v23-kpi b{display:block;margin-top:6px;font:900 12px Inter,system-ui;color:#e1edf5;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#v23ActionBar.good .v23-copy b{color:#3be497}#v23ActionBar.bad .v23-copy b{color:#ff6878}
.v23-icon{display:inline-grid;place-items:center;width:28px;height:28px;margin-right:7px;border-radius:9px;background:#0b1c29;border:1px solid #24475e;font-size:15px;vertical-align:middle;will-change:transform}
.v22-title b{display:flex!important;align-items:center!important}
.v23-pill-dot{display:inline-block;width:7px;height:7px;border-radius:50%;margin-right:5px;background:#ffbf58;vertical-align:middle}
.v22-good .v23-pill-dot{background:#3be497}.v22-bad .v23-pill-dot{background:#ff6878}
.v23-goodpulse{animation:v23Pulse 2.8s ease-in-out 3}.v23-waitbreathe{animation:v23Breathe 3.4s ease-in-out 2}.v23-badshake{animation:v23Shake 1.6s ease-in-out 3}.v23-float{animation:v23Float 3.2s ease-in-out 2}.v23-arrowup{animation:v23ArrowUp 1.8s ease-in-out 3}.v23-arrowdown{animation:v23ArrowDown 1.8s ease-in-out 3}
@keyframes v23Pulse{0%,100%{transform:scale(1);opacity:.88}50%{transform:scale(1.08);opacity:1}}
@keyframes v23Breathe{0%,100%{transform:scale(.98);opacity:.72}50%{transform:scale(1.04);opacity:1}}
@keyframes v23Shake{0%,84%,100%{transform:translateX(0)}88%{transform:translateX(-2px)}92%{transform:translateX(2px)}96%{transform:translateX(-1px)}}
@keyframes v23Float{0%,100%{transform:translateY(0)}50%{transform:translateY(-3px)}}
@keyframes v23ArrowUp{0%,100%{transform:translateY(2px)}50%{transform:translateY(-3px)}}
@keyframes v23ArrowDown{0%,100%{transform:translateY(-2px)}50%{transform:translateY(3px)}}
.zc-motion-paused *{animation-play-state:paused!important}
@media(max-width:900px){.v23-action-grid{grid-template-columns:46px 1fr 1fr}.v23-copy{grid-column:2/-1}}
@media(max-width:620px){.v23-action-grid{grid-template-columns:42px 1fr}.v23-copy{grid-column:auto}.v23-kpi{grid-column:1/-1}.v23-copy b{font-size:18px}}
@media(prefers-reduced-motion:reduce){.v23-goodpulse,.v23-waitbreathe,.v23-badshake,.v23-float,.v23-arrowup,.v23-arrowdown{animation:none!important}}
`;
const st=document.createElement('style');st.id='v23MotionStyle';st.textContent=css;document.head.appendChild(st);

function ensureActionBar(){
  let e=q('v23ActionBar');if(e)return e;
  e=document.createElement('section');e.id='v23ActionBar';e.className='wait';
  e.innerHTML=`
    <div class="v23-action-grid">
      <div class="v23-orb v23-waitbreathe" id="v23Orb">👀</div>
      <div class="v23-copy"><span>APA NAK BUAT SEKARANG</span><b id="v23Action">TUNGGU DULU</b><small id="v23Why">ZenCore tengah baca market.</small></div>
      <div class="v23-kpi"><span>POSITION</span><b id="v23Pos">—</b></div>
      <div class="v23-kpi"><span>NEXT MOVE</span><b id="v23Next">—</b></div>
      <div class="v23-kpi"><span>DATA</span><b id="v23Data">—</b></div>
    </div>`;
  const flow=q('v22Flow');if(flow){const head=flow.querySelector('.v22-flow-head'),legend=flow.querySelector('.v22-legend');(legend||head)?.insertAdjacentElement('afterend',e)}
  return e;
}
function semantic(section){
  if(!section)return'wait';
  if(section.classList.contains('v22-bad'))return'bad';
  if(section.classList.contains('v22-good'))return'good';
  return'wait';
}
function decorateSection(id){
  const s=q(id);if(!s)return;
  const title=s.querySelector('.v22-title b'),state=s.querySelector('.v22-state');if(!title||!state)return;
  const tone=semantic(s),cfg=ICONS[id]||ICONS.v22Market;
  let icon=title.querySelector('.v23-icon');
  if(!icon){icon=document.createElement('span');icon.className='v23-icon';title.prepend(icon)}
  icon.textContent=cfg[tone]||cfg.base;
  icon.className='v23-icon '+(tone==='good'?'v23-goodpulse':tone==='bad'?'v23-badshake':'v23-waitbreathe');
  if(id==='v22Prediction'){
    const u=U(state.textContent);
    if(/BUY/.test(u)){icon.textContent='⬆️';icon.className='v23-icon v23-arrowup'}
    else if(/SELL/.test(u)){icon.textContent='⬇️';icon.className='v23-icon v23-arrowdown'}
    else {icon.textContent='🔮';icon.className='v23-icon v23-float'}
  }
  if(!state.querySelector('.v23-pill-dot')){
    const dot=document.createElement('span');dot.className='v23-pill-dot';state.prepend(dot);
  }
}
function deriveAction(){
  const posTitle=q('v20Guard')?.querySelector('.v20action b')?.textContent?.trim()||'';
  const posMsg=q('v20Guard')?.querySelector('.v20action small')?.textContent?.trim()||'';
  const posBadge=q('v20Guard')?.querySelector('.v20badge')?.textContent?.trim()||'';
  const decision=T('v10Decision'),coach=T('v10Coach'),feed=T('feed');
  const pred=q('v19Precision')?.querySelector('.v19decision')?.textContent?.trim()||'WAIT';
  const all=U([posTitle,posBadge,decision,coach].join(' '));
  let tone='wait',action='TUNGGU DULU',why=coach!=='—'?coach:'Tunggu setup yang betul-betul cun.',orb='👀';
  if(/TP3 SETTLE|TRADE COMPLETE/.test(all)){tone='good';action='TUNGGU SETUP BARU';why='TP3 dah settle. Jangan kejar market; tunggu setup fresh.';orb='✅';}else if(/SL KENA|SETUP DAH ROSAK|CLOSE POSITION|CLOSE \/ CUT|CUT EARLY/.test(all)){
    tone='bad';action=/SL KENA/.test(all)?'TRADE DAH CLOSED':'CLOSE / CUT';why=posMsg||coach;orb='🚪';
  }else if(/CLOSE SEPARUH|MOMENTUM DAH SLOW/.test(all)){
    tone='wait';action='BOLEH CLOSE SEPARUH';why=posMsg||'Momentum dah slow, secure sikit profit.';orb='✂️';
  }else if(/SECURE POSITION|PROFIT BOCOR/.test(all)){
    tone='wait';action='SECURE POSITION';why=posMsg||'Pullback kuat, jaga profit dulu.';orb='🛡️';
  }else if(/HOLD RUNNER|RUNNER MASIH CUN|SETUP DAH PROFIT|BUY RUNNING|SELL RUNNING/.test(all)){
    tone='good';action=/RUNNER/.test(all)?'HOLD RUNNER':'HOLD & JAGA PROFIT';why=posMsg||coach;orb='💰';
  }else if(/BUY DAH CUN|SELL DAH CUN|CARI ENTRY|ENTRY .*CONFIRMED/.test(all)){
    tone='good';action='BOLEH CARI ENTRY';why=coach!=='—'?coach:'Setup dah confirm. Entry ikut plan.';orb='🎯';
  }else if(/TAK PAYAH MASUK|NO TRADE|MARKET SERABUT|R:R TAK CUN/.test(all)){
    tone='bad';action='SKIP / JANGAN MASUK';why=coach!=='—'?coach:'Setup tak cukup cantik untuk entry.';orb='🚫';
  }else if(/BELUM CONFIRM|TUNGGU|WAIT|POTENSI|POTENTIAL/.test(all)){
    tone='wait';action='TUNGGU CONFIRM';why=coach!=='—'?coach:'Bias ada, tapi entry belum ready.';orb='⏳';
  }
  return{tone,action,why,orb,pos:posTitle||T('v10Signal'),pred,feed};
}
function paint(){
  if(document.hidden)return;
  const bar=ensureActionBar();['v22Market','v22Position','v22Analysis','v22Prediction','v22TradePlan','v22Chart'].forEach(decorateSection);
  const x=deriveAction();
  const sig=JSON.stringify(x);if(sig===lastSig)return;lastSig=sig;
  bar.className=x.tone;
  q('v23Action').textContent=x.action;q('v23Why').textContent=x.why;q('v23Pos').textContent=x.pos;q('v23Next').textContent=x.pred;q('v23Data').textContent=x.feed;
  const orb=q('v23Orb');orb.textContent=x.orb;orb.className='v23-orb '+(x.tone==='good'?'v23-goodpulse':x.tone==='bad'?'v23-badshake':'v23-waitbreathe');
  const h=document.querySelector('header.top .brand h1');if(h)h.textContent='ZENCORE V23 — SMART MOTION TRADER VIEW';
  const phases=document.querySelectorAll('header.top .phase-pill');if(phases.length)phases[phases.length-1].textContent='SMART MOTION';
}
function init(){
  setTimeout(()=>{ensureActionBar();paint()},1100);
  document.addEventListener('zencore:flow-updated',paint);
  document.addEventListener('visibilitychange',()=>{document.body.classList.toggle('zc-motion-paused',document.hidden);if(!document.hidden)paint()});
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();