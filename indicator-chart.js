(() => {
 'use strict';
 const Core=window.ZenCoreIndicatorData;
 if(!Core)return;
 const node=(tag,text,cls)=>{const e=document.createElement(tag);if(text)e.textContent=text;if(cls)e.className=cls;return e;};
 const fmt=v=>Number.isFinite(v)?v.toFixed(2):'—';
 const clock=t=>new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Kuala_Lumpur',hour:'2-digit',minute:'2-digit'}).format(t);
 function mount(host,tf){
  let points=[],market=null,live=false,visible=80,hover=null,closed=false,loadFailed=false,loading=false;
  const box=node('section',null,'zc-indicator-chart');box.setAttribute('aria-label','Chart indikator ZenCore TF'+tf);
  const top=node('div',null,'zc-chart-top'),heading=node('div'),badge=node('span','TUNGGU FEED','zc-chart-status');
  heading.append(node('strong','ZENCORE CHART'),node('small','XAUUSD · TF'+tf+' · Data Pine'));
  const controls=node('div',null,'zc-chart-controls');
  for(const [text,title,change] of [['−','Lihat lebih banyak candle',()=>{visible=Math.min(300,visible+20);}],['+','Besarkan candle',()=>{visible=Math.max(12,visible-20);}],['Reset','Reset zoom chart',()=>{visible=80;hover=null;}]]){
   const b=node('button',text);b.type='button';b.setAttribute('aria-label',title+' TF'+tf);b.onclick=()=>{change();draw();};controls.append(b);
  }
  top.append(heading,badge,controls);
  const legend=node('div',null,'zc-chart-legend');
  for(const [text,cls] of [['Candle Pine','candle'],['HEMA20','fast'],['HEMA40','slow'],['SOLID BUY / SELL','solid'],['Entry · SL · TP','plan']])legend.append(node('span',text,cls));
  const readout=node('div','O —  H —  L —  C —','zc-chart-ohlc'),stage=node('div',null,'zc-chart-stage'),canvas=node('canvas'),empty=node('div','Menunggu candle Pine TF'+tf+'. Tiada candle rekaan.','zc-chart-empty');
  canvas.setAttribute('role','img');canvas.setAttribute('aria-label','Candle XAUUSD TF'+tf+', ribbon HEMA dan paras pelan indikator');stage.append(canvas,empty);
  const note=node('p','Sejarah dikumpul sejak server bermula, maksimum 5 jam. Pelan indikator, bukan pengesahan order MT5.','zc-chart-note');
  box.append(top,legend,readout,stage,note);host.append(box);
  function draw(){
   if(closed)return;
   const rect=stage.getBoundingClientRect();if(rect.width<20)return;
   const w=Math.round(rect.width),h=Math.round(rect.height),dpr=Math.min(window.devicePixelRatio||1,2);
   canvas.width=w*dpr;canvas.height=h*dpr;canvas.style.width=w+'px';canvas.style.height=h+'px';
   const ctx=canvas.getContext('2d');if(!ctx)return;ctx.scale(dpr,dpr);ctx.fillStyle='#07131e';ctx.fillRect(0,0,w,h);
   points=Core.merge(points,null,tf);
   const data=points.slice(-visible),last=data.at(-1);
   empty.hidden=!!last;
   const observed=last?.observedAt||0,age=Date.now()-observed;
   const fresh=live&&age>=-5000&&age<=30000;
   badge.textContent=last?(fresh?'FEED LIVE':'DATA TERAKHIR'):'TUNGGU FEED';badge.className='zc-chart-status'+(fresh?' is-live':'');
   note.textContent=(loadFailed?'Sejarah belum tersedia; paparan daripada feed yang diterima. ':'Sejarah sejak server bermula · maksimum 5 jam. ')+(last?'Candle: '+data.length+' · '+clock(last.time)+' MYT. ':'')+'Pelan indikator, bukan pengesahan order MT5.';
   if(!last){readout.textContent='O —  H —  L —  C —';return;}
   const latest=market?.strategyNormal,plan=latest?.plan||{},side=latest?.side;
   const levels=['entry','sl','tp1','tp2','tp3'].filter(k=>Number.isFinite(plan[k])&&plan[k]>0);
   const values=data.flatMap(p=>[p.low,p.high,p.hema20,p.hema40]).filter(Number.isFinite);
   if(levels.length&&['BUY','SELL'].includes(side))for(const k of levels)values.push(plan[k]);
   let min=Math.min(...values),max=Math.max(...values),range=Math.max(max-min,.1);min-=range*.13;max+=range*.16;range=max-min;
   const left=12,right=w<500?91:106,topY=24,bottom=h-32,plotW=w-left-right,plotH=bottom-topY;
   const step=plotW/Math.max(data.length,12),x=i=>left+(i+.5)*step,y=v=>topY+(max-v)/range*plotH;
   ctx.font='11px system-ui';ctx.lineWidth=1;
   for(let i=0;i<=5;i++){const yy=topY+i*plotH/5;ctx.strokeStyle='#18303e';ctx.beginPath();ctx.moveTo(left,yy);ctx.lineTo(w-right+2,yy);ctx.stroke();ctx.fillStyle='#8ba3b5';ctx.fillText(fmt(max-i*range/5),w-right+7,yy+4);}
   // Draw only received points. Missing feed intervals are never interpolated.
   for(let i=1;i<data.length;i++){
    const a=data[i-1],b=data[i];if(b.time-a.time>Number(tf)*60000||![a.hema20,a.hema40,b.hema20,b.hema40].every(Number.isFinite))continue;
    ctx.fillStyle=b.hema20>=b.hema40?'#27d5ae24':'#f2718524';ctx.beginPath();ctx.moveTo(x(i-1),y(a.hema20));ctx.lineTo(x(i),y(b.hema20));ctx.lineTo(x(i),y(b.hema40));ctx.lineTo(x(i-1),y(a.hema40));ctx.closePath();ctx.fill();
   }
   for(const [key,color] of [['hema20','#45ddbd'],['hema40','#eeaf67']]){
    ctx.strokeStyle=color;ctx.lineWidth=1.7;ctx.beginPath();let started=false,prev=null;
    data.forEach((p,i)=>{if(!Number.isFinite(p[key])){started=false;return;}if(!started||p.time-prev>Number(tf)*60000)ctx.moveTo(x(i),y(p[key]));else ctx.lineTo(x(i),y(p[key]));started=true;prev=p.time;});ctx.stroke();
   }
   const body=Math.max(2,Math.min(11,step*.65));
   data.forEach((p,i)=>{
    const xx=x(i),up=p.close>=p.open;ctx.strokeStyle=ctx.fillStyle=up?'#4bd8b4':'#f47788';ctx.lineWidth=1;
    ctx.beginPath();ctx.moveTo(xx,y(p.high));ctx.lineTo(xx,y(p.low));ctx.stroke();ctx.fillRect(xx-body/2,Math.min(y(p.open),y(p.close)),body,Math.max(1.5,Math.abs(y(p.open)-y(p.close))));
    if(p.solid){const buy=p.solid==='BUY',yy=buy?y(p.low)+11:y(p.high)-11;ctx.fillStyle=buy?'#80f9d7':'#ffb0bd';ctx.beginPath();ctx.moveTo(xx,yy+(buy?-5:5));ctx.lineTo(xx-4,yy+(buy?3:-3));ctx.lineTo(xx+4,yy+(buy?3:-3));ctx.closePath();ctx.fill();ctx.font='bold 9px system-ui';ctx.fillText(p.solid,Math.max(left,xx-12),yy+(buy?14:-9));}
   });
   const tags=[];
   if(['BUY','SELL'].includes(side))for(const k of levels){
    const yy=y(plan[k]),color=k==='sl'?'#f47788':k==='entry'?'#e2ecf7':'#4bd8b4';ctx.strokeStyle=color;ctx.lineWidth=.9;ctx.setLineDash([4,4]);ctx.beginPath();ctx.moveTo(left,yy);ctx.lineTo(w-right+3,yy);ctx.stroke();ctx.setLineDash([]);tags.push({label:k.toUpperCase()+' '+fmt(plan[k]),yy,color});
   }
   tags.sort((a,b)=>a.yy-b.yy);let prior=-100;
   for(const tag of tags){const yy=Math.min(bottom,Math.max(topY,tag.yy,prior+14));prior=yy;ctx.fillStyle='#091923';ctx.fillRect(w-right+3,yy-9,right-5,14);ctx.fillStyle=tag.color;ctx.font='bold 10px system-ui';ctx.fillText(tag.label,w-right+7,yy+2);}
   ctx.fillStyle='#7893a7';ctx.font='10px system-ui';const tick=Math.max(1,Math.ceil(data.length/4));data.forEach((p,i)=>{if(i%tick===0)ctx.fillText(clock(p.time),x(i)-15,h-10);});
   let chosen=last;
   if(hover!==null){const i=Math.max(0,Math.min(data.length-1,Math.round((hover-left)/step-.5)));chosen=data[i];const xx=x(i);ctx.setLineDash([3,4]);ctx.strokeStyle='#a0b8c166';ctx.beginPath();ctx.moveTo(xx,topY);ctx.lineTo(xx,bottom);ctx.stroke();ctx.setLineDash([]);}
   readout.textContent=clock(chosen.time)+' MYT  ·  O '+fmt(chosen.open)+'  H '+fmt(chosen.high)+'  L '+fmt(chosen.low)+'  C '+fmt(chosen.close);
  }
  async function load(){
   if(loading||closed)return;loading=true;
   try{const r=await fetch('/api/analysis/chart?symbol=XAUUSD&tf='+tf,{credentials:'same-origin',cache:'no-store'});if(!r.ok)throw Error('CHART_UNAVAILABLE');const j=await r.json();if(!j.ok||j.symbol!=='XAUUSD'||String(j.timeframe)!==String(tf)||!Array.isArray(j.candles))throw Error('CHART_INVALID');points=Core.merge(points,j.candles,tf);loadFailed=false;}
   catch(_){loadFailed=true;}finally{loading=false;draw();}
  }
  canvas.addEventListener('pointermove',e=>{hover=e.clientX-canvas.getBoundingClientRect().left;draw();});canvas.addEventListener('pointerleave',()=>{hover=null;draw();});
  const observer=typeof ResizeObserver!=='undefined'?new ResizeObserver(draw):null;observer?.observe(stage);
  const refresh=setInterval(load,60000);load();
  window.addEventListener('pagehide',()=>{closed=true;clearInterval(refresh);observer?.disconnect();},{once:true});
  return {update(m,isLive){market=m;live=isLive;const p=Core.point(m);if(p)points=Core.merge(points,p,tf);draw();},clear(){points=[];market=null;draw();load();},resize:draw};
 }
 window.ZenCoreIndicatorChart={mount};
})();
