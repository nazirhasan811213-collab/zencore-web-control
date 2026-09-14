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

function renderPositionManagement(m){
  const pm=m?.positionManagement||{};
  const stage=String(pm.stage||'IDLE').toUpperCase();
  const action=String(pm.action||'IDLE').toUpperCase();
  const remaining=num(pm.remainingPct);
  const yellow=String(pm.yellowType||'NONE').toUpperCase();
  const slLock=String(pm.slLockLabel||'INITIAL').toUpperCase();
  const activeSl=num(pm.activeSl);
  const reason=String(pm.reason||'No active position.');

  setText('positionExitStage',stage);
  setText('positionExitAction',action.replaceAll('_',' '));
  setText('positionRemaining',(remaining==null?0:remaining)+'%');
  setText('positionYellowState',yellow.replaceAll('_',' '));
  setText('positionActiveSL',fmt(activeSl,3));
  setText('positionSlLock',slLock.replaceAll('_',' '));
  setText('positionExitReason',reason);

  const badge=$('positionExitBadge');
  if(badge){
    badge.textContent=action.replaceAll('_',' ');
    let cls='position-exit-badge';
    if(action==='HOLD')cls+=' hold';
    else if(action==='CLOSE_50_NOW'||action==='WAIT_OPPOSITE_YELLOW')cls+=' half';
    else if(action==='EXIT_REMAINING'||action==='EXIT_ALL'||action==='EXIT_SL')cls+=' exit';
    else if(stage==='CLOSED')cls+=' closed';
    badge.className=cls;
  }

  const ids=['positionStepHold','positionStepHalf','positionStepWait','positionStepExit'];
  ids.forEach(id=>{const el=$(id);if(el)el.className='position-step';});
  if(action==='CLOSE_50_NOW'){
    $('positionStepHalf')?.classList.add('warning');
  }else if(action==='WAIT_OPPOSITE_YELLOW'){
    $('positionStepHalf')?.classList.add('warning');
    $('positionStepWait')?.classList.add('active');
  }else if(action==='EXIT_REMAINING'){
    $('positionStepHalf')?.classList.add('warning');
    $('positionStepWait')?.classList.add('warning');
    $('positionStepExit')?.classList.add('exit-now');
  }else if(action==='EXIT_ALL'||action==='EXIT_SL'){
    $('positionStepExit')?.classList.add('exit-now');
  }else if(action==='HOLD'){
    $('positionStepHold')?.classList.add('active');
  }
}

