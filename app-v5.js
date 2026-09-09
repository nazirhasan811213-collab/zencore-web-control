const $ = id => document.getElementById(id);
const n = v => Number.isFinite(+v) ? +v : null;
const fmt = (v,d=3) => n(v)==null ? '—' : n(v).toLocaleString(undefined,{maximumFractionDigits:d});
let bars = [], latest = null, journal = [], mt5Status = null, lotTouched = false, chartLocked = false;

function sideClass(v){
  v = String(v||'').toUpperCase();
  if(v.includes('BUY')||v.includes('LONG')||v.includes('BULL')||v==='UP') return 'good';
  if(v.includes('SELL')||v.includes('SHORT')||v.includes('BEAR')||v==='DOWN') return 'bad';
  return 'warn';
}
function grade(d){const p=n(d?.setupProbability)||0,s=n(d?.confluenceStars)||0;if(p>=85&&s>=4)return'A+';if(p>=75&&s>=4)return'A';if(p>=65&&s>=3)return'B';if(p>=55)return'C';return'D'}
function rr(entry,sl,tp){entry=n(entry);sl=n(sl);tp=n(tp);if([entry,sl,tp].some(x=>x==null))return null;const r=Math.abs(entry-sl);return r?Math.abs(tp-entry)/r:null}
function session(){const h=new Date().getUTCHours(),s=[];if(h<8)s.push('ASIA');if(h>=7&&h<16)s.push('LONDON');if(h>=12&&h<21)s.push('NEW YORK');return s.length?s.join(' + '):'OFF-PEAK'}
function freshness(ts){if(!ts)return'—';const sec=Math.max(0,Math.floor((Date.now()-ts)/1000));return sec<60?`${sec}s ago`:sec<3600?`${Math.floor(sec/60)}m ago`:`${Math.floor(sec/3600)}h ago`}
function txt(id,v,cls=''){const e=$(id);if(!e)return;e.textContent=v??'—';if(cls)e.className=cls}
function bool(v){return v?'<span class="good">PASS ✓</span>':'<span class="bad">FAIL ✕</span>'}
function zone(d){const e=n(d?.entry),a=n(d?.atr);if(e==null||a==null)return null;const pct=(n($('zonePct')?.value)||15)/100;return[e-a*pct,e+a*pct]}
function sr(){const valid=bars.filter(b=>n(b.high)!=null&&n(b.low)!=null).slice(-20);if(!valid.length)return{r:null,s:null};return{r:Math.max(...valid.map(b=>n(b.high))),s:Math.min(...valid.map(b=>n(b.low)))} }
function obText(d){const b1=n(d.bullObBottom),b2=n(d.bullObTop),r1=n(d.bearObBottom),r2=n(d.bearObTop);const a=[];if(b1!=null&&b2!=null)a.push(`Demand ${fmt(b1,2)}–${fmt(b2,2)}`);if(r1!=null&&r2!=null)a.push(`Supply ${fmt(r1,2)}–${fmt(r2,2)}`);return a.join(' | ')||'—'}
function addBar(d){if(!d||!Object.keys(d).length)return;latest=d;const t=n(d.time)||n(d.receivedAt)||Date.now();const i=bars.findIndex(b=>(n(b.time)||n(b.receivedAt))===t);if(i>=0)bars[i]=d;else bars.push(d);bars.sort((a,b)=>(n(a.time)||n(a.receivedAt)||0)-(n(b.time)||n(b.receivedAt)||0));if(bars.length>200)bars=bars.slice(-200);render(d)}

