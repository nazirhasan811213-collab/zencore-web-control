(function(){
'use strict';

const N=v=>{if(v===null||v===undefined||v===''||v==='null')return null;const x=Number(v);return Number.isFinite(x)?x:null};
const F=(v,d=2)=>N(v)==null?'—':N(v).toLocaleString(undefined,{minimumFractionDigits:d,maximumFractionDigits:d});
const U=v=>String(v||'').toUpperCase();
const NS='http://www.w3.org/2000/svg';

const style=document.createElement('style');
style.id='v18ChartStyle';
style.textContent=`
.chartwrap{background:#0b0c0f!important;border:1px solid rgba(132,153,176,.18)!important;border-radius:12px!important;overflow:hidden!important;box-shadow:inset 0 0 0 1px rgba(255,255,255,.012),0 18px 42px rgba(0,0,0,.26)!important}
#chart{background:#0b0c0f!important;filter:none!important}
#v15Hud{display:none!important}
#v15Summary{display:none!important}
.chartlegend{position:absolute!important;left:12px!important;top:10px!important;z-index:8!important;background:rgba(8,10,14,.78)!important;border:1px solid rgba(122,145,169,.16)!important;border-radius:8px!important;padding:5px 7px!important;backdrop-filter:blur(8px)}
.v18-chart-title{position:absolute;left:14px;top:43px;z-index:8;pointer-events:none;font:800 10px Inter,system-ui;color:#cfd8e3;letter-spacing:.2px;text-shadow:0 1px 5px #000}
.v18-chart-title b{font-size:14px;color:#f3f7fb;margin-right:6px}.v18-chart-title span{color:#76889b}
.v18-pine-badge{position:absolute;right:10px;top:10px;z-index:9;padding:5px 8px;border:1px solid rgba(114,144,172,.22);border-radius:7px;background:rgba(8,10,14,.82);font:800 8px Inter,system-ui;color:#8ea4b9;pointer-events:none}
.v18-pine-badge b{color:#e8eef6}
#zonePct{display:none!important}
#zonePct+*{display:none!important}
@media(max-width:800px){.v18-chart-title{top:40px}.v18-chart-title span{display:none}.chartlegend{max-width:70%;overflow:auto;white-space:nowrap}}
`;
document.head.appendChild(style);

function pineZone(d){
  const e=N(d?.entry),sl=N(d?.sl);if(e==null||sl==null||e===sl)return null;
  const p=r=>sl+(e-sl)*r;
  const a=p(.786),b=p(.236);
  return [Math.min(a,b),Math.max(a,b)];
}
try{window.zone=pineZone}catch(_){}

function addOverlayLabels(){
  const wrap=document.querySelector('.chartwrap');if(!wrap)return;
  if(!document.getElementById('v18ChartTitle')){
    const t=document.createElement('div');t.id='v18ChartTitle';t.className='v18-chart-title';t.innerHTML='<b>ZENCORE PRO CHART</b><span>Pine-synced HEMA • Entry Zone • SL/TP • Signal Management</span>';wrap.appendChild(t);
  }
  if(!document.getElementById('v18PineBadge')){
    const b=document.createElement('div');b.id='v18PineBadge';b.className='v18-pine-badge';b.innerHTML='CHART LOGIC <b>PINE REFERENCE</b>';wrap.appendChild(b);
  }
  const zp=document.getElementById('zonePct');if(zp&&zp.parentElement)zp.parentElement.style.display='none';
}

function getBars(){try{return Array.isArray(bars)?bars:[]}catch(_){return[]}}
function getLatest(){try{return latest||null}catch(_){return null}}
function show(id,def=true){const e=document.getElementById(id);return e?e.checked!==false:def}
function recentSR(data){const v=data.filter(b=>N(b.high)!=null&&N(b.low)!=null).slice(-50);if(!v.length)return{s:null,r:null};return{s:Math.min(...v.map(b=>N(b.low))),r:Math.max(...v.map(b=>N(b.high)))} }
function avg(arr){const v=arr.filter(x=>N(x)!=null).map(Number);return v.length?v.reduce((a,b)=>a+b,0)/v.length:null}
function sideOf(b){const hf=N(b.hemaFast),hs=N(b.hemaSlow);if(hf!=null&&hs!=null){if(hf>hs)return'BUY';if(hf<hs)return'SELL'}const a=U(b.action);if(/BUY|LONG/.test(a))return'BUY';if(/SELL|SHORT/.test(a))return'SELL';return'WAIT'}
function candleColor(b){const o=N(b.open),c=N(b.close),trend=sideOf(b);if(o==null||c==null)return'#aeb7c2';if(trend==='BUY')return c>=o?'#49b9ff':'#ffd95c';if(trend==='SELL')return c<=o?'#ff5063':'#ffd95c';return c>=o?'#49b9ff':'#ff5063'}

function drawV18(){
  addOverlayLabels();
  const svg=document.getElementById('chart');if(!svg)return;
  const all=getBars(),d=getLatest()||all[all.length-1];if(!d)return;
  const data=all.slice(-90);if(!data.length)return;
  const W=1200,H=560,L=48,R=92,T=30,B=32;
  svg.setAttribute('viewBox',`0 0 ${W} ${H}`);svg.innerHTML='';
  const zone=pineZone(d),sr=recentSR(data);
  const showZones=show('showTradeZones'),showOB=show('showOrderBlocks'),showSR=show('showSR'),showSignals=show('showSignals'),showTrend=show('showTrendLines');
  let vals=[];
  data.forEach(b=>['open','high','low','close','ema9','ema20','ema50','hemaFast','hemaSlow'].forEach(k=>{const v=N(b[k]);if(v!=null)vals.push(v)}));
  ['entry','sl','tp1','tp2','tp3','bullObTop','bullObBottom','bearObTop','bearObBottom'].forEach(k=>{const v=N(d[k]);if(v!=null)vals.push(v)});
  if(zone)vals.push(...zone);if(sr.s!=null)vals.push(sr.s);if(sr.r!=null)vals.push(sr.r);if(!vals.length)return;
  let lo=Math.min(...vals),hi=Math.max(...vals),pad=(hi-lo||1)*.06;lo-=pad;hi+=pad;
  const x=i=>L+i/Math.max(1,data.length-1)*(W-L-R), y=v=>T+(hi-v)/(hi-lo)*(H-T-B);
  const add=(tag,attrs,parent=svg)=>{const e=document.createElementNS(NS,tag);Object.entries(attrs||{}).forEach(([k,v])=>e.setAttribute(k,v));parent.appendChild(e);return e};
  const text=(xv,yv,txt,attrs={})=>{const e=add('text',{x:xv,y:yv,fill:'#8a98a8','font-size':9,'font-family':'Inter,system-ui',...attrs});e.textContent=txt;return e};

  add('rect',{x:0,y:0,width:W,height:H,fill:'#0b0c0f'});
  for(let i=0;i<7;i++){
    const yy=T+i*(H-T-B)/6;add('line',{x1:L,y1:yy,x2:W-R,y2:yy,stroke:'#ffffff10','stroke-width':1});
    const p=hi-i*(hi-lo)/6;text(W-R+7,yy+3,F(p,2),{fill:'#768290','font-size':8});
  }
  for(let i=0;i<10;i++){const xx=L+i*(W-L-R)/9;add('line',{x1:xx,y1:T,x2:xx,y2:H-B,stroke:'#ffffff0d','stroke-width':1});}

  function band(a,b,fill,stroke,label,x1=L,x2=W-R){
    a=N(a);b=N(b);if(a==null||b==null)return;const top=y(Math.max(a,b)),bot=y(Math.min(a,b));
    add('rect',{x:x1,y:top,width:Math.max(1,x2-x1),height:Math.max(2,bot-top),fill,stroke,'stroke-width':1});
    if(label)text(x1+6,top+12,label,{fill:stroke,'font-size':8,'font-weight':800});
  }
  function hline(v,label,color,dash='5 4',width=1.4){
    v=N(v);if(v==null)return;const yy=y(v);add('line',{x1:L,y1:yy,x2:W-R,y2:yy,stroke:color,'stroke-width':width,'stroke-dasharray':dash,opacity:.96});
    const w=Math.max(58,label.length*5.1+40);add('rect',{x:W-R-w,y:yy-9,width:w,height:16,rx:3,fill:'#0b0c0fe8',stroke:color,'stroke-width':.7});
    text(W-R-5,yy+3,`${label} ${F(v,2)}`,{fill:color,'font-size':8,'font-weight':850,'text-anchor':'end'});
  }
  function lineSeries(key,color,width=1.15,opacity=.9,dash=''){
    let run=[];const flush=()=>{if(run.length>1){const attrs={points:run.join(' '),fill:'none',stroke:color,'stroke-width':width,opacity,'stroke-linejoin':'round','stroke-linecap':'round'};if(dash)attrs['stroke-dasharray']=dash;add('polyline',attrs)}run=[]};
    data.forEach((b,i)=>{const v=N(b[key]);if(v==null){flush();return}run.push(`${x(i)},${y(v)}`)});flush();
  }

  if(showTrend){
    let start=0,current=sideOf(data[0]);
    for(let i=1;i<=data.length;i++){
      const next=i<data.length?sideOf(data[i]):'END';
      if(next!==current){
        const idxs=[];for(let j=start;j<i;j++)if(N(data[j].hemaFast)!=null&&N(data[j].hemaSlow)!=null)idxs.push(j);
        if(idxs.length>1){
          const upper=idxs.map(j=>`${x(j)},${y(N(data[j].hemaFast))}`);
          const lower=idxs.slice().reverse().map(j=>`${x(j)},${y(N(data[j].hemaSlow))}`);
          const col=current==='BUY'?'#00b98a':'#a62317';
          add('polygon',{points:upper.concat(lower).join(' '),fill:col,opacity:.48});
        }
        start=i;current=next;
      }
    }
    lineSeries('hemaFast','#2fe1bf',1.15,.58);lineSeries('hemaSlow','#d85b4b',1.05,.48);
    lineSeries('ema9','#50d4dd',1.05,.9);lineSeries('ema20','#e7c13d',1.05,.9);lineSeries('ema50','#708bd9',1.05,.86);
  }

  if(showZones&&zone){band(zone[0],zone[1],'#d5a91f24','#caa83b','PINE ENTRY ZONE',x(Math.max(0,data.length-18)),W-R)}
  if(showZones&&N(d.entry)!=null&&N(d.sl)!=null)band(d.entry,d.sl,'#ff465711','#ff5365','RISK',x(Math.max(0,data.length-18)),W-R);
  if(showZones&&N(d.entry)!=null&&N(d.tp3)!=null)band(d.entry,d.tp3,'#19d9890a','#35df91','PROFIT',x(Math.max(0,data.length-18)),W-R);
  if(showOB){
    if(N(d.bullObBottom)!=null&&N(d.bullObTop)!=null)band(d.bullObBottom,d.bullObTop,'#00d99a13','#28c99566','DEMAND OB');
    if(N(d.bearObBottom)!=null&&N(d.bearObTop)!=null)band(d.bearObBottom,d.bearObTop,'#ff4f6012','#ff607066','SUPPLY OB');
  }

  const candleW=Math.max(3,Math.min(9,(W-L-R)/data.length*.56));
  data.forEach((b,i)=>{
    const o=N(b.open),h=N(b.high),l=N(b.low),c=N(b.close);if([o,h,l,c].some(v=>v==null))return;
    const xx=x(i),col=candleColor(b);add('line',{x1:xx,y1:y(h),x2:xx,y2:y(l),stroke:col,'stroke-width':1.05});
    add('rect',{x:xx-candleW/2,y:Math.min(y(o),y(c)),width:candleW,height:Math.max(1.5,Math.abs(y(o)-y(c))),fill:col,rx:.7});
  });

  hline(d.entry,'ENTRY','#e7c13d','6 4',1.55);hline(d.sl,'SL','#ff5365','6 4',1.55);hline(d.tp1,'TP1','#2de38f','5 4',1.2);hline(d.tp2,'TP2','#2de38f','5 4',1.2);hline(d.tp3,'TP3','#2de38f','5 4',1.45);
  if(showSR){hline(sr.s,'SUPPORT','#22d7c3','3 5',1);hline(sr.r,'RESIST','#a67cff','3 5',1)}
  if(N(d.close)!=null)hline(d.close,'LIVE','#ead75b','2 3',1);

  function bubble(i,price,label,kind){
    if(i<0||i>=data.length||N(price)==null)return;const xx=x(i),yy=y(N(price));
    const cfg=kind==='sell'?{fill:'#0acb78',txt:'#05130d',dy:-24}:kind==='buy'?{fill:'#0acb78',txt:'#05130d',dy:24}:kind==='tp'?{fill:'#08d788',txt:'#03120c',dy:-22}:kind==='warn'?{fill:'#f4a51d',txt:'#171006',dy:-24}:{fill:'#2078ff',txt:'#fff',dy:24};
    const by=yy+cfg.dy,w=Math.max(48,label.length*5.3+12),h=17;add('line',{x1:xx,y1:yy,x2:xx,y2:by+(cfg.dy<0?h:0),stroke:cfg.fill,'stroke-width':.8,opacity:.8});
    add('rect',{x:Math.max(L,Math.min(W-R-w,xx-w/2)),y:by-h/2,width:w,height:h,rx:3,fill:cfg.fill,opacity:.96});
    text(Math.max(L+w/2,Math.min(W-R-w/2,xx)),by+3,label,{fill:cfg.txt,'font-size':7.4,'font-weight':900,'text-anchor':'middle'});
  }

  if(showSignals){
    let labelGap=0;
    data.forEach((b,i)=>{
      const prev=i?data[i-1]:null,act=U(b.action);const l=N(b.low),h=N(b.high),atr=N(b.atr)||((h!=null&&l!=null)?h-l:null);
      if((act==='BUY'||act==='SELL')&&labelGap<=0){bubble(i,act==='BUY'?l:h,'⚡ Solid Entry',act==='BUY'?'buy':'sell');labelGap=3}else labelGap--;
      if(prev){
        if(b.tp1Hit===true&&prev.tp1Hit!==true)bubble(i,h,'🥳 TP 1','tp');
        if(b.tp2Hit===true&&prev.tp2Hit!==true)bubble(i,h,'🥳 TP 2','tp');
        if(b.tp3Hit===true&&prev.tp3Hit!==true)bubble(i,h,'🚀 TP 3','tp');
        if(b.slHit===true&&prev.slHit!==true)bubble(i,l,'🛑 SL HIT','warn');
        const po=N(prev.close),pe=N(prev.ema9),ce=N(b.ema9),co=N(b.close);const rvol=N(b.relativeVolume),up=N(b.close)!=null&&N(b.open)!=null&&N(b.close)>N(b.open),down=N(b.close)!=null&&N(b.open)!=null&&N(b.close)<N(b.open);
        const crossUp=po!=null&&pe!=null&&co!=null&&ce!=null&&po<=pe&&co>ce,crossDown=po!=null&&pe!=null&&co!=null&&ce!=null&&po>=pe&&co<ce;
        if(atr&&rvol!=null&&rvol>1.2){
          const body=Math.abs(N(b.close)-N(b.open));if(body>atr*1.2&&up&&sideOf(b)==='BUY'&&co>ce)bubble(i,l,'🚀 Momentum Buy','mom');
          if(body>atr*1.2&&down&&sideOf(b)==='SELL'&&co<ce)bubble(i,h,'🩸 Momentum Sell','warn');
        }else if(crossUp&&sideOf(b)==='BUY'&&N(b.waveTrend1)>N(b.waveTrend2))bubble(i,l,'↻ Re-entry','mom');
        else if(crossDown&&sideOf(b)==='SELL'&&N(b.waveTrend1)<N(b.waveTrend2))bubble(i,h,'↻ Re-entry','warn');
      }
    });
  }

  const sw=194,sh=92,sx=W-R-sw-6,sy=H-B-sh-4;add('rect',{x:sx,y:sy,width:sw,height:sh,rx:4,fill:'#0b1017e8',stroke:'#273342','stroke-width':1});
  add('rect',{x:sx,y:sy,width:sw,height:17,rx:4,fill:'#44167a',opacity:.92});text(sx+7,sy+12,'📋 SOP ENTRY CHECKLIST',{fill:'#fff','font-size':8,'font-weight':900});
  const checks=[1,2,3,4,5].map(i=>d[`sop${i}`]===true);const names=['Signal','Entry Line','HEMA','Bar Color','HTF HEMA'];
  checks.forEach((ok,i)=>{text(sx+7,sy+30+i*10,`${i+1}. ${names[i]}`,{fill:'#8493a4','font-size':7});text(sx+sw-10,sy+30+i*10,ok?'✓':'✕',{fill:ok?'#32df91':'#ff5a6c','font-size':8,'font-weight':900,'text-anchor':'end'})});
  text(sx+7,sy+84,`Forecast: ${String(d.powerText||d.forecast3Bars||'—').replace(/[\u{1F300}-\u{1FAFF}]/gu,'').trim()}`,{fill:'#e4b942','font-size':7,'font-weight':800});

  const step=Math.max(1,Math.floor(data.length/7));for(let i=0;i<data.length;i+=step){const ts=N(data[i].time)||N(data[i].receivedAt);if(!ts)continue;const dt=new Date(ts),lab=dt.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',hour12:false});text(x(i),H-8,lab,{fill:'#687686','font-size':7,'text-anchor':'middle'})}
}

try{window.drawChart=drawV18}catch(_){}
addOverlayLabels();
setTimeout(()=>{try{drawV18()}catch(e){console.warn('[V18 chart]',e)}},200);
setInterval(()=>{try{drawV18()}catch(_){}},5000);
})();