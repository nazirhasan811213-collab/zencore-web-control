(function(){
'use strict';

const symbol=String(window.__ZENCORE_PAIR__||'XAUUSD').toUpperCase();
const N=v=>{if(v===null||v===undefined||v===''||v==='null')return null;const x=Number(v);return Number.isFinite(x)?x:null};
const U=v=>String(v||'').toUpperCase();
const clamp=(v,a=0,b=100)=>Math.max(a,Math.min(b,v));
let latest=null,pred=null,peakR=0,tradeKey='',lastState='',lastRenderSig='';

function dir(v){
  const s=U(v);
  if(/BUY|LONG|BULL|UPTREND|STRONG BULL/.test(s))return'BUY';
  if(/SELL|SHORT|BEAR|DOWNTREND|STRONG BEAR/.test(s))return'SELL';
  return'WAIT';
}
function side(d){
  if(d?.tradeIsBuy===true)return'BUY';
  if(d?.tradeIsBuy===false)return'SELL';
  const a=dir(d?.action);return a==='WAIT'?'TRADE':a;
}
function risk(d){const e=N(d?.entry),sl=N(d?.sl);return e==null||sl==null?null:Math.abs(e-sl)}
function currentR(d,s){
  const e=N(d?.entry),c=N(d?.close),r=risk(d);if(e==null||c==null||!r)return null;
  return s==='BUY'?(c-e)/r:s==='SELL'?(e-c)/r:null;
}
function favorableR(d,s){
  const e=N(d?.entry),r=risk(d),h=N(d?.high),l=N(d?.low);if(e==null||!r)return null;
  if(s==='BUY'&&h!=null)return(h-e)/r;
  if(s==='SELL'&&l!=null)return(e-l)/r;
  return null;
}
function feedLive(d){const t=N(d?.receivedAt);return !!t&&Date.now()-t<90000}
function fmtR(v){return N(v)==null?'—':`${v>=0?'+':''}${v.toFixed(2)}R`}
function mtf(d,s){
  const a=[N(d?.mtf1),N(d?.mtf2),N(d?.mtf3)];
  const same=a.filter(v=>v!=null&&(s==='BUY'?v>0:v<0)).length;
  const opp=a.filter(v=>v!=null&&(s==='BUY'?v<0:v>0)).length;
  return{same,opp};
}
function evidence(d,s){
  const ps=dir(pred?.prediction),pc=N(pred?.predictionConfidence)||0;
  const hd=dir(d?.hemaTrend),md=dir(d?.momentum),sd=dir(d?.marketStructure),m=mtf(d,s),ch=N(d?.chopIndex);
  let warn=0,strong=0;const notes=[];
  if(ps===s&&pc>=65){strong++;notes.push('Bias masih sehala')}else if(ps!=='WAIT'&&ps!==s&&pc>=65){warn++;notes.push('Bias dah lawan')};
  if(hd===s){strong++;notes.push('HEMA masih cun')}else if(hd!=='WAIT'&&hd!==s){warn++;notes.push('HEMA dah flip')};
  if(md===s){strong++;notes.push('Momentum masih jalan')}else if(md!=='WAIT'&&md!==s){warn++;notes.push('Momentum dah lawan')};
  if(sd===s){strong++;notes.push('Structure masih okay')}else if(sd!=='WAIT'&&sd!==s){warn++;notes.push('Structure dah pecah')};
  if(m.same>=2){strong++;notes.push(`MTF ${m.same}/3 sehala`)}else if(m.opp>=2){warn++;notes.push(`MTF ${m.opp}/3 dah lawan`)};
  if(ch!=null&&ch>=61.8){warn++;notes.push('Market makin serabut')};
  return{warn,strong,notes,ps,pc,m,ch};
}
function makeKey(d,s){
  return [symbol,s,N(d?.entry),N(d?.sl),N(d?.tp3)].join('|');
}
function restorePeak(k){
  try{const saved=JSON.parse(sessionStorage.getItem('zcV20Peak')||'{}');return saved.key===k&&Number.isFinite(+saved.peak)?+saved.peak:0}catch(_){return 0}
}
function savePeak(k,p){
  try{sessionStorage.setItem('zcV20Peak',JSON.stringify({key:k,peak:p}))}catch(_){}
}
function assess(d){
  const s=side(d),tp3=d?.tp3Hit===true,sl=d?.slHit===true&&!tp3,active=d?.tradeActive===true&&!tp3&&!sl;
  if(!active){
    if(tp3)return{state:'CLOSED',tone:'good',title:'TP3 SETTLE',msg:'Alhamdulillah, TP3 dah kena. Trade settle.',action:'WAIT NEXT SETUP',s,current:null,peak:peakR,giveback:0,warn:0,strong:0,notes:[]};
    if(sl)return{state:'STOP',tone:'bad',title:'SL KENA',msg:'Trade dah closed. Jangan revenge, tunggu setup baru.',action:'WAIT NEXT SETUP',s,current:null,peak:peakR,giveback:0,warn:0,strong:0,notes:[]};
    return{state:'IDLE',tone:'wait',title:'BELUM ADA TRADE RUNNING',msg:'Secure Profit Guard tunggu position aktif.',action:'WAIT SETUP',s,current:null,peak:0,giveback:0,warn:0,strong:0,notes:[]};
  }
  const k=makeKey(d,s);
  if(k!==tradeKey){tradeKey=k;peakR=restorePeak(k);lastState=''}
  const cr=currentR(d,s),fr=favorableR(d,s);
  if(cr!=null)peakR=Math.max(peakR,cr);
  if(fr!=null)peakR=Math.max(peakR,fr);
  peakR=Math.max(0,peakR);savePeak(k,peakR);
  const giveback=cr==null?0:Math.max(0,peakR-cr);
  const givePct=peakR>0?giveback/peakR*100:0;
  const ev=evidence(d,s);
  const live=feedLive(d);
  let state='RUNNING',tone=s==='BUY'?'buy':'sell',title=`${s} RUNNING`,msg='Trade tengah jalan. Bagi setup ruang.',action='HOLD PLAN';

  if(!live){
    state='DELAY';tone='wait';title='DATA DELAY';msg='Data tengah lambat. Jangan buat keputusan baru ikut data lama.';action='JAGA POSITION';
  }else if(cr!=null&&cr<=-0.15&&ev.warn>=3){
    state='CUT';tone='bad';title='SETUP DAH ROSAK';msg='Setup dah rosak — cut awal, jangan tunggu SL penuh.';action='CLOSE / CUT EARLY';
  }else if(cr!=null&&cr>0&&ev.warn>=3){
    state='EXIT';tone='bad';title='SETUP DAH ROSAK';msg='Setup dah rosak — close sekarang, ambil profit.';action='CLOSE POSITION';
  }else if(peakR>=0.50&&cr!=null&&cr>0&&giveback>=0.35&&(givePct>=35||ev.warn>=2)){
    state='SECURE';tone='warn';title='PROFIT BOCOR';msg='Profit bocor — Pull Back Secure Position.';action='SECURE POSITION';
  }else if((d?.tp1Hit===true||cr>=0.50)&&ev.warn>=2){
    state='PARTIAL';tone='warn';title='MOMENTUM DAH SLOW';msg='Momentum dah slow — Momentum Slow Boleh Close Separuh.';action='CLOSE SEPARUH';
  }else if((d?.tp2Hit===true||(cr!=null&&cr>=0.80))&&ev.strong>=4&&giveback<0.30){
    state='HOLD';tone='good';title='RUNNER MASIH CUN';msg='Runner masih cun — Setup Masih Kuat boleh hold.';action='HOLD RUNNER';
  }else if(cr!=null&&cr>=0.30){
    state='PROFIT';tone='good';title='SETUP DAH PROFIT';msg='Profit dah ada — Alhamdulillah Setup Dah profit.';action=d?.tp1Hit===true?'JAGA PROFIT / BE':'HOLD & MONITOR';
  }
  return{state,tone,title,msg,action,s,current:cr,peak:peakR,giveback,warn:ev.warn,strong:ev.strong,notes:ev.notes.slice(-4),givePct,live};
}

const css=`
#v20Guard{margin:0 0 12px;border:1px solid #1f4055;border-radius:15px;background:linear-gradient(135deg,#07131d,#08131b);padding:12px;box-shadow:0 12px 30px #0004}
.v20head{display:flex;align-items:center;justify-content:space-between;gap:10px}.v20head b{font:900 11px Inter,system-ui;color:#dceaf5;letter-spacing:.5px}.v20badge{font:900 8px Inter,system-ui;padding:5px 8px;border-radius:999px;border:1px solid #29475d;color:#86a2b8}
.v20main{display:grid;grid-template-columns:1.4fr repeat(4,.55fr);gap:7px;margin-top:9px}.v20action,.v20kpi{border:1px solid #183244;border-radius:10px;background:#061019;padding:10px;min-width:0}.v20action span,.v20kpi span{display:block;font:800 7px Inter,system-ui;color:#70879b;text-transform:uppercase;letter-spacing:.55px}.v20action b{display:block;margin-top:5px;font:950 17px Inter,system-ui;color:#ffbf58}.v20action small{display:block;margin-top:5px;font:650 9px/1.45 Inter,system-ui;color:#b5c4d1}.v20kpi b{display:block;margin-top:5px;font:900 13px Inter,system-ui;color:#e6f0f7}
.v20notes{margin-top:7px;font:700 8px/1.45 Inter,system-ui;color:#8197aa}.v20-good{border-color:#23523f!important}.v20-good .v20action b{color:#3be497}.v20-warn{border-color:#6a5123!important}.v20-warn .v20action b{color:#ffc15c}.v20-bad{border-color:#64303a!important}.v20-bad .v20action b{color:#ff6677}.v20-buy .v20action b{color:#3be497}.v20-sell .v20action b{color:#ff6677}
.v20flash{animation:v20pulse 1.1s ease-in-out 3}@keyframes v20pulse{50%{box-shadow:0 0 0 2px #ffbf5844,0 0 28px #ffbf5822}}
#v20Toast{position:fixed;right:18px;bottom:18px;z-index:9999;max-width:360px;padding:12px 14px;border-radius:12px;background:#0a1620;border:1px solid #375268;box-shadow:0 18px 48px #0009;color:#e8f2f8;font:800 10px/1.45 Inter,system-ui;transform:translateY(18px);opacity:0;pointer-events:none;transition:.2s}#v20Toast.show{transform:none;opacity:1}
@media(max-width:900px){.v20main{grid-template-columns:1fr 1fr}.v20action{grid-column:1/-1}}
`;
const st=document.createElement('style');st.textContent=css;document.head.appendChild(st);

function host(){
  let e=document.getElementById('v20Guard');if(e)return e;
  e=document.createElement('section');e.id='v20Guard';
  const a=document.getElementById('v10Focus')||document.getElementById('v19Precision');
  if(a)a.insertAdjacentElement('afterend',e);else document.body.prepend(e);
  return e;
}
function toast(text){
  let t=document.getElementById('v20Toast');if(!t){t=document.createElement('div');t.id='v20Toast';document.body.appendChild(t)}
  t.textContent=text;t.classList.add('show');clearTimeout(toast._t);toast._t=setTimeout(()=>t.classList.remove('show'),6500);
}
function render(d){
  if(!d||document.hidden)return;
  const x=assess(d),e=host();window.__ZENCORE_SECURE_STATE__=x;try{document.dispatchEvent(new CustomEvent('zencore:secure-state',{detail:x}))}catch(_){}
  const sig=JSON.stringify([x.state,x.current,x.peak,x.giveback,x.warn,x.strong,d?.receivedAt]);
  if(sig===lastRenderSig)return;lastRenderSig=sig;
  e.className=x.tone==='good'?'v20-good':x.tone==='warn'?'v20-warn':x.tone==='bad'?'v20-bad':x.tone==='buy'?'v20-buy':x.tone==='sell'?'v20-sell':'';
  e.innerHTML=`<div class="v20head"><b>🛡️ SECURE PROFIT GUARD</b><span class="v20badge">${x.action}</span></div><div class="v20main"><div class="v20action"><span>Apa Nak Buat Sekarang</span><b>${x.title}</b><small>${x.msg}</small></div><div class="v20kpi"><span>Current R</span><b>${fmtR(x.current)}</b></div><div class="v20kpi"><span>Peak R</span><b>${fmtR(x.peak)}</b></div><div class="v20kpi"><span>Profit Bocor</span><b>${fmtR(x.giveback)}</b></div><div class="v20kpi"><span>Keadaan Setup</span><b>${x.strong} kuat • ${x.warn} warning</b></div></div><div class="v20notes">${x.notes.length?x.notes.join(' • '):'Guard tengah monitor trade dan profit giveback.'}</div>`;
  const important=['SECURE','PARTIAL','EXIT','CUT'].includes(x.state);
  if(x.state!==lastState&&important){e.classList.add('v20flash');setTimeout(()=>e.classList.remove('v20flash'),3500);toast(`${x.title} — ${x.msg}`)}
  lastState=x.state;
}
async function boot(){
  try{
    const [mr,pr]=await Promise.all([
      fetch(`/api/market/${encodeURIComponent(symbol)}`,{cache:'no-store'}),
      fetch(`/api/prediction/${encodeURIComponent(symbol)}`,{cache:'no-store'})
    ]);
    if(mr.ok)latest=await mr.json();if(pr.ok)pred=await pr.json();render(latest);
  }catch(_){}
}
try{
  const es=new EventSource('/events');
  es.onmessage=ev=>{try{const d=JSON.parse(ev.data);if(d&&U(d.symbol)===symbol){latest=d;render(d)}}catch(_){}};
}catch(_){}
setInterval(()=>{if(!document.hidden)boot()},30000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)boot()});
boot();
})();