function render(d){
  if(!d)return;
  txt('feed','PINE FEED LIVE'); $('dot')?.classList.remove('off');
  txt('feedType',d.feedType||'LIVE'); txt('fresh',`Last ${freshness(n(d.receivedAt))}`); txt('session',session());
  txt('symbol',d.symbol||'—'); txt('tf',d.timeframe?`• ${d.timeframe}`:''); txt('price',fmt(d.close,5));
  txt('sumSymbol',`${d.symbol||'—'} ${d.timeframe||''}`); txt('sumAction',d.action||'—',`v ${sideClass(d.action)}`);
  txt('sumProb',d.setupProbability!=null?`${d.setupProbability}%`:'—'); txt('sumGrade',grade(d));
  txt('sumRR',rr(d.entry,d.sl,d.tp3)!=null?`${rr(d.entry,d.sl,d.tp3).toFixed(2)}R`:'—');
  txt('action',d.action||'—',`action ${sideClass(d.action)}`); txt('grade',grade(d));
  txt('prob',d.setupProbability!=null?`${d.setupProbability}%`:'—'); if($('probBar'))$('probBar').style.width=`${Math.max(0,Math.min(100,n(d.setupProbability)||0))}%`;
  txt('stars',`${d.confluenceStars??0}/5`); txt('power',d.powerText||`${fmt(d.marketPower,0)}%`,sideClass(d.powerText)); txt('risk',d.riskState||'—');
  ['entry','sl','tp1','tp2','tp3','atr'].forEach(k=>txt(k,fmt(d[k],5)));

  const z=zone(d);
  if(z){
    txt('zoneRange',`${fmt(z[0],5)} – ${fmt(z[1],5)}`);
    const c=n(d.close); let zs='WAIT';
    if(c!=null&&c>=z[0]&&c<=z[1])zs='PRICE IN ENTRY ZONE'; else if(c!=null)zs=c<z[0]?'PRICE BELOW ZONE':'PRICE ABOVE ZONE';
    txt('zoneStatus',zs,sideClass(zs.includes('IN')?(String(d.action).includes('SELL')?'SELL':'BUY'):'WAIT')); txt('sumZone',zs);
  } else { txt('zoneRange','—'); txt('zoneStatus','Waiting for Entry + ATR'); txt('sumZone','—'); }

  const rd=n(d.entry)!=null&&n(d.sl)!=null?Math.abs(n(d.entry)-n(d.sl)):null;
  txt('riskDist',fmt(rd,5)); txt('rr1',rr(d.entry,d.sl,d.tp1)!=null?`${rr(d.entry,d.sl,d.tp1).toFixed(2)}R`:'—'); txt('rr3',rr(d.entry,d.sl,d.tp3)!=null?`${rr(d.entry,d.sl,d.tp3).toFixed(2)}R`:'—');
  ['mtf1','mtf2','mtf3'].forEach(k=>{const v=n(d[k]);txt(k,v==null?'—':v>0?'UP':'DOWN',`v ${v>0?'good':'bad'}`)}); txt('mtfo',d.mtfOverall||'—',`v ${sideClass(d.mtfOverall)}`);
  const checks=[1,2,3,4,5].map(i=>!!d[`sop${i}`]); if($('sop'))$('sop').innerHTML=checks.map((v,i)=>`<div class="sop"><span>${i+1}. SOP confirmation</span><b>${bool(v)}</b></div>`).join(''); txt('sopScore',`${checks.filter(Boolean).length}/5`);
  txt('tip',d.proTip||'—');

  const map={structure:d.marketStructure,hema:d.hemaTrend,momentum:d.momentum,forecast:d.forecast3Bars,whales:d.whaleState,rvol:n(d.relativeVolume)!=null?`${fmt(d.relativeVolume,2)}x`:'—',dxy:d.dxyStatus,sd:d.sdClearance,chop:n(d.chopIndex)!=null?`${fmt(d.chopIndex,1)}%`:'—',rsi:n(d.rsi)!=null?fmt(d.rsi,1):'—',wt:n(d.waveTrend1)!=null?`${fmt(d.waveTrend1,1)} / ${fmt(d.waveTrend2,1)}`:'—',ema:n(d.ema9)!=null?`${fmt(d.ema9,2)} / ${fmt(d.ema20,2)} / ${fmt(d.ema50,2)}`:'—',ob:obText(d)};
  for(const[k,v]of Object.entries(map))txt(k,v);
  const s=sr(); txt('support',fmt(s.s,5)); txt('resistance',fmt(s.r,5)); txt('position',d.tradeActive?'ACTIVE':'FLAT',d.tradeActive?'good':'warn');
  txt('hits',`${d.tp1Hit?'TP1 ✓ ':''}${d.tp2Hit?'TP2 ✓ ':''}${d.tp3Hit?'TP3 ✓ ':''}${d.slHit?'SL ✕':''}`||'None');

  updateExecutionStrip(d); drawChart(); calcRisk(); loadJournalView(); updateMt5Buttons();
}

