(function(){
'use strict';

const q=id=>document.getElementById(id);
const txt=id=>q(id)?.textContent?.trim()||'—';
const upper=v=>String(v||'').toUpperCase();
let lastSig='';

const css=`
#v21Overview{margin:10px 0 10px}
.v21-titlebar{display:flex;align-items:end;justify-content:space-between;gap:12px;margin:0 2px 8px}.v21-titlebar b{font:950 12px Inter,system-ui;color:#e6f2fa;letter-spacing:.4px}.v21-titlebar span{font:700 8px Inter,system-ui;color:#71899e}
.v21-grid{display:grid;grid-template-columns:1.15fr 1fr 1fr 1fr;gap:8px}.v21-card{min-width:0;border:1px solid #19384b;border-radius:13px;background:linear-gradient(145deg,#07131d,#061019);padding:11px;box-shadow:0 10px 24px #0003}.v21-card .lab{display:block;font:900 7px Inter,system-ui;letter-spacing:.8px;color:#71899e;text-transform:uppercase}.v21-card .main{display:block;margin-top:5px;font:950 17px/1.08 Inter,system-ui;color:#ecf5fb;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.v21-card .sub{display:block;margin-top:6px;font:650 8.5px/1.4 Inter,system-ui;color:#91a8ba;min-height:24px}.v21-kpis{display:flex;gap:7px;flex-wrap:wrap;margin-top:7px}.v21-kpis span{font:800 7px Inter,system-ui;color:#8499aa;border:1px solid #173043;border-radius:999px;padding:4px 6px;background:#061019}
.v21-now .main{color:#53b7ff}.v21-position.good .main,.v21-next.buy .main{color:#3be497}.v21-position.bad .main,.v21-next.sell .main{color:#ff6878}.v21-position.warn .main,.v21-next.wait .main{color:#ffbf58}
.v21-section-label{margin:12px 2px 7px;font:900 8px Inter,system-ui;color:#6f879a;letter-spacing:1px;text-transform:uppercase}
body.zc-focus #v10Focus .v10-top{display:none!important}
body.zc-focus #v19Precision .v19gates,body.zc-focus #v19Precision .v19row,body.zc-focus #v19Precision .v19elite{display:none!important}
body.zc-focus #v19Precision{margin-top:0!important}
body.zc-focus #v19Precision .v19top{padding:12px!important}
body.zc-focus #v19Precision .v19ey{font-size:8px!important}
body.zc-focus #v19Precision .v19decision{font-size:21px!important}
body.zc-focus #v20Guard{margin-top:0!important}
body.zc-focus #v10Focus{margin-top:0!important}
body.zc-focus .v10-plan{margin-top:0!important}
body.zc-focus #v10Focus .v10-coach{margin-top:8px!important}
body.zc-focus #v10Focus .v10-shield{margin-top:7px!important}
body.zc-focus .v6-grid{margin-top:6px!important}
@media(max-width:1100px){.v21-grid{grid-template-columns:1fr 1fr}}
@media(max-width:650px){.v21-grid{grid-template-columns:1fr}.v21-titlebar{align-items:start;flex-direction:column}.v21-card .main{font-size:16px}}
`;
const st=document.createElement('style');st.id='v21Style';st.textContent=css;document.head.appendChild(st);

function makeLabel(id,text){
  let e=q(id);if(e)return e;
  e=document.createElement('div');e.id=id;e.className='v21-section-label';e.textContent=text;
  return e;
}
function ensureOverview(){
  let e=q('v21Overview');if(e)return e;
  e=document.createElement('section');e.id='v21Overview';
  e.innerHTML=`
    <div class="v21-titlebar"><b>ZENCORE TRADER VIEW</b><span>Sekarang → Position → Next Move → Trade Plan</span></div>
    <div class="v21-grid">
      <div class="v21-card v21-now"><span class="lab">📍 Market Sekarang</span><b class="main" id="v21NowMain">Tunggu data...</b><span class="sub" id="v21NowSub">ZenCore tengah baca market.</span><div class="v21-kpis"><span id="v21Price">Price —</span><span id="v21Feed">Data —</span></div></div>
      <div class="v21-card v21-position warn" id="v21PosCard"><span class="lab">🛡️ Position</span><b class="main" id="v21PosMain">NO POSITION</b><span class="sub" id="v21PosSub">Tunggu setup yang cun.</span><div class="v21-kpis"><span id="v21CurrentR">Current R —</span><span id="v21PeakR">Peak R —</span></div></div>
      <div class="v21-card"><span class="lab">📊 Analysis Sekarang</span><b class="main" id="v21AnaMain">Tunggu analysis...</b><span class="sub" id="v21AnaSub">HEMA • Momentum • MTF</span><div class="v21-kpis"><span id="v21Setup">Setup —</span><span id="v21Ready">Ready —</span></div></div>
      <div class="v21-card v21-next wait" id="v21NextCard"><span class="lab">🔮 Next Move</span><b class="main" id="v21NextMain">WAIT</b><span class="sub" id="v21NextSub">Prediction belum confirm.</span><div class="v21-kpis"><span id="v21PredScore">Confidence —</span><span id="v21Mtf">MTF —</span></div></div>
    </div>`;
  const header=document.querySelector('header.top');if(header)header.insertAdjacentElement('afterend',e);else document.body.prepend(e);
  return e;
}
function after(node,el){if(node&&el&&node.nextElementSibling!==el)node.insertAdjacentElement('afterend',el)}
function arrange(){
  const ov=ensureOverview(),v20=q('v20Guard'),v19=q('v19Precision'),v10=q('v10Focus'),grid=document.querySelector('.v6-grid');
  let anchor=ov;
  const l1=makeLabel('v21PositionLabel','POSITION & SECURE PROFIT');after(anchor,l1);anchor=l1;
  if(v20){after(anchor,v20);anchor=v20}
  const l2=makeLabel('v21PredictionLabel','NEXT MOVE / PREDICTION');after(anchor,l2);anchor=l2;
  if(v19){after(anchor,v19);anchor=v19}
  const l3=makeLabel('v21PlanLabel','TRADE PLAN & APA NAK BUAT');after(anchor,l3);anchor=l3;
  if(v10){after(anchor,v10);anchor=v10}
  if(grid){const l4=makeLabel('v21ChartLabel','CHART & MARKET CONFIRMATION');after(anchor,l4);after(l4,grid)}
}
function predictionInfo(){
  const box=q('v19Precision');
  const gate=box?.querySelector('.v19gate b')?.textContent?.trim()||'';
  const sub=box?.querySelector('.v19sub')?.textContent?.trim()||'';
  let side='WAIT',score='—';
  const m=gate.match(/\b(BUY|SELL)\s+(\d+)\/100/i);
  if(m){side=upper(m[1]);score=m[2]+'/100'}
  else{
    const m2=sub.match(/Prediction:\s*(BUY|SELL|WAIT)/i);if(m2)side=upper(m2[1]);
  }
  return{side,score,sub};
}
function positionInfo(){
  const guard=q('v20Guard'),title=guard?.querySelector('.v20action b')?.textContent?.trim()||'NO POSITION';
  const msg=guard?.querySelector('.v20action small')?.textContent?.trim()||'Tunggu setup yang cun.';
  const vals=[...guard?.querySelectorAll('.v20kpi b')||[]].map(e=>e.textContent.trim());
  let tone='warn';const u=upper(title);
  if(/PROFIT|RUNNER|TP3/.test(u))tone='good';else if(/ROSak|SL KENA|CLOSE/i.test(title))tone='bad';else if(/BUY|SELL/.test(u))tone='good';
  return{title,msg,current:vals[0]||'—',peak:vals[1]||'—',tone};
}
function analysisInfo(){
  const hema=txt('hema'),mom=txt('momentum'),mtf=txt('mtfo'),grade=txt('v10Grade'),ready=txt('v10Readiness');
  const hu=upper(hema),mu=upper(mom),mtfu=upper(mtf);
  let main='MIXED';
  const buys=[hu,mu,mtfu].filter(x=>/BUY|BULL|UP/.test(x)).length;
  const sells=[hu,mu,mtfu].filter(x=>/SELL|BEAR|DOWN/.test(x)).length;
  if(buys>=2)main='BUY SIDE KUAT';else if(sells>=2)main='SELL SIDE KUAT';else if(/CHOP|SIDEWAYS/.test(upper(txt('structure'))))main='MARKET SERABUT';
  return{main,sub:`HEMA ${hema} • Momentum ${mom} • MTF ${mtf}`,grade,ready,mtf};
}
function paint(){
  if(document.hidden)return;
  arrange();
  const now=txt('v10Decision'),nowSub=txt('v10DecisionSub'),price=txt('price'),feed=txt('feed');
  const pos=positionInfo(),ana=analysisInfo(),pr=predictionInfo();
  const sig=JSON.stringify([now,nowSub,price,feed,pos,ana,pr]);
  if(sig===lastSig)return;lastSig=sig;
  q('v21NowMain').textContent=now;q('v21NowSub').textContent=nowSub;q('v21Price').textContent=`Price ${price}`;q('v21Feed').textContent=feed;
  q('v21PosMain').textContent=pos.title;q('v21PosSub').textContent=pos.msg;q('v21CurrentR').textContent=`Current R ${pos.current}`;q('v21PeakR').textContent=`Peak R ${pos.peak}`;q('v21PosCard').className=`v21-card v21-position ${pos.tone}`;
  q('v21AnaMain').textContent=ana.main;q('v21AnaSub').textContent=ana.sub;q('v21Setup').textContent=`Setup ${ana.grade}`;q('v21Ready').textContent=`Ready ${ana.ready}`;
  q('v21NextMain').textContent=pr.side==='WAIT'?'WAIT DULU':`${pr.side} POTENTIAL`;q('v21NextSub').textContent=pr.sub||'Prediction tengah build.';q('v21PredScore').textContent=`Confidence ${pr.score}`;q('v21Mtf').textContent=`MTF ${ana.mtf}`;q('v21NextCard').className=`v21-card v21-next ${pr.side==='BUY'?'buy':pr.side==='SELL'?'sell':'wait'}`;
}
function labelTraderTerms(){
  const map=[['v10Zone','ZON ENTRY'],['v10Entry','ENTRY'],['v10Sl','SL'],['v10Tp1','TP1'],['v10Tp3','TP3'],['v10RR','R:R']];
  map.forEach(([id,label])=>{const e=q(id)?.previousElementSibling;if(e)e.textContent=label});
  const coach=q('v10Coach')?.parentElement?.querySelector('b');if(coach)coach.textContent='AI COACH — APA NAK BUAT SEKARANG';
}
function init(){
  document.body.classList.add('zc-v21');ensureOverview();setTimeout(()=>{arrange();labelTraderTerms();paint()},700);
  setInterval(paint,3000);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)paint()});
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();