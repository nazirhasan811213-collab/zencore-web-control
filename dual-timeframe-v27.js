(function(){
'use strict';
const q=id=>document.getElementById(id);
const U=v=>String(v||'').toUpperCase();
const N=v=>{const x=Number(v);return Number.isFinite(x)?x:null};
let mode='ANALYSIS',lastSig='';

const css=`
#v27Modes{margin:0 0 10px;border:1px solid #23475d;border-radius:14px;background:#061019;padding:10px}
.v27-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:9px}.v27-head b{font:950 11px Inter,system-ui;color:#e7f1f7}.v27-tabs{display:flex;gap:6px;flex-wrap:wrap}
.v27-tab{border:1px solid #29475a;border-radius:9px;background:#07131d;color:#8da3b4;padding:7px 10px;font:900 8px Inter,system-ui;cursor:pointer}.v27-tab.active{color:#eef8fd;border-color:#4a7994;background:#0d2433}
.v27-grid{display:grid;grid-template-columns:1fr 1fr;gap:9px}.v27-card{border:1px solid #173447;border-radius:12px;background:#07131d;padding:11px;min-width:0;transition:border-color .18s ease,transform .18s ease}.v27-card.active{border-color:#3e6f8d;transform:translateY(-1px)}
.v27-card .lab{display:block;font:850 7px Inter,system-ui;color:#71899d;text-transform:uppercase;letter-spacing:.65px}.v27-card .main{display:block;margin-top:5px;font:950 19px/1.05 Inter,system-ui;color:#ffbf58}.v27-card .sub{display:block;margin-top:5px;font:650 8.5px/1.4 Inter,system-ui;color:#91a6b6}
.v27-kpis{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}.v27-kpis span{padding:5px 7px;border:1px solid #193447;border-radius:999px;background:#061019;color:#8ca1b1;font:850 7px Inter,system-ui}
.v27-card.good .main{color:#3be497}.v27-card.bad .main{color:#ff6878}.v27-card.wait .main{color:#ffbf58}
.v27-advice{margin-top:9px;padding:9px 10px;border:1px solid #224156;border-radius:10px;background:#081722;color:#c8d7e2;font:800 9px/1.4 Inter,system-ui}.v27-advice b{color:#fff}
.v27-target{color:#3be497!important}
@media(max-width:800px){.v27-grid{grid-template-columns:1fr}.v27-head{align-items:flex-start;flex-direction:column}}
`;
const st=document.createElement('style');st.textContent=css;document.head.appendChild(st);

function ensure(){
  let e=q('v27Modes');if(e)return e;
  e=document.createElement('section');e.id='v27Modes';
  e.innerHTML=`
    <div class="v27-head"><b>V27 — DUAL TIMEFRAME SIGNAL</b><div class="v27-tabs"><button class="v27-tab" id="v27AnalysisBtn">🧠 ANALYSIS 3 MIN</button><button class="v27-tab" id="v27FastBtn">⚡ FAST TRADE 1 MIN</button></div></div>
    <div class="v27-grid">
      <div class="v27-card wait" id="v27AnalysisCard"><span class="lab">🧠 Arah Utama • 3 Min Confirmed</span><b class="main" id="v27AnalysisMain">3M WARMING</b><span class="sub" id="v27AnalysisSub">3m tentukan arah supaya signal tak flip terlalu cepat.</span><div class="v27-kpis"><span id="v27AConf">Confidence —</span><span id="v27AChop">Chop —</span><span id="v27ABars">Bars —</span></div></div>
      <div class="v27-card wait" id="v27FastCard"><span class="lab">⚡ Entry Timing • 1 Min</span><b class="main" id="v27FastMain">FAST WAIT</b><span class="sub" id="v27FastSub">1m hanya cari entry sehala dengan 3m.</span><div class="v27-kpis"><span id="v27FScore">Score —</span><span id="v27FTarget">Target 20 pips</span><span id="v27FPrice">Target Price —</span></div></div>
    </div>
    <div class="v27-advice" id="v27Advice"><b>Mode Analysis 3m:</b> tunggu arah 3m clear dulu.</div>`;
  const cockpit=q('v25Cockpit'),head=cockpit?.querySelector('.v25-head');
  if(head)head.insertAdjacentElement('afterend',e);
  q('v27AnalysisBtn')?.addEventListener('click',()=>setMode('ANALYSIS'));
  q('v27FastBtn')?.addEventListener('click',()=>setMode('FAST'));
  return e;
}
function setMode(m){
  mode=m==='FAST'?'FAST':'ANALYSIS';
  try{localStorage.setItem('zcV27Mode',mode)}catch(_){}
  paint();
}
function restore(){
  try{mode=localStorage.getItem('zcV27Mode')==='FAST'?'FAST':'ANALYSIS'}catch(_){mode='ANALYSIS'}
}
function toneCard(e,t){if(!e)return;e.classList.remove('good','bad','wait','active');e.classList.add(t||'wait');}
function fmt(v,d=1){return N(v)==null?'—':Number(v).toFixed(d)}
function secureActive(){
  const s=window.__ZENCORE_SECURE_STATE__;return !!s&& !['IDLE','CLOSED','STOP'].includes(U(s.state));
}
function updateTopAction(a3,fast){
  if(secureActive())return;
  const action=q('v23Action'),why=q('v23Why'),orb=q('v23Orb');if(!action||!why)return;
  if(mode==='ANALYSIS'){
    if(a3?.sideways){action.textContent='JANGAN TRADE — 3M SIDEWAYS';why.textContent=a3.reason||'Tunggu market clear.';if(orb)orb.textContent='⚠️';}
    else if(U(a3?.bias)==='BUY'||U(a3?.bias)==='SELL'){action.textContent=`3M ${U(a3.bias)} — TUNGGU 1M ENTRY`;why.textContent='Arah utama dah clear. Jangan lawan bias 3m.';if(orb)orb.textContent='🧠';}
    else{action.textContent='TUNGGU 3M CLEAR';why.textContent='Belum ada arah 3m yang cukup stabil.';if(orb)orb.textContent='⏳';}
  }else{
    if(U(fast?.state)==='READY'){action.textContent=`FAST ${U(fast.side)} READY`;why.textContent=`Target scalp 20 pips sekitar ${fmt(fast.targetPrice,3)}. Ikut risk management.`;if(orb)orb.textContent='⚡';}
    else if(U(fast?.state)==='WATCH'){action.textContent=`WATCH FAST ${U(fast.side)}`;why.textContent=fast.reason||'Tunggu trigger 1m.';if(orb)orb.textContent='👀';}
    else if(U(fast?.state)==='PAUSE'){action.textContent='FAST TRADE PAUSE';why.textContent=fast.reason||'Market tak sesuai untuk scalp.';if(orb)orb.textContent='🛑';}
    else{action.textContent='FAST WAIT';why.textContent=fast?.reason||'Belum ada setup 1m.';if(orb)orb.textContent='⏳';}
  }
}
function paint(){
  const e=ensure(),p=window.__ZENCORE_PREDICTION_STATE__;if(!e||!p)return;
  const a3=p.analysis3m||{},fast=p.fastTrade1m||{};
  const sig=JSON.stringify([mode,a3.bias,a3.confidence,a3.status,a3.sideways,a3.chop,a3.bars,fast.state,fast.side,fast.score,fast.targetPrice]);
  if(sig===lastSig)return;lastSig=sig;
  q('v27AnalysisBtn').classList.toggle('active',mode==='ANALYSIS');q('v27FastBtn').classList.toggle('active',mode==='FAST');
  q('v27AnalysisCard').classList.toggle('active',mode==='ANALYSIS');q('v27FastCard').classList.toggle('active',mode==='FAST');

  const ab=U(a3.bias||'WAIT');
  q('v27AnalysisMain').textContent=a3.sideways?'3M SIDEWAYS — PAUSE':ab==='WAIT'?'3M BELUM CLEAR':`3M BIAS ${ab}`;
  q('v27AnalysisSub').textContent=a3.reason||'3m tentukan arah utama.';
  q('v27AConf').textContent=`Confidence ${Math.round(N(a3.confidence)||0)}/100`;q('v27AChop').textContent=`Chop ${fmt(a3.chop)}%`;q('v27ABars').textContent=`${N(a3.bars)||0} bar 3m`;
  toneCard(q('v27AnalysisCard'),a3.sideways?'bad':ab==='WAIT'?'wait':'good');q('v27AnalysisCard').classList.toggle('active',mode==='ANALYSIS');

  const fs=U(fast.state||'WAIT'),side=U(fast.side||'WAIT');
  q('v27FastMain').textContent=fs==='READY'?`FAST ${side} READY`:fs==='WATCH'?`WATCH FAST ${side}`:fs==='PAUSE'?'FAST TRADE PAUSE':'FAST WAIT';
  q('v27FastSub').textContent=fast.reason||'1m tunggu setup sehala 3m.';
  q('v27FScore').textContent=`Signal Score ${Math.round(N(fast.score)||0)}/100`;
  q('v27FTarget').textContent=`Target ${N(fast.targetPips)||20} pips`;q('v27FTarget').className='v27-target';
  q('v27FPrice').textContent=fast.targetPrice!=null?`Target Price ${fmt(fast.targetPrice,3)}`:'Target Price —';
  toneCard(q('v27FastCard'),fs==='READY'?'good':fs==='PAUSE'?'bad':'wait');q('v27FastCard').classList.toggle('active',mode==='FAST');

  if(mode==='ANALYSIS')q('v27Advice').innerHTML=a3.sideways?'<b>Analysis 3m:</b> market sideways. Jangan ambil signal baru.':ab==='WAIT'?'<b>Analysis 3m:</b> arah belum clear. Tunggu.':`<b>Analysis 3m:</b> fokus ${ab} sahaja. 1m tak dibenarkan lawan arah ini.`;
  else q('v27Advice').innerHTML=fs==='READY'?`<b>Fast Trade 1m:</b> ${side} trigger dah cukup syarat. Sasaran 20 pips, bukan jaminan profit.`:fs==='WATCH'?`<b>Fast Trade 1m:</b> bias ${side} ada, tunggu trigger betul-betul confirm.`:'<b>Fast Trade 1m:</b> belum sesuai masuk. Jangan paksa trade.';
  updateTopAction(a3,fast);
}
function init(){restore();setTimeout(()=>{ensure();paint()},1700);document.addEventListener('zencore:prediction-state',paint);document.addEventListener('zencore:flow-updated',paint);document.addEventListener('visibilitychange',()=>{if(!document.hidden)paint()})}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();