function updateExecutionStrip(d){
  [['execPrice',d.close],['execEntry',d.entry],['execSl',d.sl],['execTp1',d.tp1],['execTp2',d.tp2],['execTp3',d.tp3]].forEach(([id,v])=>txt(id,fmt(v,5)));
  const e=n(d.entry),c=n(d.close),sl=n(d.sl),tp3=n(d.tp3);
  txt('execDistance',e!=null&&c!=null?fmt(Math.abs(c-e),5):'—');
  txt('execRR',rr(e,sl,tp3)!=null?`${rr(e,sl,tp3).toFixed(2)}R`:'—');
}

function drawChart(){
  const svg=$('chart'); if(!svg)return;
  const W=1200,H=560,L=58,R=94,T=28,B=34; svg.innerHTML='';
  const data=bars.slice(-80); if(!data.length)return;
  const d=latest||data[data.length-1],z=zone(d),s=sr();
  const showZones=$('showTradeZones')?.checked!==false, showOB=$('showOrderBlocks')?.checked!==false, showSR=$('showSR')?.checked!==false, showSignals=$('showSignals')?.checked!==false, showTrend=$('showTrendLines')?.checked!==false;
  let vals=[];
  for(const b of data){['open','high','low','close','ema9','ema20','ema50','hemaFast','hemaSlow'].forEach(k=>{const v=n(b[k]);if(v!=null)vals.push(v)})}
  ['entry','sl','tp1','tp2','tp3','bullObTop','bullObBottom','bearObTop','bearObBottom'].forEach(k=>{const v=n(d[k]);if(v!=null)vals.push(v)});
  if(z)vals.push(...z); if(s.s!=null)vals.push(s.s); if(s.r!=null)vals.push(s.r); if(!vals.length)return;
  let lo=Math.min(...vals),hi=Math.max(...vals),pad=(hi-lo||1)*.07;lo-=pad;hi+=pad;
  const y=v=>T+(hi-v)/(hi-lo)*(H-T-B), x=i=>L+i/Math.max(1,data.length-1)*(W-L-R);
  const ns='http://www.w3.org/2000/svg';
  const add=(tag,attrs)=>{const e=document.createElementNS(ns,tag);for(const[k,v]of Object.entries(attrs))e.setAttribute(k,v);svg.appendChild(e);return e};

  for(let i=0;i<6;i++){
    const yy=T+i*(H-T-B)/5; add('line',{x1:L,y1:yy,x2:W-R,y2:yy,stroke:'#ffffff0b','stroke-width':1});
    const p=hi-i*(hi-lo)/5; const tx=add('text',{x:W-R+8,y:yy+4,fill:'#7c8ea7','font-size':10}); tx.textContent=fmt(p,2);
  }

  function band(a,b,fill,stroke,label){if(n(a)==null||n(b)==null)return;const yy1=y(Math.max(n(a),n(b))),yy2=y(Math.min(n(a),n(b)));add('rect',{x:L,y:yy1,width:W-L-R,height:Math.max(2,yy2-yy1),fill,stroke,'stroke-width':1});const t=add('text',{x:L+8,y:yy1+14,fill:stroke,'font-size':9,'font-weight':700});t.textContent=label}
  function hline(v,label,color,dash='5 4',width=1.4){if(n(v)==null)return;const yy=y(n(v));add('line',{x1:L,y1:yy,x2:W-R,y2:yy,stroke:color,'stroke-width':width,'stroke-dasharray':dash,opacity:.95});const t=add('text',{x:W-R-4,y:yy-4,fill:color,'font-size':9,'font-weight':700,'text-anchor':'end'});t.textContent=`${label} ${fmt(v,2)}`}
  function series(key,color,width=1.4,dash=''){const pts=data.map((b,i)=>n(b[key])!=null?`${x(i)},${y(n(b[key]))}`:null).filter(Boolean).join(' ');if(!pts)return;const attrs={points:pts,fill:'none',stroke:color,'stroke-width':width,opacity:.9};if(dash)attrs['stroke-dasharray']=dash;add('polyline',attrs)}

  if(showZones){
    if(z)band(z[0],z[1],'#ffb74b20','#ffb74b','ENTRY ZONE');
    if(n(d.entry)!=null&&n(d.sl)!=null)band(d.entry,d.sl,'#ff607012','#ff6070','RISK ZONE');
    if(n(d.entry)!=null&&n(d.tp3)!=null)band(d.entry,d.tp3,'#32e38d09','#32e38d','PROFIT ZONE');
  }
  if(showOB){
    if(n(d.bullObBottom)!=null&&n(d.bullObTop)!=null)band(d.bullObBottom,d.bullObTop,'#32e38d0d','#32e38d66','DEMAND OB');
    if(n(d.bearObBottom)!=null&&n(d.bearObTop)!=null)band(d.bearObBottom,d.bearObTop,'#ff60700d','#ff607066','SUPPLY OB');
  }

  hline(d.entry,'ENTRY','#ffb74b','6 4',1.8); hline(d.sl,'SL','#ff6070','6 4',1.8); hline(d.tp1,'TP1','#32e38d'); hline(d.tp2,'TP2','#32e38d'); hline(d.tp3,'TP3','#32e38d','6 4',1.8);
  if(showSR){hline(s.s,'SUPPORT','#48ded7','3 5');hline(s.r,'RESIST','#9b7cff','3 5')}
  hline(d.close,'LIVE','#51a8ff','2 3',1.2);

  const candleOK=data.filter(b=>[n(b.open),n(b.high),n(b.low),n(b.close)].every(v=>v!=null)).length>=2;
  if(candleOK){
    const cw=Math.max(3,Math.min(10,(W-L-R)/data.length*.56));
    data.forEach((b,i)=>{
      const o=n(b.open),h=n(b.high),l=n(b.low),c=n(b.close); if([o,h,l,c].some(v=>v==null))return;
      const xx=x(i),up=c>=o,col=up?'#32e38d':'#ff6070'; add('line',{x1:xx,y1:y(h),x2:xx,y2:y(l),stroke:col,'stroke-width':1.1}); add('rect',{x:xx-cw/2,y:Math.min(y(o),y(c)),width:cw,height:Math.max(1,Math.abs(y(o)-y(c))),fill:col,rx:1});
      if(showSignals){
        const act=String(b.action||'').toUpperCase();
        if(act==='BUY'||act==='SELL'){
          const buy=act==='BUY', my=buy?y(l)+18:y(h)-18, col2=buy?'#32e38d':'#ff6070';
          const pts=buy?`${xx-6},${my-9} ${xx+6},${my-9} ${xx},${my}`:`${xx-6},${my+9} ${xx+6},${my+9} ${xx},${my}`;
          add('polygon',{points:pts,fill:col2,stroke:'#061019','stroke-width':1}); const st=add('text',{x:xx,y:buy?my+12:my-11,fill:col2,'font-size':9,'font-weight':900,'text-anchor':'middle'});st.textContent=act;
        }
      }
    });
  } else {
    const pts=data.map((b,i)=>n(b.close)!=null?`${x(i)},${y(n(b.close))}`:null).filter(Boolean).join(' '); add('polyline',{points:pts,fill:'none',stroke:'#51a8ff','stroke-width':2.3});
  }

  if(showTrend){series('ema9','#f2c94c',1.2);series('ema20','#51a8ff',1.2);series('ema50','#9b7cff',1.2);series('hemaFast','#48ded7',1.4);series('hemaSlow','#ffffff77',1.2,'4 3')}

  const meta=$('chartMeta'); if(meta)meta.textContent=candleOK?`${data.length} ZenCore OHLC bars • indicator overlay • Entry/SL/TP zones • signals`:`${data.length} snapshots • waiting for OHLC feed`;
  window.zcChartState={data,W,H,L,R,T,B,x,y,lo,hi};
  add('line',{id:'crossV',x1:0,y1:T,x2:0,y2:H-B,stroke:'#ffffff55','stroke-width':1,'stroke-dasharray':'3 4',visibility:'hidden'});
  add('line',{id:'crossH',x1:L,y1:0,x2:W-R,y2:0,stroke:'#ffffff55','stroke-width':1,'stroke-dasharray':'3 4',visibility:'hidden'});
}

