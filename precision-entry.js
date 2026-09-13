(()=>{'use strict';

const $=id=>document.getElementById(id);
const clamp=(v,a=0,b=100)=>Math.max(a,Math.min(b,v));
const num=v=>Number.isFinite(+v)?+v:null;
const fmt=(v,d=3)=>num(v)!=null?num(v).toLocaleString(undefined,{maximumFractionDigits:d}):'—';
const esc=s=>String(s??'—').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const age=ts=>{if(!ts)return'No live data yet';const s=Math.max(0,Math.floor((Date.now()-ts)/1000));return s<60?s+'s ago':s<3600?Math.floor(s/60)+'m ago':Math.floor(s/3600)+'h ago'};
const setText=(id,v)=>{const el=$(id);if(el)el.textContent=v};

let lastMarket=null;
let lastPerformance=null;

function rrFromPlan(p){
  if(!p)return null;
  const e=num(p.entry),sl=num(p.sl),tp3=num(p.tp3);
  if(e==null||sl==null||tp3==null)return null;
  const risk=Math.abs(e-sl);
  return risk>0?Math.abs(tp3-e)/risk:null;
}

function gateMarkup(g){
  const pass=!!g.pass;
  return '<div class="gate '+(pass?'pass':'fail')+'">'+
    '<span class="icon">'+(pass?'✓':'×')+'</span>'+
    '<div><b>'+esc(g.label)+'</b><small>'+esc(g.detail||'')+'</small></div>'+
    '<strong class="'+(pass?'good':'bad')+'">'+(pass?'PASS':'WAIT')+'</strong></div>';
}

function qualityLayer(m){
  const n=m?.strategyNormal||{};
  const s=n?.sop||{};
  const p=n?.plan||null;
  const side=String(n.side||'WAIT').toUpperCase();
  const power=num(s.marketPower);
  const forecast=String(s.forecast||'WAIT').toUpperCase();
  const confluence=num(m?.confluence)||0;
  const setupProb=num(m?.setupProbability)||0;
  const predConf=num(m?.predictionConfidence)||0;
  const stability=num(m?.stability)||0;
  const sopGreen=num(s.sopGreen)||0;
  const hardGates=(Array.isArray(s.gates)?s.gates:[]).filter(g=>g.pass).length;
  const rr=rrFromPlan(p)??num(m?.rr);

  const directionalForecast=
    (side==='BUY'&&forecast==='BULLISH'&&power!=null&&power>=65) ||
    (side==='SELL'&&forecast==='BEARISH'&&power!=null&&power>=65);

  const neutralAllowed=
    (side==='BUY'&&forecast==='NEUTRAL'&&power!=null&&power>50) ||
    (side==='SELL'&&forecast==='NEUTRAL'&&power!=null&&power<50);

  const checks=[
    {label:'All 5 Hard Gates',detail:hardGates+'/5',earned:hardGates===5?25:0,max:25},
    {label:'SOP Confluence',detail:sopGreen+'/5 green',earned:sopGreen>=5?15:sopGreen>=4?10:0,max:15},
    {label:'Forecast Strength',detail:forecast+' '+(power==null?'—':Math.round(power)+'%'),earned:directionalForecast?15:neutralAllowed?6:0,max:15},
    {label:'No Sideways / Chop Guard',detail:m?.sidewaysGuard?'Sideways active':'Market clear',earned:m?.sidewaysGuard?0:10,max:10},
    {label:'Prediction Confidence',detail:Math.round(predConf)+' / 100',earned:predConf>=80?10:predConf>=70?6:0,max:10},
    {label:'Signal Stability',detail:Math.round(stability)+' / 100',earned:stability>=75?10:stability>=65?5:0,max:10},
    {label:'Confluence Stars',detail:confluence+' / 5',earned:confluence>=4?5:confluence>=3?3:0,max:5},
    {label:'Setup Probability',detail:Math.round(setupProb)+'%',earned:setupProb>=70?5:setupProb>=60?3:0,max:5},
    {label:'Reward / Risk',detail:rr==null?'No active plan':rr.toFixed(1)+'R to TP3',earned:rr!=null&&rr>=2?5:0,max:5}
  ];

  const score=clamp(checks.reduce((a,c)=>a+c.earned,0));
  let grade='C';
  if(score>=90)grade='A+';
  else if(score>=80)grade='A';
  else if(score>=70)grade='B+';
  else if(score>=60)grade='B';

  const sopReady=String(n.state||'').toUpperCase()==='READY';
  const aPlusExecution=sopReady&&score>=80&&!m?.sidewaysGuard;
  let action='WAIT';
  let advice='Tunggu SOP lengkap dan quality sekurang-kurangnya 80/100.';
  if(sopReady&&aPlusExecution){
    action='A+ EXECUTION';
    advice='SOP READY dan quality tinggi. Semak harga entry, SL dan saiz risiko sebelum execute.';
  }else if(sopReady){
    action='VALID SOP • LOW QUALITY';
    advice='Signal SOP sah, tetapi quality belum 80/100. Untuk precision mode, pertimbang skip setup ini.';
  }else if(String(n.state||'').toUpperCase()==='WATCH'){
    action='WATCH';
    advice='Setup sedang terbentuk. Jangan front-run entry line.';
  }

  return{score,grade,checks,aPlusExecution,action,advice,rr};
}

function qualityMarkup(c){
  const full=c.earned>=c.max;
  const partial=c.earned>0&&!full;
  const cls=full?'pass':partial?'warn':'fail';
  const icon=full?'✓':partial?'•':'×';
  return '<div class="quality-item '+cls+'">'+
    '<span class="icon">'+icon+'</span>'+
    '<div><b>'+esc(c.label)+'</b><small>'+esc(c.detail)+'</small></div>'+
    '<strong class="'+(full?'good':partial?'warn':'bad')+'">'+c.earned+'/'+c.max+'</strong></div>';
}

function renderMarket(m){
  lastMarket=m;
  const n=m?.strategyNormal||{},s=n?.sop||{},p=n?.plan||null;
  const q=qualityLayer(m);
  window.__lastReceived=m?.receivedAt||null;

  const fresh=String(m?.freshness||'OFFLINE').toUpperCase();
  setText('symbol',m?.symbol||'XAUUSD');
  setText('feedState',fresh);
  setText('feedAge',age(m?.receivedAt));
  setText('marketSession',fresh==='LIVE'?'OPEN / LIVE':fresh==='STALE'?'STALE':'CLOSED / OFFLINE');
  $('feedDot')?.classList.toggle('live',fresh==='LIVE');

  const state=String(n.state||'WARMING').toUpperCase();
  const side=String(n.side||'WAIT').toUpperCase();
  setText('entryState',state);
  setText('entrySide','SIDE: '+side);
  if($('entryState'))$('entryState').className=state==='READY'?'good':state==='WATCH'?'warn':'';

  setText('heroSignal',state==='READY'?('PRECISION '+side+' READY'):state==='WATCH'?('WATCH '+side+' SETUP'):'WAIT FOR VALID SETUP');
  setText('heroReason',n.reason||'Menunggu Pine V32 feed.');

  setText('lastPrice','Price: '+fmt(m?.price,3));
  setText('entryPrice',fmt(s.entry,3));
  setText('closePrice',fmt(s.close3??m?.price,3));
  setText('marketPower',s.marketPower==null?'—':Math.round(num(s.marketPower))+'%');
  setText('forecast','Forecast: '+String(s.forecast||'—'));
  setText('sopScore',(s.sopGreen??0)+'/5');

  setText('qualityGrade',q.grade);
  setText('qualityScore','Quality: '+q.score+'/100');
  setText('qualityMeterLabel',q.score+'%');
  if($('qualityRail'))$('qualityRail').style.width=q.score+'%';
  setText('qualityBadge',q.aPlusExecution?'A+ TAKE':'FILTER');
  if($('qualityBadge'))$('qualityBadge').className='quality-badge '+(q.aPlusExecution?'good':q.score>=70?'warn':'bad');
  setText('executionTitle',q.action);
  setText('executionAdvice',q.advice);

  const gates=Array.isArray(s.gates)?s.gates:[];
  setText('gateScore',gates.filter(x=>x.pass).length+'/5');
  if($('gateList'))$('gateList').innerHTML=gates.length?gates.map(gateMarkup).join(''):'<div class="gate fail"><span class="icon">…</span><div><b>Waiting Pine V32 feed</b><small>No entry data received yet</small></div><strong class="warn">WARMING</strong></div>';
  if($('qualityChecklist'))$('qualityChecklist').innerHTML=q.checks.map(qualityMarkup).join('');

  if($('sopList'))$('sopList').innerHTML=[1,2,3,4,5].map(i=>{
    const pass=!!s['sop'+i];
    return '<div class="sop '+(pass?'pass':'fail')+'"><span>SOP '+i+'</span><b class="'+(pass?'good':'bad')+'">'+(pass?'✓':'×')+'</b></div>';
  }).join('');

  setText('m5Position',s.m5Position||'—');
  setText('m5PositionMini',s.m5Position||'—');
  setText('m5Close',fmt(s.m5Close,3));
  setText('m5Hema20',fmt(s.m5Hema20,3));
  setText('m5Hema40',fmt(s.m5Hema40,3));

  setText('planTitle',p?(side+' PLAN READY'):'No Active Plan');
  setText('planEntry',fmt(p?.entry,3));
  setText('planSL',fmt(p?.sl,3));
  setText('planTP1',fmt(p?.tp1,3));
  setText('planTP2',fmt(p?.tp2,3));
  setText('planTP3',fmt(p?.tp3,3));
  setText('riskDistance',fmt(p?.riskDistance,3));
  setText('rrTp3',q.rr==null?'—':q.rr.toFixed(1)+'R');
  setText('planNote',p?'Hard gates passed. SOP signal valid; A+ Quality ialah lapisan execution berasingan.':'Plan hanya muncul apabila semua syarat SOP entry lulus.');

  setText('riskState',m?.sidewaysGuard?'HIGH / SIDEWAYS':state==='READY'?'CONTROLLED':'WAIT');
  setText('setupProbability',m?.setupProbability==null?'—':Math.round(num(m.setupProbability))+'%');
  setText('confluence',m?.confluence==null?'—':m.confluence+'/5');
  setText('entryZone',m?.zone||'—');
}

function outcomeClass(o){
  const x=String(o||'').toUpperCase();
  return /TP|WIN|PROTECTED/.test(x)?'good':x==='SL'?'bad':'warn';
}

function renderPerformance(payload){
  const s=payload?.summary||{};
  lastPerformance=s;
  const resolved=num(s.resolved)||0;
  const wr=num(s.winRate);

  setText('perfWinRate',wr==null?'—':wr.toFixed(1)+'%');
  setText('perfResolved',resolved);
  setText('perfWins',num(s.wins)||0);
  setText('perfLosses',num(s.losses)||0);
  setText('performanceStatus',s.maturity||'EARLY');
  if($('performanceStatus'))$('performanceStatus').className='performance-badge '+(resolved>=50?'good':'warn');

  if(resolved>=50&&wr!=null){
    setText('validatedWinRate',wr.toFixed(1)+'%');
    setText('sampleSize','Sample: '+resolved+' resolved • '+String(s.maturity||''));
  }else{
    setText('validatedWinRate','—');
    setText('sampleSize','Need 50 resolved trades • current '+resolved);
  }

  let msg='Collecting results. Target 80%+ belum boleh dianggap valid.';
  if(resolved>=50&&wr!=null&&wr>=80)msg='80%+ target currently met on '+resolved+' resolved trades. Continue validation; past results are not a guarantee.';
  else if(resolved>=50&&wr!=null)msg='Validated win rate '+wr.toFixed(1)+'% on '+resolved+' trades. Target 80% belum dicapai — jangan paksa entry.';
  else if(resolved>=20)msg='Sample sedang BUILDING ('+resolved+'/50). Win rate awal belum cukup kuat untuk claim 80%+.';
  setText('performanceMessage',msg);

  const recent=Array.isArray(s.recent)?s.recent.slice(0,6):[];
  if($('recentResults'))$('recentResults').innerHTML=recent.length?recent.map(r=>{
    const side=esc(r.side||'—'),out=esc(r.outcome||'OPEN');
    const t=r.resolvedAt?new Date(r.resolvedAt).toLocaleString(undefined,{month:'short',day:'2-digit',hour:'2-digit',minute:'2-digit'}):'—';
    return '<div class="result-row"><span>'+esc(t)+'</span><b>'+side+'</b><strong class="'+outcomeClass(r.outcome)+'">'+out+'</strong></div>';
  }).join(''):'<div class="performance-message">Belum ada trade Normal 3M yang selesai untuk dipaparkan.</div>';
}

async function refreshMarket(){
  try{
    const r=await fetch('/api/prediction/XAUUSD',{cache:'no-store'});
    if(!r.ok)throw new Error('HTTP '+r.status);
    renderMarket(await r.json());
  }catch(e){
    setText('feedState','OFFLINE');
    setText('marketSession','CLOSED / OFFLINE');
    setText('heroReason','Dashboard waiting for backend: '+e.message);
  }
}

async function refreshPerformance(){
  try{
    const r=await fetch('/api/strategy-performance/XAUUSD/NORMAL',{cache:'no-store'});
    if(!r.ok)throw new Error('HTTP '+r.status);
    renderPerformance(await r.json());
  }catch(e){
    setText('performanceMessage','Performance data unavailable: '+e.message);
  }
}

try{
  const es=new EventSource('/prediction-events/XAUUSD');
  es.addEventListener('prediction',e=>{try{renderMarket(JSON.parse(e.data))}catch(_){}});
}catch(_){}

refreshMarket();
refreshPerformance();
setInterval(refreshMarket,10000);
setInterval(refreshPerformance,30000);
setInterval(()=>{if(window.__lastReceived)setText('feedAge',age(window.__lastReceived))},1000);

})();