function renderMarket(m){
  lastMarket=m;
  const n=m?.strategyNormal||{},s=n?.sop||{},p=n?.plan||null;
  const q=qualityLayer(m);
  window.__lastReceived=m?.receivedAt||null;

  const fresh=String(m?.freshness||'OFFLINE').toUpperCase();
  setText('symbol',m?.symbol||'XAUUSD');
  setText('feedState',fresh==='LIVE'?'LIVE • 3M BAR':fresh);
  setText('feedAge',age(m?.receivedAt));
  setText('marketSession',fresh==='LIVE'?'OPEN / BAR-CLOSE':fresh==='STALE'?'STALE':'CLOSED / OFFLINE');
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
  renderPositionManagement(m);
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


let nativeChartPoints=[];
let chartMode='zencore';

function chartColor(name){
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function chartNum(v){const n=Number(v);return Number.isFinite(n)?n:null}

function drawRoundRect(ctx,x,y,w,h,r,fill,stroke){
  const rr=Math.min(r,w/2,h/2);
  ctx.beginPath();
  ctx.moveTo(x+rr,y);
  ctx.arcTo(x+w,y,x+w,y+h,rr);
  ctx.arcTo(x+w,y+h,x,y+h,rr);
  ctx.arcTo(x,y+h,x,y,rr);
  ctx.arcTo(x,y,x+w,y,rr);
  ctx.closePath();
  if(fill){ctx.fillStyle=fill;ctx.fill()}
  if(stroke){ctx.strokeStyle=stroke;ctx.stroke()}
}

function drawZenCoreChart(points){
  const canvas=$('zencoreCanvas');
  if(!canvas)return;
  const panel=$('zencoreChartPanel');
  const rect=panel.getBoundingClientRect();
  const dpr=Math.max(1,Math.min(2,window.devicePixelRatio||1));
  const w=Math.max(320,Math.floor(rect.width));
  const h=Math.max(280,Math.floor(rect.height));
  if(canvas.width!==Math.floor(w*dpr)||canvas.height!==Math.floor(h*dpr)){
    canvas.width=Math.floor(w*dpr);canvas.height=Math.floor(h*dpr);
  }
  canvas.style.width=w+'px';canvas.style.height=h+'px';
  const ctx=canvas.getContext('2d');
  ctx.setTransform(dpr,0,0,dpr,0,0);
  ctx.clearRect(0,0,w,h);
  ctx.fillStyle='#090e13';ctx.fillRect(0,0,w,h);

  const raw=(points||[]).slice(-140);
  if(raw.length<2){
    $('chartEmptyState')?.classList.remove('hidden');
    setText('nativeChartStatus','Waiting live candles');
    return;
  }
  $('chartEmptyState')?.classList.add('hidden');

  const data=[];
  let prevClose=null;
  for(const p of raw){
    const close=chartNum(p.close); if(close==null)continue;
    const open=chartNum(p.open)??prevClose??close;
    const high=chartNum(p.high)??Math.max(open,close);
    const low=chartNum(p.low)??Math.min(open,close);
    data.push({...p,open,high,low,close});
    prevClose=close;
  }
  if(data.length<2){
    $('chartEmptyState')?.classList.remove('hidden');return;
  }

  const pad={l:14,r:82,t:28,b:28};
  const cw=w-pad.l-pad.r,ch=h-pad.t-pad.b;
  const latest=data[data.length-1];
  const levelVals=['entry','sl','tp1','tp2','tp3'].map(k=>chartNum(latest[k])).filter(v=>v!=null);
  let min=Math.min(...data.map(p=>p.low),...levelVals);
  let max=Math.max(...data.map(p=>p.high),...levelVals);
  const span=Math.max(0.0001,max-min);
  min-=span*.08;max+=span*.08;
  const y=v=>pad.t+(max-v)/(max-min)*ch;
  const step=cw/data.length;
  const x=i=>pad.l+i*step+step*.5;

  // grid
  ctx.lineWidth=1;
  ctx.font='10px system-ui';
  ctx.textBaseline='middle';
  for(let i=0;i<=6;i++){
    const yy=pad.t+(ch/6)*i;
    ctx.strokeStyle='#17232d';
    ctx.beginPath();ctx.moveTo(pad.l,yy);ctx.lineTo(w-pad.r,yy);ctx.stroke();
    const price=max-(max-min)*(i/6);
    ctx.fillStyle='#8293a0';
    ctx.textAlign='left';
    ctx.fillText(price.toFixed(price>=1000?2:4),w-pad.r+8,yy);
  }
  const vLines=8;
  for(let i=0;i<=vLines;i++){
    const xx=pad.l+(cw/vLines)*i;
    ctx.strokeStyle='#111b23';
    ctx.beginPath();ctx.moveTo(xx,pad.t);ctx.lineTo(xx,h-pad.b);ctx.stroke();
  }

  // HEMA ribbon
  const ribbon=data.map((p,i)=>({x:x(i),a:chartNum(p.hema20),b:chartNum(p.hema40)})).filter(p=>p.a!=null&&p.b!=null);
  if(ribbon.length>1){
    const bullish=(ribbon[ribbon.length-1].a??0)>(ribbon[ribbon.length-1].b??0);
    ctx.beginPath();
    ribbon.forEach((p,i)=>{const yy=y(p.a);i===0?ctx.moveTo(p.x,yy):ctx.lineTo(p.x,yy)});
    for(let i=ribbon.length-1;i>=0;i--)ctx.lineTo(ribbon[i].x,y(ribbon[i].b));
    ctx.closePath();
    ctx.fillStyle=bullish?'rgba(0,210,150,.22)':'rgba(255,50,40,.22)';
    ctx.fill();

    const drawLine=(key,color)=>{
      ctx.beginPath();let started=false;
      data.forEach((p,i)=>{const v=chartNum(p[key]);if(v==null)return;const xx=x(i),yy=y(v);if(!started){ctx.moveTo(xx,yy);started=true}else ctx.lineTo(xx,yy)});
      ctx.strokeStyle=color;ctx.lineWidth=1.2;ctx.stroke();
    };
    drawLine('hema20',bullish?'rgba(40,230,170,.75)':'rgba(255,75,60,.72)');
    drawLine('hema40',bullish?'rgba(15,125,100,.75)':'rgba(120,35,30,.72)');
  }

  // candles
  const bodyW=Math.max(3,Math.min(10,step*.66));
  data.forEach((p,i)=>{
    const xx=x(i),yo=y(p.open),yc=y(p.close),yh=y(p.high),yl=y(p.low);
    const up=p.close>=p.open;
    const col=up?'#42c7e8':'#ff5b5f';
    ctx.strokeStyle=col;ctx.fillStyle=col;ctx.lineWidth=1;
    ctx.beginPath();ctx.moveTo(xx,yh);ctx.lineTo(xx,yl);ctx.stroke();
    const top=Math.min(yo,yc),bh=Math.max(1.5,Math.abs(yc-yo));
    ctx.fillRect(xx-bodyW/2,top,bodyW,bh);
  });

  // horizontal trade levels
  const levels=[
    ['tp3','#29e6a3','TP3'],['tp2','#29e6a3','TP2'],['tp1','#29e6a3','TP1'],
    ['entry','#d8c44b','ENTRY'],['sl','#ff5c65','SL']
  ];
  for(const [key,color,label] of levels){
    const v=chartNum(latest[key]);if(v==null)continue;
    const yy=y(v);
    ctx.save();
    ctx.setLineDash(key==='entry'?[7,5]:[]);
    ctx.strokeStyle=color;ctx.globalAlpha=.9;ctx.lineWidth=1;
    ctx.beginPath();ctx.moveTo(Math.max(pad.l,w-pad.r-170),yy);ctx.lineTo(w-pad.r,yy);ctx.stroke();
    ctx.restore();
    ctx.font='9px system-ui';ctx.textAlign='right';ctx.textBaseline='bottom';ctx.fillStyle=color;
    ctx.fillText(label+' '+v.toFixed(v>=1000?2:4),w-pad.r-4,yy-2);
  }

  // current price dotted line
  const py=y(latest.close);
  ctx.save();ctx.setLineDash([2,3]);ctx.strokeStyle='#d9ce5a';ctx.globalAlpha=.72;
  ctx.beginPath();ctx.moveTo(pad.l,py);ctx.lineTo(w-pad.r,py);ctx.stroke();ctx.restore();

  // solid-entry markers
  const solids=[];
  data.forEach((p,i)=>{if(p.solid)solids.push({p,i})});
  solids.slice(-10).forEach(({p,i})=>{
    const xx=x(i),yy=y(p.side==='SELL'?p.high:p.low)+(p.side==='SELL'?-20:8);
    const txt='⚡ Solid Entry';
    ctx.font='bold 9px system-ui';
    const tw=ctx.measureText(txt).width+12;
    drawRoundRect(ctx,xx-tw/2,yy,tw,18,4,'rgba(15,225,160,.93)',null);
    ctx.fillStyle='#072016';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(txt,xx,yy+9);
  });

  // forecast banner
  if(latest.forecast&&latest.forecast!=='WAIT'){
    const txt='AI FORECAST: '+latest.forecast+' '+(latest.marketPower==null?'':Math.round(latest.marketPower)+'%');
    ctx.font='bold 9px system-ui';const tw=ctx.measureText(txt).width+16;
    const bull=latest.forecast==='BULLISH',bear=latest.forecast==='BEARISH';
    const fill=bull?'rgba(25,225,160,.9)':bear?'rgba(255,84,84,.9)':'rgba(255,183,77,.9)';
    drawRoundRect(ctx,Math.max(pad.l+180,w-pad.r-tw-30),pad.t+8,tw,20,5,fill,null);
    ctx.fillStyle=bear?'#fff':'#071512';ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.fillText(txt,Math.max(pad.l+180,w-pad.r-tw-30)+tw/2,pad.t+18);
  }

  // SOP checklist overlay
  const sop=Number(latest.sopGreen||0);
  const bw=176,bh=70,bx=w-pad.r-bw-6,by=h-pad.b-bh-8;
  drawRoundRect(ctx,bx,by,bw,bh,8,'rgba(8,16,24,.9)','#2d3f50');
  ctx.fillStyle='#8b4adf';ctx.fillRect(bx,by,bw,18);
  ctx.fillStyle='#fff';ctx.font='bold 9px system-ui';ctx.textAlign='left';ctx.textBaseline='middle';ctx.fillText('SOP ENTRY CHECKLIST',bx+8,by+9);
  ctx.fillStyle='#a7bac9';ctx.font='9px system-ui';ctx.fillText('Mode: '+(latest.side||'WAIT'),bx+8,by+31);
  ctx.fillStyle=sop>=4?'#49e6ae':'#ffbd59';ctx.fillText('SOP Green: '+sop+'/5',bx+8,by+45);
  ctx.fillStyle='#8397a8';ctx.fillText('Forecast: '+(latest.forecast||'WAIT'),bx+8,by+59);

  // time labels
  ctx.font='9px system-ui';ctx.fillStyle='#718391';ctx.textAlign='center';ctx.textBaseline='top';
  const every=Math.max(1,Math.floor(data.length/7));
  for(let i=0;i<data.length;i+=every){
    const t=Number(data[i].time);
    if(!Number.isFinite(t))continue;
    const d=new Date(t);
    const label=d.toLocaleTimeString('en-MY',{hour:'2-digit',minute:'2-digit',hour12:false,timeZone:'Asia/Kuala_Lumpur'});
    ctx.fillText(label,x(i),h-pad.b+7);
  }
  setText('nativeChartStatus',data.length+' candles • ZenCore native feed');
}

async function refreshNativeChart(){
  try{
    const r=await fetch('/api/chart/XAUUSD?limit=180',{cache:'no-store'});
    if(!r.ok)throw new Error('HTTP '+r.status);
    const payload=await r.json();
    nativeChartPoints=Array.isArray(payload.points)?payload.points:[];
    drawZenCoreChart(nativeChartPoints);
  }catch(e){
    setText('nativeChartStatus','Chart feed unavailable');
  }
}

document.querySelectorAll('.chart-tab').forEach(btn=>btn.addEventListener('click',()=>{
  document.querySelectorAll('.chart-tab').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  chartMode=btn.dataset.chartMode||'zencore';
  $('zencoreChartPanel')?.classList.toggle('active',chartMode==='zencore');
  $('tradingViewPanel')?.classList.toggle('active',chartMode==='tradingview');
  if(chartMode==='zencore')drawZenCoreChart(nativeChartPoints);
}));

window.addEventListener('resize',()=>{if(chartMode==='zencore')drawZenCoreChart(nativeChartPoints)});

refreshMarket();
refreshPerformance();
refreshNativeChart();
setInterval(refreshMarket,10000);
setInterval(refreshPerformance,30000);
setInterval(refreshNativeChart,5000);
setInterval(()=>{if(window.__lastReceived)setText('feedAge',age(window.__lastReceived))},1000);

})();