function setupChartInteraction(){
  const svg=$('chart'),tip=$('chartTooltip'); if(!svg||!tip)return;
  svg.addEventListener('pointermove',e=>{
    if(chartLocked)return; const st=window.zcChartState;if(!st||!st.data?.length)return;
    const rect=svg.getBoundingClientRect(), sx=(e.clientX-rect.left)/rect.width*st.W, sy=(e.clientY-rect.top)/rect.height*st.H;
    const frac=Math.max(0,Math.min(1,(sx-st.L)/(st.W-st.L-st.R))), idx=Math.round(frac*(st.data.length-1)), b=st.data[idx]; if(!b)return;
    const xx=st.x(idx), vv=$('crossV'),hh=$('crossH'); if(vv){vv.setAttribute('x1',xx);vv.setAttribute('x2',xx);vv.setAttribute('visibility','visible')} if(hh){hh.setAttribute('y1',sy);hh.setAttribute('y2',sy);hh.setAttribute('visibility','visible')}
    const time=new Date(n(b.time)||n(b.receivedAt)||Date.now()).toLocaleTimeString();
    tip.innerHTML=`<b>${b.symbol||''} ${time}</b><span>O ${fmt(b.open,3)} &nbsp; H ${fmt(b.high,3)} &nbsp; L ${fmt(b.low,3)} &nbsp; C ${fmt(b.close,3)}</span><span>Signal <strong class="${sideClass(b.action)}">${b.action||'—'}</strong> • Prob ${b.setupProbability??'—'}%</span>`;
    tip.style.left=`${Math.min(rect.width-220,Math.max(8,e.clientX-rect.left+12))}px`;tip.style.top=`${Math.max(8,e.clientY-rect.top-58)}px`;tip.classList.add('show');
  });
  svg.addEventListener('pointerleave',()=>{if(!chartLocked){tip.classList.remove('show');$('crossV')?.setAttribute('visibility','hidden');$('crossH')?.setAttribute('visibility','hidden')}});
  svg.addEventListener('click',()=>{chartLocked=!chartLocked;tip.classList.toggle('locked',chartLocked)});
}

