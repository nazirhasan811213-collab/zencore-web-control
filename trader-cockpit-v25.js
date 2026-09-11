(function(){
'use strict';

const q=id=>document.getElementById(id);
const clamp=(v,a=0,b=100)=>Math.max(a,Math.min(b,v));
const N=v=>{const x=Number(v);return Number.isFinite(x)?x:null};
const U=v=>String(v||'').toUpperCase();
let lastHealth=null,lastState='',lastDir='';

const css=`
#v25Cockpit{grid-column:1/-1;border:1px solid #244a61;border-radius:18px;background:linear-gradient(145deg,#07141e,#061019);padding:13px;box-shadow:0 14px 34px #0004;contain:layout style paint}
.v25-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px}.v25-head-copy b{display:block;font:950 13px Inter,system-ui;color:#edf6fb;letter-spacing:.4px}.v25-head-copy span{display:block;margin-top:3px;font:650 8.5px Inter,system-ui;color:#8198aa}.v25-actions{display:flex;gap:6px;align-items:center;flex-wrap:wrap}.v26-signal{padding:6px 9px;border:1px solid #29475a;border-radius:999px;background:#07131d;color:#ffbf58;font:950 8px Inter,system-ui}.v26-signal.locked{color:#3be497;border-color:#235c45}
.v25-btn{border:1px solid #29475a;border-radius:9px;background:#07131d;color:#91a7b8;padding:6px 9px;font:900 8px Inter,system-ui;cursor:pointer}.v25-btn:hover,.v25-btn.active{color:#eef7fc;border-color:#477894;background:#0c2130}
.v26-oppbar{display:grid;grid-template-columns:52px minmax(0,1.5fr) .7fr .7fr;gap:8px;margin:0 0 10px;border:1px solid #214259;border-radius:13px;background:#061019;padding:9px;align-items:center}
.v26-oppicon{display:grid;place-items:center;height:48px;border:1px solid #24475e;border-radius:11px;background:#07131d;font-size:23px}.v26-opptxt span,.v26-oppkpi span{display:block;font:850 7px Inter,system-ui;color:#71899d;text-transform:uppercase}.v26-opptxt b{display:block;margin-top:4px;font:950 15px Inter,system-ui;color:#ffbf58}.v26-opptxt small{display:block;margin-top:4px;font:650 8.5px/1.35 Inter,system-ui;color:#8fa4b5}.v26-oppkpi{border:1px solid #173447;border-radius:10px;background:#07131d;padding:9px}.v26-oppkpi b{display:block;margin-top:5px;font:900 11px Inter,system-ui;color:#e5eff6}.v26-oppbar.strong{border-color:#235c45}.v26-oppbar.strong .v26-opptxt b{color:#3be497}.v26-oppbar.weak{border-color:#63313b}.v26-oppbar.weak .v26-opptxt b{color:#ff6878}
.v25-levels{display:grid;grid-template-columns:1.25fr repeat(5,1fr);gap:8px;margin:0 0 10px}
.v25-level{border:1px solid #17384c;border-radius:12px;background:#061019;padding:10px;min-width:0;position:relative;overflow:hidden}
.v25-level span{display:block;font:850 7px Inter,system-ui;color:#70899d;text-transform:uppercase;letter-spacing:.6px}
.v25-level b{display:block;margin-top:5px;font:950 15px Inter,system-ui;color:#e9f3f9;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.v25-level small{display:block;margin-top:4px;font:700 7.5px Inter,system-ui;color:#758da0}
.v25-level.price{border-color:#285b72;background:#071923}.v25-level.price b{font-size:20px;color:#78d9ff}
.v25-level.entry b{color:#ffbf58}.v25-level.sl b{color:#ff6878}.v25-level.tp b{color:#3be497}
.v25-level.hit{border-color:#2f805e;background:#082218}.v25-level.hit:after{content:'✓ HIT';position:absolute;right:8px;top:8px;font:950 7px Inter,system-ui;color:#3be497}
.v25-main{display:grid;grid-template-columns:5fr 7fr;gap:10px}.v25-card{border:1px solid #17384c;border-radius:14px;background:#061019;padding:12px;min-width:0}
.v25-card-title{display:flex;align-items:center;justify-content:space-between;gap:8px}.v25-card-title b{font:950 10px Inter,system-ui;color:#e3eef6;letter-spacing:.45px}.v25-card-title span{font:800 7px Inter,system-ui;color:#70899d}
.v25-gauge-area{position:relative;max-width:330px;height:178px;margin:8px auto 0}.v25-gauge{position:absolute;left:50%;bottom:18px;transform:translateX(-50%);width:280px;height:140px;overflow:hidden}
.v25-gauge-ring{position:absolute;inset:0;border-radius:280px 280px 0 0;background:conic-gradient(from 270deg at 50% 100%,#ff6878 0deg 54deg,#ffbf58 54deg 117deg,#3be497 117deg 180deg,transparent 180deg 360deg)}
.v25-gauge-ring:after{content:'';position:absolute;left:28px;right:28px;bottom:-1px;height:112px;border-radius:230px 230px 0 0;background:#061019}
.v25-needle{position:absolute;left:50%;bottom:0;width:3px;height:100px;border-radius:4px;background:#f2f7fb;transform-origin:50% 100%;transform:translateX(-50%) rotate(-90deg);transition:transform .65s cubic-bezier(.2,.8,.2,1);z-index:3}
.v25-needle:before{content:'';position:absolute;top:-5px;left:-3px;width:9px;height:9px;border-radius:50%;background:#fff}.v25-hub{position:absolute;left:50%;bottom:-8px;transform:translateX(-50%);width:23px;height:23px;border-radius:50%;background:#dcebf5;border:6px solid #102432;z-index:4}
.v25-gauge-copy{position:absolute;left:0;right:0;bottom:23px;text-align:center;z-index:5}.v25-gauge-copy b{display:block;font:950 18px/1 Inter,system-ui;color:#ffbf58}.v25-gauge-copy strong{display:block;margin-top:5px;font:950 24px Inter,system-ui;color:#edf6fb}.v25-gauge-copy small{display:block;margin-top:2px;font:700 8px Inter,system-ui;color:#8097aa}
.v25-gauge-label{position:absolute;bottom:0;font:850 7px Inter,system-ui;color:#71899d}.v25-gauge-label.left{left:7px}.v25-gauge-label.mid{left:50%;transform:translateX(-50%)}.v25-gauge-label.right{right:7px}
.v25-advice{margin-top:2px;padding:9px 10px;border:1px solid #234256;border-radius:10px;background:#07131d;font:750 9px/1.45 Inter,system-ui;color:#b4c5d2}.v25-advice b{color:#e8f3fa}
.v25-direction-main{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:11px}.v25-dir-big{grid-column:1/-1;padding:10px;border:1px solid #173447;border-radius:11px;background:#07131d}.v25-dir-big span{font:850 7px Inter,system-ui;color:#70889c;text-transform:uppercase}.v25-dir-big b{display:block;margin-top:5px;font:950 20px Inter,system-ui;color:#ffbf58}.v25-dir-big small{display:block;margin-top:5px;font:650 8.5px/1.4 Inter,system-ui;color:#8fa4b5}
.v25-dir-row{padding:10px;border:1px solid #173447;border-radius:11px;background:#07131d}.v25-dir-row .top{display:flex;justify-content:space-between;gap:8px;align-items:center}.v25-dir-row .top b{font:950 12px Inter,system-ui}.v25-dir-row .top strong{font:950 18px Inter,system-ui;color:#edf6fb}.v25-track{height:9px;border-radius:999px;background:#0b1d29;overflow:hidden;margin-top:8px}.v25-fill{height:100%;width:50%;border-radius:inherit;transition:width .65s cubic-bezier(.2,.8,.2,1)}.v25-up .v25-fill{background:#3be497}.v25-down .v25-fill{background:#ff6878}.v25-up .top b{color:#3be497}.v25-down .top b{color:#ff6878}
.v25-profit{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:10px}.v25-profit-card{border:1px solid #173447;border-radius:11px;background:#07131d;padding:10px;min-width:0}.v25-profit-card span{display:block;font:850 7px Inter,system-ui;color:#70889c;text-transform:uppercase}.v25-profit-card b{display:block;margin-top:5px;font:900 12px/1.25 Inter,system-ui;color:#e4eef5}.v25-profit-card small{display:block;margin-top:4px;font:650 8px/1.35 Inter,system-ui;color:#869dac}
.v25-retain{height:7px;border-radius:999px;background:#0b1d29;overflow:hidden;margin-top:7px}.v25-retain>i{display:block;height:100%;width:0;border-radius:inherit;background:#3be497;transition:width .65s cubic-bezier(.2,.8,.2,1)}
.v25-good .v25-gauge-copy b,.v25-good .v25-dir-big b{color:#3be497}.v25-bad .v25-gauge-copy b,.v25-bad .v25-dir-big b{color:#ff6878}.v25-wait .v25-gauge-copy b,.v25-wait .v25-dir-big b{color:#ffbf58}
.v25-burst{animation:v25Burst .65s ease 3}@keyframes v25Burst{0%,100%{transform:translateY(0)}50%{transform:translateY(-2px)}}
body.zc-focus.v25-simple #v22Market,body.zc-focus.v25-simple #v22Position,body.zc-focus.v25-simple #v22Analysis,body.zc-focus.v25-simple #v22Prediction{display:none!important}
body.zc-focus.v25-simple #v22TradePlan{grid-column:1/span 5!important}
body.zc-focus.v25-simple #v22Chart{grid-column:6/span 7!important}
body.zc-focus #v24Controls .v24-btn{display:none!important}
@media(max-width:1180px){.v25-levels{grid-template-columns:repeat(3,1fr)}.v25-main{grid-template-columns:1fr}.v25-profit{grid-template-columns:1fr 1fr}body.zc-focus.v25-simple #v22TradePlan,body.zc-focus.v25-simple #v22Chart{grid-column:1/-1!important}}
@media(max-width:650px){.v26-oppbar{grid-template-columns:44px 1fr}.v26-oppkpi{grid-column:1/-1}.v25-levels{grid-template-columns:1fr 1fr}.v25-level.price{grid-column:1/-1}.v25-profit{grid-template-columns:1fr}.v25-direction-main{grid-template-columns:1fr}.v25-gauge-area{max-width:290px}.v25-gauge{width:250px;height:125px}.v25-gauge-ring:after{left:26px;right:26px;height:100px}.v25-needle{height:88px}.v25-head{align-items:flex-start;flex-direction:column}}
@media(prefers-reduced-motion:reduce){.v25-needle,.v25-fill,.v25-retain>i{transition:none!important}.v25-burst{animation:none!important}}
`;
const st=document.createElement('style');st.id='v25Style';st.textContent=css;document.head.appendChild(st);

function ensure(){
  let e=q('v25Cockpit');if(e)return e;
  e=document.createElement('section');e.id='v25Cockpit';e.className='v25-wait';
  e.innerHTML=`
    <div class="v25-head">
      <div class="v25-head-copy"><b>🚘 TRADER DECISION COCKPIT</b><span>Tengok meter → faham keadaan → ikut action. Nombor teknikal disimpan dalam Detail Teknikal.</span></div>
      <div class="v25-actions"><span class="v26-signal" id="v26SignalBadge">SIGNAL: WAIT</span><button class="v25-btn active" id="v25TraderBtn">TRADER VIEW</button><button class="v25-btn" id="v25DetailBtn">DETAIL TEKNIKAL</button></div>
    </div>
    <div class="v26-oppbar" id="v26OppBar"><div class="v26-oppicon" id="v26OppIcon">↩️</div><div class="v26-opptxt"><span>Signal Pullback / Re-entry</span><b id="v26OppTitle">TIADA TRIGGER SEKARANG</b><small id="v26OppReason">Tunggu price buat setup pullback yang betul-betul confirm.</small></div><div class="v26-oppkpi"><span>Strength</span><b id="v26OppStrength">—</b></div><div class="v26-oppkpi"><span>Action</span><b id="v26OppAction">WAIT</b></div></div>
    <div class="v25-levels" id="v25Levels">
      <div class="v25-level price"><span>📍 Price Sekarang</span><b id="v25LivePrice">—</b><small>Harga live market</small></div>
      <div class="v25-level entry"><span>🎯 Entry</span><b id="v25LiveEntry">—</b><small>Harga masuk plan</small></div>
      <div class="v25-level sl"><span>🛑 Stop Loss</span><b id="v25LiveSl">—</b><small>Protection level</small></div>
      <div class="v25-level tp" id="v25Tp1Card"><span>💰 TP1</span><b id="v25LiveTp1">—</b><small>Target pertama</small></div>
      <div class="v25-level tp" id="v25Tp2Card"><span>💰 TP2</span><b id="v25LiveTp2">—</b><small>Target kedua</small></div>
      <div class="v25-level tp" id="v25Tp3Card"><span>🚀 TP3</span><b id="v25LiveTp3">—</b><small>Target akhir</small></div>
    </div>
    <div class="v25-main">
      <div class="v25-card">
        <div class="v25-card-title"><b>🛡️ TRADE HEALTH METER</b><span>Bahaya → Jaga → Masih Cun</span></div>
        <div class="v25-gauge-area">
          <div class="v25-gauge"><div class="v25-gauge-ring"></div><div class="v25-needle" id="v25Needle"></div><div class="v25-hub"></div></div>
          <div class="v25-gauge-copy"><b id="v25HealthLabel">TUNGGU DATA</b><strong id="v25HealthScore">—</strong><small>Keadaan trade sekarang</small></div>
          <span class="v25-gauge-label left">BAHAYA</span><span class="v25-gauge-label mid">JAGA</span><span class="v25-gauge-label right">CUN</span>
        </div>
        <div class="v25-advice"><b id="v25AdviceTitle">Cadangan:</b> <span id="v25Advice">Tunggu data position.</span></div>
      </div>
      <div class="v25-card">
        <div class="v25-card-title"><b>🔮 JANGKAAN ARAH SETERUSNYA</b><span>Anggaran kekuatan bias sistem • bukan win rate</span></div>
        <div class="v25-direction-main">
          <div class="v25-dir-big"><span>Arah Dominan</span><b id="v25DirLabel">ARAH BELUM CLEAR</b><small id="v25DirWhy">ZenCore tengah kumpul confirmation.</small></div>
          <div class="v25-dir-row v25-up"><div class="top"><b>⬆ HARGA NAIK</b><strong id="v25UpPct">50%</strong></div><div class="v25-track"><div class="v25-fill" id="v25UpBar"></div></div></div>
          <div class="v25-dir-row v25-down"><div class="top"><b>⬇ HARGA TURUN</b><strong id="v25DownPct">50%</strong></div><div class="v25-track"><div class="v25-fill" id="v25DownBar"></div></div></div>
        </div>
        <div class="v25-advice"><b>Nota:</b> % ini tunjuk balance/kekuatan arah daripada Prediction + Stability + Agreement + Confirmation. Ia bukan probability pasti market naik/turun.</div>
      </div>
    </div>
    <div class="v25-profit">
      <div class="v25-profit-card"><span>💰 Profit Sekarang</span><b id="v25ProfitNow">Belum ada trade aktif</b><small id="v25ProfitNowSub">Tunggu position.</small></div>
      <div class="v25-profit-card"><span>🏆 Profit Paling Tinggi</span><b id="v25ProfitPeak">Belum ada peak profit</b><small>Profit terbaik yang trade sempat capai.</small></div>
      <div class="v25-profit-card"><span>🛡️ Profit Masih Disimpan</span><b id="v25RetainText">—</b><small id="v25RetraceText">Belum ada data retrace.</small><div class="v25-retain"><i id="v25RetainBar"></i></div></div>
      <div class="v25-profit-card"><span>✅ Keadaan Setup</span><b id="v25SetupText">Tunggu analysis</b><small id="v25SetupSub">ZenCore tengah check setup.</small></div>
    </div>`;
  const flow=q('v22Flow'),anchor=q('v23ActionBar')||flow?.querySelector('.v22-legend');
  if(anchor)anchor.insertAdjacentElement('afterend',e);else flow?.prepend(e);
  q('v25TraderBtn')?.addEventListener('click',()=>setMode(true));
  q('v25DetailBtn')?.addEventListener('click',()=>setMode(false));
  return e;
}

function setMode(simple){
  document.body.classList.toggle('v25-simple',simple);
  q('v25TraderBtn')?.classList.toggle('active',simple);
  q('v25DetailBtn')?.classList.toggle('active',!simple);
  try{localStorage.setItem('zcV25Simple',simple?'1':'0')}catch(_){}
}
function restoreMode(){
  let simple=true;try{const v=localStorage.getItem('zcV25Simple');if(v==='0')simple=false}catch(_){}
  setMode(simple);
}
function setupScore(x){
  if(!x)return{score:50,label:'TUNGGU DATA',tone:'wait'};
  if(x.state==='CLOSED')return{score:100,label:'TRADE SETTLE',tone:'good'};
  if(x.state==='STOP')return{score:10,label:'TRADE DAH CLOSED',tone:'bad'};
  if(x.state==='IDLE')return{score:50,label:'BELUM ADA POSITION',tone:'wait'};
  let score=50+(N(x.strong)||0)*8-(N(x.warn)||0)*12;
  const cur=N(x.current),peak=N(x.peak);
  if(cur!=null&&cur>0)score+=6;
  if(peak!=null&&peak>0&&cur!=null){
    const retained=clamp(cur/peak*100,0,100);
    score+=(retained-50)*.24;
  }
  if(x.state==='PROFIT')score+=8;
  if(x.state==='HOLD')score+=12;
  if(x.state==='SECURE')score-=8;
  if(x.state==='PARTIAL')score-=10;
  if(x.state==='DELAY')score-=18;
  if(x.state==='EXIT'||x.state==='CUT')score-=38;
  score=Math.round(clamp(score));
  let label='JAGA POSITION',tone='wait';
  if(score>=66){label='SETUP MASIH CUN';tone='good'}
  else if(score<=30){label='SETUP DAH BAHAYA';tone='bad'}
  else if(x.state==='SECURE'){label='PROFIT MULA BOCOR'}
  else if(x.state==='PARTIAL'){label='MOMENTUM DAH SLOW'}
  return{score,label,tone};
}
function advice(x,h){
  if(!x)return['Tunggu data','ZenCore belum ada maklumat position.'];
  const map={
    HOLD:['Boleh hold','Setup masih kuat. Bagi runner jalan sambil jaga profit.'],
    PROFIT:['Jaga profit','Alhamdulillah, trade dah profit. Monitor pullback.'],
    SECURE:['Secure position','Profit dah retrace banyak. Jaga profit dulu.'],
    PARTIAL:['Boleh close separuh','Momentum dah slow. Lock sebahagian profit kalau sesuai dengan plan.'],
    EXIT:['Close position','Setup dah rosak walaupun masih profit. Jangan bagi profit hilang.'],
    CUT:['Cut awal','Setup dah rosak dan trade dah negatif. Jangan tunggu loss membesar.'],
    DELAY:['Jaga position','Data lambat. Jangan tambah position ikut data lama.'],
    CLOSED:['Tunggu setup baru','TP3 settle. Jangan kejar market.'],
    STOP:['Tunggu setup baru','Trade dah closed. Jangan revenge trade.'],
    IDLE:['Tunggu setup','Belum ada position aktif.']
  };
  return map[x.state]||[h.tone==='good'?'Hold & monitor':'Tunggu dulu',x.msg||'Ikut plan dan tunggu confirmation.'];
}
function profitWords(x){
  const cur=N(x?.current),peak=N(x?.peak);
  if(x?.state==='IDLE'||cur==null)return{now:'Belum ada trade aktif',nowSub:'Tunggu position.',peak:'Belum ada peak profit',retain:null,retrace:null};
  let now='Sekitar entry',nowSub='Trade belum bergerak jauh.';
  if(cur>=1.5){now='Profit sangat cantik';nowSub='Trade dah bergerak jauh dari entry.'}
  else if(cur>=.8){now='Profit cantik';nowSub='Trade tengah dalam profit yang selesa.'}
  else if(cur>=.3){now='Trade tengah untung';nowSub='Profit dah ada, terus monitor.'}
  else if(cur>0){now='Profit kecil, masih positif';nowSub='Belum banyak ruang untuk secure.'}
  else if(cur<=-.15){now='Trade tengah negatif';nowSub='Pantau setup dan warning.'}
  const peakText=peak>=1.5?'Tadi profit sangat cantik':peak>=.8?'Tadi profit sempat pergi cantik':peak>0?'Trade pernah berada dalam profit':'Belum ada peak profit';
  const retain=peak>0&&cur!=null?Math.round(clamp(cur/peak*100,0,100)):null;
  const retrace=retain==null?null:100-retain;
  return{now,nowSub,peak:peakText,retain,retrace};
}
function direction(p){
  if(!p)return{up:50,down:50,label:'ARAH BELUM CLEAR',why:'Prediction belum cukup data.',tone:'wait'};
  const side=U(p.rawSide||p.side),conf=N(p.rawConf??p.conf)||0,st=N(p.st)||0,agree=N(p.agree)||0,passed=N(p.rawC?.passed)||0;
  let strength=conf*.45+st*.25+agree*.20+(passed/4)*10;
  let edge=clamp((strength-50)*.75,0,35);
  if(p.conflict)edge*=.4;
  if(p.fresh!=='LIVE')edge*=.35;
  if(side==='WAIT')edge=0;
  let up=50,down=50;
  if(side==='BUY'){up=Math.round(50+edge);down=100-up}
  else if(side==='SELL'){down=Math.round(50+edge);up=100-down}
  up=clamp(up,15,85);down=100-up;
  let label='ARAH BELUM CLEAR',tone='wait',why='BUY dan SELL masih dekat. Jangan kejar.';
  if(Math.abs(up-down)>=18){
    if(up>down){label='HARGA CENDERUNG NAIK';tone='good';why='Bias BUY lebih dominan dalam bacaan ZenCore.'}
    else{label='HARGA CENDERUNG TURUN';tone='good';why='Bias SELL lebih dominan dalam bacaan ZenCore.'}
  }
  if(p.conflict){label='ARAH TENGAH BERCANGGAH';tone='wait';why='Signal dalaman belum cukup sehala.'}
  return{up,down,label,why,tone};
}
function setupWords(x){
  if(!x)return['Tunggu analysis','Belum cukup data setup.'];
  const strong=N(x.strong)||0,warn=N(x.warn)||0;
  if(warn>=3)return['Setup dah rosak',`${warn} warning aktif. Elok utamakan protection.`];
  if(warn>=2)return['Setup mula lemah',`${strong} tanda masih kuat • ${warn} warning mula keluar.`];
  if(strong>=4&&warn===0)return['Setup masih kuat',`${strong} tanda utama masih okay • tiada warning.`];
  return['Setup masih okay',`${strong} tanda kuat • ${warn} warning.`];
}
function domText(id){return q(id)?.textContent?.trim()||'—'}
function opportunityPaint(p){
  const bar=q('v26OppBar');if(!bar)return;
  const type=U(p?.opportunityType||'NONE'),side=U(p?.opportunitySide||'WAIT'),strength=U(p?.opportunityStrength||'NONE'),risk=U(p?.opportunityRisk||'WAIT'),reason=p?.opportunityReason||'';
  bar.classList.remove('strong','weak');
  if(strength==='STRONG')bar.classList.add('strong');else if(strength==='WEAK'||risk==='NO_ADD')bar.classList.add('weak');
  let icon='↩️',title='TIADA TRIGGER SEKARANG',action='WAIT';
  if(type==='PULLBACK'){icon='↩️';title=`${side} PULLBACK DETECTED`;}
  else if(type==='REENTRY'){icon='🔁';title=`${side} RE-ENTRY DETECTED`;}
  else if(type==='MOMENTUM'){icon='🚀';title=`${side} MOMENTUM CONTINUATION`;}
  if(type!=='NONE'){
    if(risk==='NO_ADD')action='JANGAN ADD';
    else if(risk==='MANAGE_RISK')action='MANAGE RISK';
    else action='WATCH ENTRY';
  }
  q('v26OppIcon').textContent=icon;q('v26OppTitle').textContent=title;q('v26OppReason').textContent=reason||'Tunggu trigger baru.';q('v26OppStrength').textContent=strength==='NONE'?'—':strength;q('v26OppAction').textContent=action;
}
function levelPaint(){
  const price=domText('price'),entry=domText('entry'),sl=domText('sl'),tp1=domText('tp1'),tp2=domText('tp2'),tp3=domText('tp3');
  q('v25LivePrice').textContent=price;q('v25LiveEntry').textContent=entry;q('v25LiveSl').textContent=sl;q('v25LiveTp1').textContent=tp1;q('v25LiveTp2').textContent=tp2;q('v25LiveTp3').textContent=tp3;
  const x=window.__ZENCORE_SECURE_STATE__||{};
  q('v25Tp1Card')?.classList.toggle('hit',x?.state==='CLOSED'||q('hits')?.textContent?.includes('TP1'));
  q('v25Tp2Card')?.classList.toggle('hit',x?.state==='CLOSED'||q('hits')?.textContent?.includes('TP2'));
  q('v25Tp3Card')?.classList.toggle('hit',x?.state==='CLOSED'||q('hits')?.textContent?.includes('TP3'));
}
function burst(e){if(!e)return;e.classList.remove('v25-burst');void e.offsetWidth;e.classList.add('v25-burst');setTimeout(()=>e.classList.remove('v25-burst'),2200)}
function paint(){
  if(document.hidden)return;
  const e=ensure(),x=window.__ZENCORE_SECURE_STATE__||null,p=window.__ZENCORE_PREDICTION_STATE__||null;
  const h=setupScore(x),a=advice(x,h),pw=profitWords(x),d=direction(p),sw=setupWords(x);opportunityPaint(p);levelPaint();
  e.className='v25-'+h.tone;
  const angle=-90+h.score*1.8;q('v25Needle').style.transform=`translateX(-50%) rotate(${angle}deg)`;
  q('v25HealthLabel').textContent=h.label;q('v25HealthScore').textContent=h.score+'/100';q('v25AdviceTitle').textContent='Cadangan: '+a[0];q('v25Advice').textContent=a[1];
  q('v25DirLabel').textContent=d.label;q('v25DirWhy').textContent=d.why;q('v25UpPct').textContent=d.up+'%';q('v25DownPct').textContent=d.down+'%';q('v25UpBar').style.width=d.up+'%';q('v25DownBar').style.width=d.down+'%';
  q('v25ProfitNow').textContent=pw.now;q('v25ProfitNowSub').textContent=pw.nowSub;q('v25ProfitPeak').textContent=pw.peak;
  if(pw.retain==null){q('v25RetainText').textContent='Belum ada data';q('v25RetraceText').textContent='Belum ada profit untuk dibandingkan.';q('v25RetainBar').style.width='0%'}
  else{q('v25RetainText').textContent=`Masih simpan ${pw.retain}% daripada peak profit`;q('v25RetraceText').textContent=pw.retrace<=10?'Profit masih dijaga elok.':`${pw.retrace}% profit dah retrace dari puncak.`;q('v25RetainBar').style.width=pw.retain+'%'}
  q('v25SetupText').textContent=sw[0];q('v25SetupSub').textContent=sw[1];const sb=q('v26SignalBadge');if(sb){const ss=U(p?.side||'WAIT'),locked=!!p?.signalLocked;sb.textContent=ss==='WAIT'?'SIGNAL: WAIT':locked?`🔒 SIGNAL ${ss}`:`👀 WATCH ${ss}`;sb.classList.toggle('locked',locked)}
  if(lastHealth!=null&&Math.abs(h.score-lastHealth)>=4)burst(q('v25Cockpit'));lastHealth=h.score;
  if(lastState!==String(x?.state||'')){burst(q('v25Cockpit'));lastState=String(x?.state||'')}
  const dirSig=d.label+d.up;if(lastDir&&lastDir!==dirSig)burst(q('v25Cockpit'));lastDir=dirSig;
  const brand=document.querySelector('header.top .brand h1');if(brand)brand.textContent='ZENCORE V26.1 — SIGNAL CORE + PULLBACK';
  const phases=document.querySelectorAll('header.top .phase-pill');if(phases.length)phases[phases.length-1].textContent='SIGNAL STABIL • ENTRY TERPILIH';
}
function init(){
  setTimeout(()=>{ensure();restoreMode();paint()},1550);
  document.addEventListener('zencore:secure-state',paint);
  document.addEventListener('zencore:prediction-state',paint);
  document.addEventListener('zencore:flow-updated',paint);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)paint()});
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();