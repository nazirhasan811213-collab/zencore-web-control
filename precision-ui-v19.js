(function(){
'use strict';
const symbol=String(window.__ZENCORE_PAIR__||'XAUUSD').toUpperCase();
const N=v=>{if(v===null||v===undefined||v===''||v==='null')return null;const x=Number(v);return Number.isFinite(x)?x:null};
const U=v=>String(v||'').toUpperCase();
const clamp=(v,a=0,b=100)=>Math.max(a,Math.min(b,v));
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot',"'":'&#39;'}[c]));
let pred=null,raw=null,lastRender=0,lastSignature='';
function dir(v){const s=U(v);if(/BUY|LONG|BULL|UPTREND|STRONG BULL/.test(s))return'BUY';if(/SELL|SHORT|BEAR|DOWNTREND|STRONG BEAR/.test(s))return'SELL';return'WAIT'}
function exactAction(v){const s=U(v);return s==='BUY'||s==='SELL'?s:'WAIT'}
function rr(d){const e=N(d?.entry),sl=N(d?.sl),tp=N(d?.tp3);if(e==null||sl==null||tp==null)return null;const r=Math.abs(e-sl);return r?Math.abs(tp-e)/r:null}
function geometry(d,side){const e=N(d?.entry),sl=N(d?.sl),t1=N(d?.tp1),t2=N(d?.tp2),t3=N(d?.tp3);if([e,sl,t1,t2,t3].some(v=>v==null))return false;return side==='BUY'?sl<e&&e<t1&&t1<t2&&t2<t3:side==='SELL'?sl>e&&e>t1&&t1>t2&&t2>t3:false}
function pineZone(d){const e=N(d?.entry),sl=N(d?.sl);if(e==null||sl==null||e===sl)return null;const z1=sl+(e-sl)*0.786,z2=sl+(e-sl)*0.236;return{lo:Math.min(z1,z2),hi:Math.max(z1,z2)} }
function freshness(d){const t=N(d?.receivedAt);if(!t)return'NO DATA';const age=Date.now()-t;return age<90000?'LIVE':age<240000?'STALE':'OFFLINE'}
function confirmation(d,side){
  if(side!=='BUY'&&side!=='SELL')return{items:[],passed:0,total:4,mtfAligned:0};
  const items=[];
  const mtf=[N(d?.mtf1),N(d?.mtf2),N(d?.mtf3)];
  const mtfAligned=mtf.filter(v=>v!=null&&(side==='BUY'?v>0:v<0)).length;
  items.push({name:'MTF',pass:mtfAligned>=2,detail:`${mtfAligned}/3 sehala`});
  const hd=dir(d?.hemaTrend);items.push({name:'HEMA',pass:hd===side,detail:hd==='WAIT'?'neutral':hd});
  const md=dir(d?.momentum);items.push({name:'Momentum',pass:md===side,detail:md==='WAIT'?'neutral':md});
  const sd=dir(d?.marketStructure);items.push({name:'Structure',pass:sd===side,detail:sd==='WAIT'?'sideways':sd});
  const passed=items.filter(x=>x.pass).length;
  return{items,passed,total:items.length,mtfAligned};
}
function evaluate(){
  const p=pred||{},d=raw||{}; const rawSide=U(p.prediction||'WAIT'),signalSide=U(p.signal||'WAIT'); const side=signalSide!=='WAIT'?signalSide:rawSide; const fresh=freshness(d);
  const rawConf=N(p.predictionConfidence)||0,signalStage=U(p.signalState||'WAIT'),signalLocked=!!p.signalLocked;
  const conf=signalLocked?(N(p.signalConfidence)||rawConf):rawConf,cons=N(p.predictionConsensus)||0,evidence=N(p.predictionEvidence)||0,st=N(p.stability)||0,agree=N(p.predictionAgreement)||0;
  const conflict=!!p.predictionConflict; const predPass=signalLocked?['SETUP_READY','ENTRY_READY','ACTIVE'].includes(signalStage):(side!=='WAIT'&&conf>=82&&cons>=6&&st>=70&&agree>=68&&!conflict);
  const c=confirmation(d,side),rawC=confirmation(d,rawSide); const confirmPass=side!=='WAIT'&&c.passed>=3;
  const ch=N(d.chopIndex); const chopPass=ch==null||ch<61.8;
  const planRR=rr(d), rrPass=planRR!=null&&planRR>=1.5;
  const geo=geometry(d,side); const z=pineZone(d),price=N(d.close),atr=N(d.atr),entry=N(d.entry);
  const inZone=!!(z&&price!=null&&price>=z.lo&&price<=z.hi);
  const zoneDist=z&&price!=null?(price<z.lo?z.lo-price:price>z.hi?price-z.hi:0):null;
  const nearZone=zoneDist!=null&&atr!=null&&atr>0&&zoneDist<=atr*.20;
  const entryDist=entry!=null&&price!=null?Math.abs(price-entry):null;
  const atTriggerArea=entryDist!=null&&atr!=null&&atr>0&&entryDist<=atr*.25;
  const exact=exactAction(d.action),exactMatch=exact===side;
  const feedPass=fresh==='LIVE';
  const entryPass=geo&&rrPass&&chopPass&&(inZone||nearZone||atTriggerArea);
  const elite=predPass&&confirmPass&&entryPass&&conf>=88&&st>=75&&agree>=75&&c.passed===4&&c.mtfAligned===3&&(ch==null||ch<55)&&planRR>=2;
  let quality=conf*.34+st*.18+agree*.14+(c.passed/c.total)*18+(inZone?8:nearZone||atTriggerArea?5:0)+(planRR!=null?Math.min(6,planRR*2):0);
  if(conflict)quality-=12;if(!chopPass)quality-=12;if(!geo)quality-=8;if(!feedPass)quality-=18;quality=clamp(Math.round(quality));
  let decision='NO TRADE',tone='wait',why='Syarat belum cukup.';
  const active=d.tradeActive===true&&!d.tp3Hit&&!d.slHit;
  if(!feedPass){decision=fresh==='STALE'?'WAIT — FEED STALE':'WAIT — NO LIVE DATA';why='Jangan gunakan signal sehingga feed kembali LIVE.';}
  else if(active){const ps=d.tradeIsBuy===true?'BUY':d.tradeIsBuy===false?'SELL':side;decision=`MANAGE ${ps} ACTIVE`;tone=ps.toLowerCase();why='Posisi aktif mempunyai keutamaan. Jangan buka posisi baru.';}
  else if(signalStage==='COOLDOWN'){decision='WAIT — COOLDOWN';why=p.signalReason||'Tunggu setup baru yang fresh.';}
  else if(signalLocked&&signalStage==='LOCKED_WAIT'){decision=`LOCKED ${side} — WAIT CONFIRMATION`;tone=side.toLowerCase();why=p.signalReason||`Signal ${side} masih dikunci, tapi confirmation tengah lemah.`;}
  else if(side==='WAIT'){decision='NO TRADE';why='Belum ada signal yang cukup kuat.';}
  else if(!predPass){decision=`WATCH ${side}`;tone=side.toLowerCase();why=signalStage==='WATCH'?(p.signalReason||'Arah ada potensi tetapi belum lock.'):'Signal belum cukup syarat untuk lock.';}
  else if(!chopPass){decision='NO TRADE — CHOP';why=`Chop ${ch?.toFixed?.(1)??ch}% terlalu tinggi untuk precision entry.`;}
  else if(!confirmPass){decision=`WAIT CONFIRMATION ${side}`;tone=side.toLowerCase();why=`Hanya ${c.passed}/${c.total} confirmation sehala.`;}
  else if(!geo){decision=`WAIT NEW ${side} PLAN`;tone=side.toLowerCase();why='Entry/SL/TP semasa tidak mempunyai geometry yang sehala dengan prediction.';}
  else if(!rrPass){decision='NO TRADE — R:R';why='R:R pelan semasa di bawah minimum 1.5R.';}
  else if(exactMatch&&entryPass){decision=`ENTRY ${side} CONFIRMED`;tone=side.toLowerCase();why='Prediction, confirmation, trigger dan trade plan semuanya sehala.';}
  else if(entryPass){decision=`PREPARE ${side}`;tone=side.toLowerCase();why='Setup berkualiti dan harga berada di kawasan execution; tunggu trigger tepat.';}
  else {decision=`WAIT PRICE ${side}`;tone=side.toLowerCase();why='Prediction dan confirmation lulus, tetapi harga belum berada di kawasan execution.';}
  return{side,rawSide,rawConf,rawC,signalStage,signalLocked,signalReason:p.signalReason||'',opportunityType:U(p.opportunityType||'NONE'),opportunitySide:U(p.opportunitySide||'WAIT'),opportunityStrength:U(p.opportunityStrength||'NONE'),opportunityReason:p.opportunityReason||'',opportunityRisk:U(p.opportunityRisk||'WAIT'),opportunityPrice:N(p.opportunityPrice),fresh,conf,cons,evidence,st,agree,conflict,predPass,c,confirmPass,ch,chopPass,planRR,rrPass,geo,z,price,inZone,nearZone,atTriggerArea,entryPass,exact,exactMatch,elite,quality,decision,tone,why,active};
}
const css=`
#v17Prediction{display:none!important}
#v19Precision{margin:10px 0 12px;border:1px solid #244761;border-radius:16px;background:linear-gradient(135deg,#071622,#061019 60%,#081520);box-shadow:0 16px 42px #0006;overflow:hidden}
.v19top{display:grid;grid-template-columns:1.35fr .65fr;gap:10px;padding:14px}.v19ey{font:900 9px/1.2 Inter,system-ui;letter-spacing:1.05px;color:#7894ad}.v19decision{margin-top:5px;font:950 27px/1.05 Inter,system-ui;color:#ffc160}.v19sub{margin-top:7px;font:600 10px/1.45 Inter,system-ui;color:#9bb0c4}.v19score{display:flex;align-items:center;justify-content:center;flex-direction:column;border:1px solid #1c3a50;border-radius:13px;background:#07111b}.v19score span{font:800 8px Inter;color:#70879d;letter-spacing:.7px}.v19score b{font:950 29px Inter;color:#eaf5ff}.v19score small{font:700 8px Inter;color:#738aa0}.v19gates{display:grid;grid-template-columns:repeat(3,1fr);gap:7px;padding:0 14px 12px}.v19gate{padding:10px;border:1px solid #173248;border-radius:11px;background:#07121c}.v19gate span{font:850 8px Inter;color:#71889f;letter-spacing:.65px}.v19gate b{display:block;margin-top:5px;font:900 12px Inter;color:#e8f3ff}.v19gate small{display:block;margin-top:4px;font:650 8px/1.35 Inter;color:#7790a8}.v19pass{border-color:#1d644b}.v19pass b{color:#3be497}.v19fail b{color:#ffbd5b}.v19row{display:grid;grid-template-columns:repeat(5,1fr);gap:6px;padding:0 14px 14px}.v19mini{padding:8px;border:1px solid #142c3e;border-radius:9px;background:#061019}.v19mini span{display:block;font:800 7px Inter;color:#688097;text-transform:uppercase}.v19mini b{display:block;margin-top:4px;font:850 10px Inter;color:#dbeafd}.v19elite{margin:0 14px 14px;padding:9px 11px;border:1px solid #22523f;border-radius:10px;background:#0c2b201f;font:800 9px/1.35 Inter;color:#91b9a7}.v19elite.on{border-color:#38d88c;background:#38d88c12;color:#51eda1;box-shadow:0 0 24px #38d88c13}.v19buy .v19decision{color:#36e392}.v19sell .v19decision{color:#ff6878}.v19wait .v19decision{color:#ffbf58}@media(max-width:800px){.v19top{grid-template-columns:1fr}.v19gates{grid-template-columns:1fr}.v19row{grid-template-columns:1fr 1fr}}
`;
const st=document.createElement('style');st.textContent=css;document.head.appendChild(st);
function host(){let e=document.getElementById('v19Precision');if(e)return e;e=document.createElement('section');e.id='v19Precision';const a=document.getElementById('v17Prediction')||document.getElementById('v10Focus')||document.querySelector('.v6-head');if(a)a.parentNode.insertBefore(e,a);else document.body.prepend(e);return e}
function gate(name,pass,value,detail){return `<div class="v19gate ${pass?'v19pass':'v19fail'}"><span>${name}</span><b>${pass?'PASS':'WAIT'} • ${esc(value)}</b><small>${esc(detail)}</small></div>`}
function render(){if(!pred||!raw||document.hidden)return;const x=evaluate();window.__ZENCORE_PREDICTION_STATE__=x;try{document.dispatchEvent(new CustomEvent('zencore:prediction-state',{detail:x}))}catch(_){}const sig=JSON.stringify([x.decision,x.quality,x.side,x.rawSide,x.signalStage,x.signalLocked,x.opportunityType,x.opportunitySide,x.opportunityStrength,x.opportunityRisk,x.fresh,x.conf,x.rawConf,x.st,x.agree,x.c.passed,x.c.mtfAligned,x.inZone,x.nearZone,x.atTriggerArea,x.elite,raw?.receivedAt,pred?.generatedAt]);if(sig===lastSignature){lastRender=Date.now();return}lastSignature=sig;lastRender=Date.now();const e=host();e.className=`v19${x.tone}`;const zoneText=x.inZone?'IN PINE ZONE':x.nearZone?'NEAR PINE ZONE':x.atTriggerArea?'NEAR ENTRY':'OUTSIDE EXECUTION';const confirmDetail=x.c.items.map(i=>`${i.name}:${i.pass?'✓':'×'}`).join('  ');e.innerHTML=`<div class="v19top"><div><div class="v19ey">ZENCORE V26 • SIGNAL CORE</div><div class="v19decision">${esc(x.decision)}</div><div class="v19sub">Signal: <b>${esc(x.side)}</b>${x.signalLocked?' • LOCKED':''} • Next move: <b>${esc(x.rawSide)}</b> • ${esc(x.why)}</div></div><div class="v19score"><span>SETUP QUALITY</span><b>${x.quality}/100</b><small>Bukan win probability</small></div></div><div class="v19gates">${gate('1 • SIGNAL',x.predPass,`${x.side} ${x.signalLocked?'LOCKED':'WATCH'}`,`State ${x.signalStage} • Support ${x.conf}/100 • Next ${x.rawSide} ${x.rawConf}/100`)}${gate('2 • CONFIRMATION',x.confirmPass,`${x.c.passed}/${x.c.total} SEHALA`,confirmDetail)}${gate('3 • ENTRY TRIGGER',x.entryPass,zoneText,`Trigger ${x.exact}${x.exactMatch?' ✓':''} • R:R ${x.planRR==null?'—':x.planRR.toFixed(2)+'R'} • ${x.geo?'Geometry valid':'Plan mismatch'}`)}</div><div class="v19row"><div class="v19mini"><span>Feed</span><b>${esc(x.fresh)}</b></div><div class="v19mini"><span>Chop</span><b>${x.ch==null?'—':x.ch.toFixed(1)+'%'}</b></div><div class="v19mini"><span>MTF Align</span><b>${x.c.mtfAligned}/3</b></div><div class="v19mini"><span>Next Move</span><b>${esc(x.rawSide)} ${x.rawConf}/100</b></div><div class="v19mini"><span>Execution</span><b>${esc(zoneText)}</b></div></div><div class="v19elite ${x.elite?'on':''}">${x.elite?'◆ ELITE FILTER LULUS — semua syarat precision utama sangat kuat. Tetap gunakan risk management.':'ELITE FILTER BELUM LULUS — ZenCore sengaja lebih selektif untuk kurangkan false signal.'}</div>`;}
async function boot(){try{const [p,d]=await Promise.all([fetch(`/api/prediction/${encodeURIComponent(symbol)}`,{cache:'no-store'}).then(r=>r.json()),fetch(`/api/market/${encodeURIComponent(symbol)}`,{cache:'no-store'}).then(r=>r.json())]);pred=p;raw=d;render()}catch(_){}}
try{const pe=new EventSource(`/prediction-events/${encodeURIComponent(symbol)}`);pe.addEventListener('prediction',ev=>{try{pred=JSON.parse(ev.data);render()}catch(_){}})}catch(_){}
try{const re=new EventSource('/events');re.onmessage=ev=>{try{const d=JSON.parse(ev.data);if(d&&U(d.symbol)===symbol){raw=d;render()}}catch(_){}}}catch(_){}
boot();setInterval(()=>{if(!document.hidden&&Date.now()-lastRender>30000)boot()},30000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)boot()});
})();
