(function(){
'use strict';
const q=id=>document.getElementById(id);

const css=`
#v29StrategySwitch{
  position:sticky;top:0;z-index:600;
  margin:0 0 12px!important;
  border-radius:0 0 18px 18px!important;
  box-shadow:0 12px 32px #0008!important;
  backdrop-filter:blur(10px)
}
#v29StrategySwitch .v29-title{margin-bottom:10px}
#v29StrategySwitch .v29-title b{font-size:13px}
#v29StrategySwitch .v29-tab{min-height:92px!important}
#v29StrategySwitch .v29-tab strong{font-size:20px!important}
#v29StrategySwitch .v29-tab small{font-size:9px!important}
#v29StrategySwitch .v29-current{margin-top:9px}
#v29StrategySwitch .v29-modebar{margin-top:8px}

#v22Flow>.v22-flow-head,#v22Flow>.v22-legend,#v24Controls{display:none!important}

#v22Flow{
  display:grid!important;
  grid-template-columns:repeat(12,minmax(0,1fr))!important;
  gap:12px!important;
  align-items:start!important;
  margin-top:0!important
}
#v23ActionBar{grid-column:1/-1!important;order:1!important;margin:0!important}
#v25Cockpit{grid-column:1/-1!important;order:2!important;margin:0!important}
#v22Market{grid-column:1/span 6!important;order:3!important;margin:0!important}
#v22Position{grid-column:7/span 6!important;order:3!important;margin:0!important}
#v22Analysis{grid-column:1/span 6!important;order:4!important;margin:0!important}
#v22TradePlan{grid-column:7/span 6!important;order:4!important;margin:0!important}
#v22Chart{grid-column:1/-1!important;order:5!important;margin:0!important}
#v22Prediction{display:none!important}

.v22-num{display:none!important}
.v22-sh{
  grid-template-columns:minmax(0,1fr) auto 30px!important;
  min-height:58px;
  align-items:center!important
}
#v22Flow .v23-icon{display:none!important}
#v22Flow .v22-title{min-width:0!important}
#v22Flow .v22-title b{
  display:block!important;
  white-space:nowrap!important;
  overflow:hidden!important;
  text-overflow:ellipsis!important;
  line-height:1.15!important;
  font-size:12px!important
}
#v22Flow .v22-title span{
  display:block!important;
  white-space:normal!important;
  line-height:1.35!important;
  max-width:none!important;
  margin-top:4px!important;
  font-size:8px!important
}
.v22-state{font-size:9px!important}

#v23ActionBar{
  border-color:#315b74!important;
  background:linear-gradient(135deg,#091b28,#061019)!important
}
#v23ActionBar .v23-copy b{font-size:24px!important}
#v23ActionBar .v23-orb{font-size:29px!important}

#v25Cockpit .v25-head{margin-bottom:8px!important}
#v25Cockpit .v25-levels{margin-top:0!important}
#v25Cockpit .v25-main{margin-top:0!important}

body.v29-fast #v29StrategySwitch{border-color:#805f22!important}
body.v29-normal #v29StrategySwitch{border-color:#376886!important}
body.v29-fast #v29StrategySwitch:before,
body.v29-normal #v29StrategySwitch:before{
  content:'';
  display:block;
  height:3px;
  border-radius:999px;
  margin:-5px 0 9px
}
body.v29-fast #v29StrategySwitch:before{background:#ffbf58}
body.v29-normal #v29StrategySwitch:before{background:#58b7e8}

#v22Position .v22-title b:before{content:'🛡️ ';font-size:14px}
#v22Market .v22-title b:before{content:'📍 ';font-size:14px}
#v22Analysis .v22-title b:before{content:'📊 ';font-size:14px}
#v22TradePlan .v22-title b:before{content:'🎯 ';font-size:14px}
#v22Chart .v22-title b:before{content:'📈 ';font-size:14px}

body.zc-focus #v20Guard .v20kpi:nth-child(2),
body.zc-focus #v20Guard .v20kpi:nth-child(3),
body.zc-focus #v20Guard .v20kpi:nth-child(4){display:none!important}
body.zc-focus #v20Guard .v20main{
  grid-template-columns:minmax(0,1.7fr) minmax(180px,.7fr)!important
}

.v29-plan-empty{
  grid-column:1/-1;
  border:1px dashed #355166;
  border-radius:10px;
  background:#07131d;
  padding:14px;
  text-align:center;
  color:#9db0bf;
  font:800 9px Inter,system-ui
}
#v29Plan:not(.has-plan) .v29-plan-card{display:none!important}

#v22Chart .v22-title span{max-width:760px!important}
#v22Chart .chartpanel{min-height:720px!important}
#v22Chart .chartwrap,#v22Chart #chart{min-height:590px!important}

#v29StrategySwitch .v29-tab.active{
  transform:translateY(-1px) scale(1.002);
  box-shadow:inset 0 0 0 1px #315e79,0 8px 18px #0004!important
}
body.v29-fast #v29Fast.active strong{color:#ffcf67!important}
body.v29-normal #v29Normal.active strong{color:#83d1f4!important}

body.zc-focus #v19Precision{display:none!important}

@media(max-width:1180px){
  #v22Market,#v22Position,#v22Analysis,#v22TradePlan,#v22Chart{grid-column:1/-1!important}
  #v22Flow{grid-template-columns:1fr!important}
  #v29StrategySwitch{position:relative!important;top:auto!important}
}
@media(max-width:650px){
  #v29StrategySwitch{border-radius:0 0 14px 14px!important}
  #v29StrategySwitch .v29-tab{min-height:76px!important}
  #v29StrategySwitch .v29-tab strong{font-size:17px!important}
  #v23ActionBar .v23-copy b{font-size:19px!important}
  #v22Chart .chartpanel{min-height:620px!important}
  body.zc-focus #v20Guard .v20main{grid-template-columns:1fr!important}
}
`;

const st=document.createElement('style');
st.id='v30LayoutStyle';
st.textContent=css;
document.head.appendChild(st);

function moveSelectorTop(){
  const selector=q('v29StrategySwitch');
  const header=document.querySelector('header.top');
  if(selector&&header&&header.nextElementSibling!==selector){
    header.insertAdjacentElement('afterend',selector);
  }
}
function relabel(){
  const labels={
    v22Market:['MARKET SEKARANG','Apa market tengah buat untuk strategi yang dipilih?'],
    v22Position:['POSITION SAYA','Manage trade yang sedang berjalan.'],
    v22Analysis:['ANALYSIS STRATEGI','Bacaan khas strategi yang dipilih.'],
    v22TradePlan:['TRADE PLAN','Entry, SL dan target khas strategi aktif.'],
    v22Chart:['CHART CONFIRMATION','Semak visual sebelum buat keputusan.']
  };
  Object.entries(labels).forEach(([id,v])=>{
    const s=q(id);if(!s)return;
    const b=s.querySelector('.v22-title b'),d=s.querySelector('.v22-title span');
    if(b&&!b.dataset.v30){b.textContent=v[0];b.dataset.v30='1'}
    if(d)d.textContent=v[1];
  });
}
function brand(){
  const h=document.querySelector('header.top .brand h1');
  if(h)h.textContent='ZENCORE V30.2 — SETUP WAKE MODE';
  const phases=document.querySelectorAll('header.top .phase-pill');
  if(phases.length){
    phases[phases.length-1].textContent=window.__ZENCORE_STRATEGY_MODE__==='FAST'?'FAST TRADE 1M':'NORMAL SCALPING 3M';
  }
}
function apply(){moveSelectorTop();relabel();brand();}
function init(){
  setTimeout(apply,2100);
  document.addEventListener('zencore:strategy-change',()=>setTimeout(apply,0));
  document.addEventListener('zencore:flow-updated',apply);
  document.addEventListener('zencore:prediction-state',apply);
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();