function calcRisk(){
  if(!latest)return; const balance=n($('balance')?.value)||0,rpct=n($('riskPct')?.value)||0,val=n($('valuePerMove')?.value)||0,e=n(latest.entry),sl=n(latest.sl); const riskAmount=balance*rpct/100,dist=e!=null&&sl!=null?Math.abs(e-sl):null,lots=dist&&val?riskAmount/(dist*val):null;
  txt('riskAmount',`$${fmt(riskAmount,2)}`); txt('stopDistance',fmt(dist,5)); txt('lotSize',lots!=null?fmt(lots,3):'—'); txt('calcRR',rr(latest.entry,latest.sl,latest.tp3)!=null?`${rr(latest.entry,latest.sl,latest.tp3).toFixed(2)}R`:'—');
  if(!lotTouched&&$('mt5Lot')&&lots!=null)$('mt5Lot').value=Math.max(.01,Math.min(n(mt5Status?.maxLot)||1,Math.round(lots*100)/100)).toFixed(2);
}

function loadJournalView(){const rows=(journal.length?journal:bars.filter(b=>['BUY','SELL'].includes(String(b.action)))).slice(-30).reverse();if(!$('journalBody'))return;$('journalBody').innerHTML=rows.length?rows.map(d=>`<tr><td>${new Date(n(d.time)||n(d.receivedAt)||Date.now()).toLocaleTimeString()}</td><td>${d.symbol||'—'}</td><td class="${sideClass(d.action)}">${d.action||'—'}</td><td>${fmt(d.entry,3)}</td><td>${fmt(d.sl,3)}</td><td>${fmt(d.tp1,3)}</td><td>${d.setupProbability??'—'}%</td><td>${grade(d)}</td></tr>`).join(''):'<tr><td colspan="8" class="muted">No BUY/SELL journal entries yet</td></tr>'}

