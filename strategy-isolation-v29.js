(function(){
'use strict';
const q=id=>document.getElementById(id);
const U=v=>String(v||'').toUpperCase();
const N=v=>{const x=Number(v);return Number.isFinite(x)?x:null};
let mode='NORMAL',last='';
const st=document.createElement('style');st.id='v29Style';st.textContent="\n#v28Strategies{display:none!important}\n#v29StrategySwitch{margin:10px 10px 12px;border:1px solid #2b526a;border-radius:18px;background:linear-gradient(145deg,#071823,#061019);padding:12px;box-shadow:0 14px 34px #0005}\n.v29-title{display:flex;justify-content:space-between;gap:10px;align-items:center;margin-bottom:9px}.v29-title b{font:950 12px Inter,system-ui;color:#edf6fb;letter-spacing:.5px}.v29-title span{font:750 8px Inter,system-ui;color:#7790a2}\n.v29-tabs{display:grid;grid-template-columns:1fr 1fr;gap:10px}.v29-tab{min-height:86px;border:1px solid #29475a;border-radius:14px;background:#07131d;color:#95aabc;padding:13px 15px;cursor:pointer;text-align:left;transition:.18s}.v29-tab:hover{transform:translateY(-1px);border-color:#46728d}.v29-tab.active{border-color:#4d87a7;background:linear-gradient(145deg,#0d2a3a,#071923);box-shadow:inset 0 0 0 1px #214b64}.v29-tab .ico{font-size:28px;float:left;margin-right:12px}.v29-tab strong{display:block;font:950 19px/1.1 Inter,system-ui;color:#eef7fb}.v29-tab small{display:block;margin-top:6px;font:700 9px/1.35 Inter,system-ui;color:#8098aa}\n.v29-current{display:grid;grid-template-columns:1.3fr repeat(4,minmax(100px,.55fr));gap:8px;margin-top:10px}.v29-current>div{border:1px solid #18384c;border-radius:11px;background:#061019;padding:9px;min-width:0}.v29-current span{display:block;font:850 7px Inter,system-ui;color:#71899d;text-transform:uppercase}.v29-current b{display:block;margin-top:5px;font:950 12px Inter,system-ui;color:#e7f1f7;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.v29-current .main b{font-size:17px;color:#ffbf58}.v29-current .ready b{color:#3be497}.v29-current .pause b{color:#ff6878}.v29-modebar{margin-top:8px;padding:8px 10px;border:1px solid #214157;border-radius:10px;background:#081722;font:800 9px/1.4 Inter,system-ui;color:#b9cad6}\n#v29Plan{display:grid;grid-template-columns:repeat(5,1fr);gap:8px}.v29-plan-card{border:1px solid #173447;border-radius:10px;background:#07131d;padding:9px}.v29-plan-card span{display:block;font:850 7px Inter,system-ui;color:#71899d;text-transform:uppercase}.v29-plan-card b{display:block;margin-top:5px;font:950 13px Inter,system-ui;color:#e6f0f7}.v29-plan-card.entry b{color:#ffbf58}.v29-plan-card.sl b{color:#ff6878}.v29-plan-card.tp b{color:#3be497}\nbody.zc-focus #v22Prediction{display:none!important}body.zc-focus #v22TradePlan #v10Focus{display:none!important}body.zc-focus #v22TradePlan .v22-slot>#v29Plan{display:grid!important}\n@media(max-width:900px){.v29-current{grid-template-columns:1fr 1fr}.v29-current .main{grid-column:1/-1}#v29Plan{grid-template-columns:1fr 1fr}}\n@media(max-width:620px){.v29-tabs{grid-template-columns:1fr}.v29-current{grid-template-columns:1fr}}\n";document.head.appendChild(st);

function restore(){try{mode=localStorage.getItem('zcStrategyMode')==='FAST'?'FAST':'NORMAL'}catch(_){mode='NORMAL'}window.__ZENCORE_STRATEGY_MODE__=mode}
function strat(p){return mode==='FAST'?(p&&p.strategyFast||{}):(p&&p.strategyNormal||{})}
function stateText(s){const z=U(s&&s.state),side=U(s&&s.side||'WAIT');if(z==='READY')return mode==='FAST'?'FAST '+side+' READY':'SOLID '+side+' ENTRY';if(z==='WATCH')return 'WATCH '+side;if(z==='PAUSE')return 'SIGNAL PAUSE';if(z==='WARMING')return 'ANALYSIS WARMING';if(z==='COOLDOWN')return 'WAIT NEXT SETUP';return 'WAIT'}
function fmt(v){return N(v)==null?'—':Number(v).toFixed(3)}
function setT(id,v){const e=q(id);if(e)e.textContent=v}

function ensureSwitch(){
 let e=q('v29StrategySwitch');if(e)return e;
 e=document.createElement('section');e.id='v29StrategySwitch';
 e.innerHTML='<div class="v29-title"><b>PILIH STRATEGI TRADE</b><span>Satu strategi = satu set analysis, signal & trade plan</span></div>'+
 '<div class="v29-tabs"><button class="v29-tab" id="v29Fast"><span class="ico">⚡</span><strong>FAST TRADE 1M</strong><small>Analysis 1m • Entry cepat • Target 20–30 pips • SL ikut volatility 1m</small></button>'+
 '<button class="v29-tab" id="v29Normal"><span class="ico">🧠</span><strong>NORMAL SCALPING 3M</strong><small>3m utama • Confirm 1m + 3m + 5m • TP/SL ikut market condition</small></button></div>'+
 '<div class="v29-current"><div class="main" id="v29StateCard"><span>Strategi Aktif</span><b id="v29State">WAIT</b></div><div><span>Signal</span><b id="v29Side">WAIT</b></div><div><span>Setup Score</span><b id="v29Score">—</b></div><div><span id="v29Metric3Label">Target</span><b id="v29Metric3Value">—</b></div><div><span>Data / Confirm</span><b id="v29Confirm">—</b></div></div>'+
 '<div class="v29-modebar" id="v29Reason">Tunggu data strategi.</div>';
 const h=document.querySelector('header.top');if(h)h.insertAdjacentElement('afterend',e);else document.body.prepend(e);
 q('v29Fast').onclick=()=>select('FAST');q('v29Normal').onclick=()=>select('NORMAL');return e;
}
function ensurePlan(){
 const sec=q('v22TradePlan'),slot=sec&&sec.querySelector('.v22-slot');if(!slot)return null;
 let e=q('v29Plan');if(e)return e;
 e=document.createElement('div');e.id='v29Plan';
 e.innerHTML='<div id="v29PlanEmpty" class="v29-plan-empty">Tunggu setup confirm untuk bina trade plan baru.</div><div class="v29-plan-card entry"><span>🎯 Entry</span><b id="v29Entry">—</b></div><div class="v29-plan-card sl"><span>🛑 Stop Loss</span><b id="v29SL">—</b></div><div class="v29-plan-card tp"><span>💰 TP1</span><b id="v29TP1">—</b></div><div class="v29-plan-card tp"><span>💰 TP2</span><b id="v29TP2">—</b></div><div class="v29-plan-card tp" id="v29TP3Card"><span>🚀 TP3</span><b id="v29TP3">—</b></div>';
 slot.appendChild(e);return e;
}
function select(m){
 mode=m==='FAST'?'FAST':'NORMAL';window.__ZENCORE_STRATEGY_MODE__=mode;
 try{localStorage.setItem('zcStrategyMode',mode)}catch(_){}
 last='';paint();try{document.dispatchEvent(new CustomEvent('zencore:strategy-change',{detail:{mode}}))}catch(_){}
}
function paint(){
 ensureSwitch();ensurePlan();
 const p=window.__ZENCORE_PREDICTION_STATE__;if(!p)return;
 const s=strat(p),sig=JSON.stringify([mode,s.state,s.side,s.score,s.reason,s.plan,s.confirmations,s.analysis1m,s.analysis3m,s.analysis5m]);
 if(sig===last)return;last=sig;
 q('v29Fast').classList.toggle('active',mode==='FAST');q('v29Normal').classList.toggle('active',mode==='NORMAL');
 const sc=q('v29StateCard');if(sc)sc.className='main '+(U(s.state)==='READY'?'ready':U(s.state)==='PAUSE'?'pause':'');
 setT('v29State',stateText(s));setT('v29Side',U(s.side||'WAIT'));setT('v29Score',Math.round(N(s.score)||0)+'/100');
 if(mode==='FAST'){setT('v29Metric3Label','Target');setT('v29Metric3Value','20–30 pips');setT('v29Confirm',U(s.state)==='READY'?'1M CONFIRMED':'1M '+U(s.state||'WAIT'))}
 else{const c=s.confirmations||{},cnt=[c.m1,c.m3,c.m5].filter(x=>x==='PASS').length;setT('v29Metric3Label','TF Confirm');setT('v29Metric3Value',cnt+'/3 TF');setT('v29Confirm','1M '+(c.m1||'WAIT')+' • 3M '+(c.m3||'WAIT')+' • 5M '+(c.m5||'WAIT'))}
 setT('v29Reason',(mode==='FAST'?'⚡ FAST: ':'🧠 NORMAL: ')+(s.reason||'Tunggu setup.'));
 const plan=s.plan||{},hasPlan=!!s.plan,price=q('price')&&q('price').textContent.trim()||'—';const pe=q('v29PlanEmpty');if(pe){pe.style.display=hasPlan?'none':'block';pe.textContent=U(s.state)==='COOLDOWN'?'Trade selesai. Tunggu setup baru yang fresh.':'Belum ada trade plan — tunggu setup confirm.'}q('v29Plan')?.classList.toggle('has-plan',hasPlan);
 setT('v25LivePrice',price);[['v25LiveEntry',plan.entry],['v25LiveSl',plan.sl],['v25LiveTp1',plan.tp1],['v25LiveTp2',plan.tp2],['v25LiveTp3',plan.tp3]].forEach(a=>setT(a[0],N(a[1])==null?'—':fmt(a[1])));
 const top3=q('v25Tp3Card');if(top3)top3.style.display=mode==='FAST'?'none':'block';
 setT('v22MarketMain',stateText(s));setT('v22MarketSub',s.reason||'Tunggu setup.');setT('v22Bias',(mode==='FAST'?'FAST 1M':'NORMAL 3M')+' • '+U(s.side||'WAIT'));
 const at=q('v22Analysis')&&q('v22Analysis').querySelector('.v22-title b'),ad=q('v22Analysis')&&q('v22Analysis').querySelector('.v22-title span');
 if(at)at.textContent=mode==='FAST'?'FAST ANALYSIS 1M':'NORMAL ANALYSIS 1M / 3M / 5M';if(ad)ad.textContent=mode==='FAST'?'Semua bacaan dari TF1m sahaja.':'3m utama, 1m + 5m confirm untuk solid entry.';
 if(U(s.state)==='COOLDOWN'){setT('v22AnaMain','WAIT NEXT SETUP');setT('v22AnaSub',s.reason||'Trade selesai. Tunggu setup baru.');setT('v22Hema','WAIT');setT('v22Mom','WAIT');setT('v22Mtf','WAIT')}else if(mode==='FAST'){const a=s.analysis1m||{};setT('v22AnaMain',stateText(s));setT('v22AnaSub',a.reason||s.reason||'1m analysis');setT('v22Hema','1M '+U(a.bias||'WAIT'));setT('v22Mom','Score '+Math.round(N(s.score)||0)+'/100');setT('v22Mtf',a.sideways?'SIDEWAYS':'1M CLEAR')}
 else{const a1=s.analysis1m||{},a3=s.analysis3m||{},a5=s.analysis5m||{},c=s.confirmations||{};setT('v22AnaMain',stateText(s));setT('v22AnaSub',s.reason||'Tunggu TF align.');setT('v22Hema','1M '+U(a1.bias||'WAIT')+' • '+(c.m1||'WAIT'));setT('v22Mom','3M '+U(a3.bias||'WAIT')+' • '+(c.m3||'WAIT'));setT('v22Mtf','5M '+U(a5.bias||'WAIT')+' • '+(c.m5||'WAIT'))}
 const pt=q('v22TradePlan')&&q('v22TradePlan').querySelector('.v22-title b'),pd=q('v22TradePlan')&&q('v22TradePlan').querySelector('.v22-title span'),ps=q('v22TradePlan')&&q('v22TradePlan').querySelector('.v22-state');
 if(pt)pt.textContent=mode==='FAST'?'FAST TRADE PLAN 1M':'NORMAL SCALPING TRADE PLAN';if(pd)pd.textContent=mode==='FAST'?'Entry, SL dan target khas Fast Trade.':'Entry 3m solid, TP/SL dynamic ikut market condition.';if(ps)ps.textContent=stateText(s);
 setT('v29Entry',N(plan.entry)==null?'—':fmt(plan.entry));setT('v29SL',N(plan.sl)==null?'—':fmt(plan.sl));setT('v29TP1',N(plan.tp1)==null?'—':fmt(plan.tp1));setT('v29TP2',N(plan.tp2)==null?'—':fmt(plan.tp2));setT('v29TP3',N(plan.tp3)==null?'—':fmt(plan.tp3));
 const p3=q('v29TP3Card');if(p3)p3.style.display=mode==='FAST'?'none':'block';
 const ch=q('v25Cockpit')&&q('v25Cockpit').querySelector('.v25-head-copy b'),cs=q('v25Cockpit')&&q('v25Cockpit').querySelector('.v25-head-copy span');
 if(ch)ch.textContent=mode==='FAST'?'⚡ FAST TRADE 1M — DECISION COCKPIT':'🧠 NORMAL SCALPING 3M — DECISION COCKPIT';if(cs)cs.textContent=mode==='FAST'?'Semua data bawah ini khas FAST 1M.':'Semua data bawah ini khas NORMAL 3M + confirmation 1m/3m/5m.';
 const brand=document.querySelector('header.top .brand h1');if(brand)brand.textContent='ZENCORE V29 — STRATEGY ISOLATION';const phases=document.querySelectorAll('header.top .phase-pill');if(phases.length)phases[phases.length-1].textContent=mode==='FAST'?'FAST TRADE 1M':'NORMAL SCALPING 3M';
}
function init(){restore();setTimeout(()=>{ensureSwitch();ensurePlan();paint()},1850);document.addEventListener('zencore:prediction-state',paint);document.addEventListener('zencore:flow-updated',paint);document.addEventListener('zencore:strategy-change',paint);document.addEventListener('visibilitychange',()=>{if(!document.hidden)paint()})}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();