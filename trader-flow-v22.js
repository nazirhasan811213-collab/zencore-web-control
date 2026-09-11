(function(){
'use strict';

const q=id=>document.getElementById(id);
const T=id=>q(id)?.textContent?.trim()||'—';
const U=v=>String(v||'').toUpperCase();
let last='';

const css=`
#v22Flow{margin:12px 0 18px}.v22-flow-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px;padding:0 2px}.v22-flow-head b{font:950 14px Inter,system-ui;color:#eef6fb}.v22-flow-head span{font:700 8px Inter,system-ui;color:#71899e}
.v22-section{margin:0 0 12px;border:1px solid #1a394d;border-radius:16px;background:linear-gradient(145deg,#07131d,#061019);overflow:hidden;box-shadow:0 12px 28px #0003}
.v22-sh{display:grid;grid-template-columns:42px minmax(0,1fr) auto;gap:10px;align-items:center;padding:11px 13px;border-bottom:1px solid #173244;background:#091722}
.v22-num{width:34px;height:34px;border-radius:10px;display:grid;place-items:center;background:#10283a;border:1px solid #28506b;color:#9bd3ff;font:950 14px Inter,system-ui}
.v22-title b{display:block;font:950 12px Inter,system-ui;color:#edf6fb}.v22-title span{display:block;margin-top:3px;font:650 8.5px/1.35 Inter,system-ui;color:#8198aa}
.v22-state{max-width:270px;padding:6px 9px;border-radius:999px;border:1px solid #36536a;background:#07131d;color:#d5e5f1;font:900 9px Inter,system-ui;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.v22-body{padding:12px}.v22-summary{display:grid;grid-template-columns:1.3fr repeat(3,.7fr);gap:7px}.v22-big,.v22-mini{border:1px solid #173346;border-radius:11px;background:#061019;padding:10px;min-width:0}
.v22-big span,.v22-mini span{display:block;font:850 7px Inter,system-ui;color:#70889c;text-transform:uppercase;letter-spacing:.55px}.v22-big b{display:block;margin-top:5px;font:950 20px/1.08 Inter,system-ui;color:#ecf5fb}.v22-big small{display:block;margin-top:5px;font:650 9px/1.45 Inter,system-ui;color:#98acbc}.v22-mini b{display:block;margin-top:5px;font:900 12px Inter,system-ui;color:#dce9f2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.v22-buy .v22-state,.v22-buy .v22-big b{color:#3be497;border-color:#235c45}.v22-sell .v22-state,.v22-sell .v22-big b{color:#ff6878;border-color:#63313b}.v22-wait .v22-state,.v22-wait .v22-big b{color:#ffbf58;border-color:#685027}.v22-good .v22-state{color:#3be497;border-color:#235c45}.v22-bad .v22-state{color:#ff6878;border-color:#63313b}
.v22-slot>#v20Guard,.v22-slot>#v19Precision,.v22-slot>#v10Focus{margin:0!important}
body.zc-focus #v21Overview,body.zc-focus .v21-section-label{display:none!important}
body.zc-focus #v22Prediction #v19Precision .v19gates,body.zc-focus #v22Prediction #v19Precision .v19row,body.zc-focus #v22Prediction #v19Precision .v19elite{display:none!important}
body.zc-focus #v22Prediction #v19Precision .v19top{padding:10px!important}
body.zc-focus #v22Prediction #v19Precision .v19decision{font-size:20px!important}
body.zc-focus #v22TradePlan #v10Focus .v10-top{display:none!important}
body.zc-focus #v22TradePlan #v10Focus{border:0!important;background:transparent!important;box-shadow:none!important;padding:0!important}
body.zc-focus #v22Position #v20Guard{border:0!important;background:transparent!important;box-shadow:none!important;padding:0!important}
body.zc-focus #v22Chart .v6-grid{margin:0!important}
body.zc-focus #v22Chart .chartpanel{min-height:680px!important}
body.zc-focus #v22Chart .chartwrap,body.zc-focus #v22Chart #chart{min-height:540px!important}
@media(max-width:950px){.v22-summary{grid-template-columns:1fr 1fr}.v22-big{grid-column:1/-1}}
@media(max-width:650px){.v22-sh{grid-template-columns:36px 1fr}.v22-state{grid-column:1/-1;max-width:none}.v22-summary{grid-template-columns:1fr}.v22-big{grid-column:auto}.v22-big b{font-size:18px}}
`;
const st=document.createElement('style');st.id='v22Style';st.textContent=css;document.head.appendChild(st);

function section(id,num,title,desc){
  let e=q(id);if(e)return e;
  e=document.createElement('section');e.id=id;e.className='v22-section';
  e.innerHTML=`<div class="v22-sh"><div class="v22-num">${num}</div><div class="v22-title"><b>${title}</b><span>${desc}</span></div><div class="v22-state">TUNGGU DATA</div></div><div class="v22-body"><div class="v22-slot"></div></div>`;
  return e;
}
function summarySection(id,num,title,desc,html){
  const e=section(id,num,title,desc);const slot=e.querySelector('.v22-slot');if(slot&&!slot.dataset.ready){slot.innerHTML=html;slot.dataset.ready='1'}return e;
}
function root(){
  let r=q('v22Flow');if(r)return r;
  r=document.createElement('main');r.id='v22Flow';
  r.innerHTML='<div class="v22-flow-head"><b>ZENCORE — TRADER FLOW</b><span>Baca dari Step 1 sampai Step 6</span></div>';
  const h=document.querySelector('header.top');if(h)h.insertAdjacentElement('afterend',r);else document.body.prepend(r);
  return r;
}
function moveInto(slotId,node){
  const s=q(slotId)?.querySelector('.v22-slot');if(s&&node&&node.parentElement!==s)s.appendChild(node);
}
function build(){
  const r=root();
  const s1=summarySection('v22Market','1','MARKET SEKARANG','Soalan: market tengah buat apa sekarang?',`
    <div class="v22-summary"><div class="v22-big"><span>Keadaan Sekarang</span><b id="v22MarketMain">Tunggu data...</b><small id="v22MarketSub">ZenCore tengah baca market.</small></div><div class="v22-mini"><span>Price</span><b id="v22Price">—</b></div><div class="v22-mini"><span>Bias</span><b id="v22Bias">—</b></div><div class="v22-mini"><span>Data</span><b id="v22Feed">—</b></div></div>`);
  const s2=section('v22Position','2','POSITION SAYA','Soalan: position tengah okay, kena secure, atau kena close?');
  const s3=summarySection('v22Analysis','3','ANALYSIS SETUP','Soalan: setup masih kuat ke, atau dah mula lemah?',`
    <div class="v22-summary"><div class="v22-big"><span>Setup Sekarang</span><b id="v22AnaMain">Tunggu analysis...</b><small id="v22AnaSub">HEMA • Momentum • MTF • Structure</small></div><div class="v22-mini"><span>HEMA</span><b id="v22Hema">—</b></div><div class="v22-mini"><span>Momentum</span><b id="v22Mom">—</b></div><div class="v22-mini"><span>MTF</span><b id="v22Mtf">—</b></div></div>`);
  const s4=section('v22Prediction','4','NEXT MOVE','Soalan: lepas ni market lebih cenderung BUY, SELL atau WAIT?');
  const s5=section('v22TradePlan','5','TRADE PLAN','Soalan: kalau nak trade, entry mana, SL mana, target mana?');
  const s6=section('v22Chart','6','CHART CONFIRMATION','Soalan: chart confirm tak apa yang ZenCore cakap?');
  [s1,s2,s3,s4,s5,s6].forEach(x=>{if(x.parentElement!==r)r.appendChild(x)});
  moveInto('v22Position',q('v20Guard'));
  moveInto('v22Prediction',q('v19Precision'));
  moveInto('v22TradePlan',q('v10Focus'));
  moveInto('v22Chart',document.querySelector('.v6-grid'));
}
function setState(id,text,tone){
  const e=q(id);if(!e)return;
  e.classList.remove('v22-buy','v22-sell','v22-wait','v22-good','v22-bad');
  if(tone)e.classList.add('v22-'+tone);
  const s=e.querySelector('.v22-state');if(s)s.textContent=text;
}
function market(){
  const decision=T('v10Decision'),sub=T('v10DecisionSub'),sig=T('v10Signal'),price=T('price'),feed=T('feed');
  q('v22MarketMain').textContent=decision;q('v22MarketSub').textContent=sub;q('v22Price').textContent=price;q('v22Bias').textContent=sig;q('v22Feed').textContent=feed;
  const u=U(decision+' '+sig);setState('v22Market',/BUY/.test(u)?'BUY SIDE':/SELL/.test(u)?'SELL SIDE':'WAIT',/BUY/.test(u)?'buy':/SELL/.test(u)?'sell':'wait');
}
function analysis(){
  const hema=T('hema'),mom=T('momentum'),mtf=T('mtfo'),structure=T('structure');
  const vals=[hema,mom,mtf,structure].map(U);
  const buys=vals.filter(v=>/BUY|BULL|UP/.test(v)).length,sells=vals.filter(v=>/SELL|BEAR|DOWN/.test(v)).length;
  let main='SETUP CAMPUR-CAMPUR',tone='wait';
  if(buys>=3){main='BUY SETUP MASIH KUAT';tone='buy'}else if(sells>=3){main='SELL SETUP MASIH KUAT';tone='sell'}else if(/CHOP|SIDEWAYS/.test(U(structure))){main='MARKET SERABUT';tone='wait'}
  q('v22AnaMain').textContent=main;q('v22AnaSub').textContent=`Structure ${structure}`;q('v22Hema').textContent=hema;q('v22Mom').textContent=mom;q('v22Mtf').textContent=mtf;
  setState('v22Analysis',main,tone);
}
function position(){
  const g=q('v20Guard');const title=g?.querySelector('.v20action b')?.textContent?.trim()||'NO POSITION';
  const u=U(title);let tone='wait';
  if(/PROFIT|RUNNER|TP3/.test(u))tone='good';else if(/SL|ROSAK|CLOSE|CUT/.test(u))tone='bad';else if(/BUY/.test(u))tone='buy';else if(/SELL/.test(u))tone='sell';
  setState('v22Position',title,tone);
}
function prediction(){
  const p=q('v19Precision'),dec=p?.querySelector('.v19decision')?.textContent?.trim()||'WAIT';
  const u=U(dec);setState('v22Prediction',dec,/BUY/.test(u)?'buy':/SELL/.test(u)?'sell':'wait');
}
function plan(){
  const action=T('v10Coach'),ready=T('v10Readiness'),decision=T('v10Decision');
  const u=U(decision+' '+ready);setState('v22TradePlan',action!=='—'?action:ready,/BUY/.test(u)?'buy':/SELL/.test(u)?'sell':'wait');
}
function chart(){
  const feed=T('feed');setState('v22Chart',feed==='DATA LIVE'?'CHART LIVE':feed,feed==='DATA LIVE'?'good':'wait');
}
function paint(){
  if(document.hidden)return;build();
  const sig=[T('v10Decision'),T('v10Signal'),T('price'),T('feed'),T('hema'),T('momentum'),T('mtfo'),T('structure'),q('v20Guard')?.textContent,q('v19Precision')?.textContent,T('v10Coach')].join('|');
  if(sig===last)return;last=sig;
  market();position();analysis();prediction();plan();chart();
  const h=document.querySelector('header.top .brand h1');if(h)h.textContent='ZENCORE V22 — STEP-BY-STEP TRADER VIEW';
  const phases=document.querySelectorAll('header.top .phase-pill');if(phases.length)phases[phases.length-1].textContent='6-STEP FLOW';
}
function init(){document.body.classList.add('zc-v22');setTimeout(()=>{build();paint()},900);setInterval(paint,3000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)paint()})}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();