async function refreshMt5(){
  try{mt5Status=await fetch('/api/mt5/status',{cache:'no-store'}).then(r=>r.json())}catch(e){mt5Status={connected:false}}
  const c=!!mt5Status?.connected; $('mt5Dot')?.classList.toggle('off',!c); txt('mt5Conn',c?'MT5 BRIDGE LIVE':'MT5 NOT CONNECTED',c?'good':'warn'); txt('sumMt5',c?'CONNECTED':'OFFLINE',c?'v good':'v warn');
  txt('mt5Broker',mt5Status?.broker||mt5Status?.server||'—'); txt('mt5Login',mt5Status?.login||'—'); txt('mt5Balance',mt5Status?.balance!=null?`$${fmt(mt5Status.balance,2)}`:'—'); txt('mt5Equity',mt5Status?.equity!=null?`$${fmt(mt5Status.equity,2)}`:'—'); txt('mt5Positions',mt5Status?.positions??'—');
  const lr=mt5Status?.lastResult; txt('mt5Last',lr?`${lr.status} ${lr.side} ${lr.symbol}`:'—',lr?.status==='FILLED'?'good':lr?'warn':'');
  const sig=mt5Status?.lastSignal; txt('mt5Signal',sig?`${sig.side} ${sig.symbol} • ${freshness(sig.receivedAt)}`:'No recent exact entry'); updateMt5Buttons();
}

function updateMt5Buttons(){
  const buy=$('mt5Buy'),sell=$('mt5Sell'); if(!buy||!sell)return;
  const c=!!mt5Status?.connected,sig=mt5Status?.lastSignal,valid=sig&&Date.now()<(sig.validUntil||0); buy.disabled=!(c&&valid&&sig.side==='BUY'); sell.disabled=!(c&&valid&&sig.side==='SELL');
  buy.textContent=buy.disabled?'BUY — WAIT ZENCORE':'CONFIRM BUY'; sell.textContent=sell.disabled?'SELL — WAIT ZENCORE':'CONFIRM SELL';
}

async function sendMt5(side){
  if(!latest||!mt5Status?.connected)return;
  const pin=$('tradePin')?.value||'',volume=n($('mt5Lot')?.value),target=$('mt5TpTarget')?.value||'tp1'; const tp=n(latest[target]),sl=n(latest.sl),symbol=latest.symbol;
  if(!pin){txt('mt5Message','Enter Trade PIN first','bad');return} if(volume==null||volume<=0){txt('mt5Message','Invalid lot size','bad');return} if(tp==null||sl==null){txt('mt5Message','ZenCore SL/TP unavailable','bad');return}
  const ok=confirm(`Send MARKET ${side} to MT5?\n${symbol} ${volume} lot\nSL ${sl}\nTP ${tp}\n\nThis is a live trading instruction.`); if(!ok)return;
  txt('mt5Message','Queuing order…','warn');
  try{
    const r=await fetch('/api/mt5/order',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pin,side,symbol,volume,sl,tp})}); const d=await r.json();
    if(!r.ok)throw new Error(d.error||'Order rejected'); txt('mt5Message',`QUEUED ${d.command.side} ${d.command.symbol} • ${d.command.id}`,'good'); $('tradePin').value=''; setTimeout(refreshMt5,800);
  }catch(e){txt('mt5Message',e.message,'bad')}
}

async function init(){
  try{const h=await fetch('/api/history',{cache:'no-store'}).then(r=>r.json());bars=Array.isArray(h)?h.slice().reverse():[];if(bars.length)addBar(bars[bars.length-1])}catch(e){}
  try{journal=await fetch('/api/journal',{cache:'no-store'}).then(r=>r.json())}catch(e){journal=[]} loadJournalView(); await refreshMt5();
  try{const es=new EventSource('/events');es.onmessage=e=>{try{addBar(JSON.parse(e.data))}catch(_){}};es.addEventListener('mt5',e=>{try{mt5Status=JSON.parse(e.data);refreshMt5()}catch(_){}});es.onerror=()=>{$('dot')?.classList.add('off');txt('feed','RECONNECTING')}}catch(e){}
  setInterval(()=>{txt('fresh',`Last ${freshness(n(latest?.receivedAt))}`);txt('session',session());updateMt5Buttons()},1000); setInterval(refreshMt5,3000);
  setupChartInteraction();
}

document.addEventListener('input',e=>{
  if(['balance','riskPct','valuePerMove','zonePct'].includes(e.target?.id)){calcRisk();if(e.target.id==='zonePct'&&latest)render(latest)}
  if(e.target?.id==='mt5Lot')lotTouched=true;
});
document.addEventListener('change',e=>{if(['showTradeZones','showOrderBlocks','showSR','showSignals','showTrendLines'].includes(e.target?.id))drawChart()});
$('mt5Buy')?.addEventListener('click',()=>sendMt5('BUY')); $('mt5Sell')?.addEventListener('click',()=>sendMt5('SELL'));
init();
