'use strict';
const MINUTE=60000,INTERVALS={'2':30*MINUTE,'15':60*MINUTE};
const finite=Number.isFinite;
const clock=t=>new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Kuala_Lumpur',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(t));
function assess(m,candles,now,tf){
 const observed=m?.signalObservedAt,age=now-observed;
 if(!m||!finite(observed)||age< -5000||age>(tf==='2'?60000:30000))return {fresh:false};
 const s=m.strategyNormal?.sop||{},h=s['hema'+tf]||{},fast=m.hema20??h.fast,slow=m.hema40??h.slow,wt1=m.waveTrend1,wt2=m.waveTrend2,atr=m.atr??s.atrReference;
 if(![fast,slow,wt1,wt2,atr,m.price].every(finite)||atr<=0)return {fresh:false};
 const sign=fast>slow?1:fast<slow?-1:0,side=sign===1?'BUY':sign===-1?'SELL':'BELUM JELAS';
 const rows=(candles||[]).filter(c=>String(c.timeframe)===tf&&c.time>=Math.floor(now/INTERVALS[tf])*INTERVALS[tf]-INTERVALS[tf]&&c.time+Number(tf)*MINUTE<=now&&[c.open,c.high,c.low,c.close].every(finite)&&c.high>c.low).sort((a,b)=>a.time-b.time).slice(-10);
 let flips=0,previous=0;for(const c of rows){const d=Math.sign(c.close-c.open);if(d&&previous&&d!==previous)flips++;if(d)previous=d;}
 const wicks=rows.length?rows.reduce((v,c)=>v+1-Math.abs(c.close-c.open)/(c.high-c.low),0)/rows.length:0;
 const reasons=[];
 if(flips>=3)reasons.push('Candle kerap bertukar arah.');
 if(rows.length>=4&&wicks>=.55)reasons.push('Wick panjang, harga kerap ditarik semula.');
 if(finite(m.chopIndex)&&m.chopIndex>=61.8)reasons.push('Indikator menunjukkan harga sedang mendatar.');
 if(Math.abs(fast-slow)<atr*.10)reasons.push('HEMA sempit, arah belum jelas.');
 const opposite=sign===0||sign*(wt1-wt2)<=0;
 if(opposite)reasons.push('Momentum belum searah HEMA.');
 const highRisk=reasons.length>=2,limited=rows.length<4;
 return {fresh:true,side,highRisk,limited,reasons,aligned:!opposite};
}
function buildGuide(tf,m,candles,now,slot=Math.floor(now/INTERVALS[tf])*INTERVALS[tf]){
 const a=assess(m,candles,now,tf),end=slot+INTERVALS[tf];
 const date=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Kuala_Lumpur',day:'2-digit',month:'2-digit',year:'numeric'}).format(new Date(slot));
 const lines=[`📊 ZENCORE • TF${tf}`,tf==='2'?'PANDUAN 30 MINIT':'PANDUAN 1 JAM',`${date} • XAUUSD`,`🕙 ${clock(slot)}–${clock(end)} MYT`,a.fresh?`Data ${clock(m.signalObservedAt)} MYT • LIVE`:'Data belum segar',''];
 if(!a.fresh)lines.push('⚪ DATA BELUM CUKUP / TIDAK SEGAR','Market belum boleh dinilai sekarang.','','🛡️ PANDUAN ZENCORE','Tunggu data baharu. Jika pegang posisi, semak SL dan sambungan MT5. Jangan tambah posisi berdasarkan panduan lama.');
 else{
  const risk=a.reasons.length>=3?'🔴 MARKET BAHAYA • RISIKO LIBAS TINGGI':a.highRisk?'🟠 RISIKO LIBAS: TINGGI':a.limited?'🟡 SEJARAH DATA MASIH TERHAD':'🟡 RISIKO: PERLU DIPANTAU';
  lines.push('📈 MARKET SEKARANG',a.side==='BUY'?'Harga cenderung naik.':a.side==='SELL'?'Harga cenderung turun.':'Arah harga belum jelas.',...a.reasons.slice(0,3),risk,'',
   '👤 APA PERLU BUAT?',
   `• Pegang ${a.side==='BELUM JELAS'?'posisi':a.side}: semak SL, jangan tambah layer.`,
   '• Sedang rugi: jangan tambah posisi untuk cover rugi.',
   a.highRisk?'• Tiada posisi: tunggu harga lebih stabil.':'• Tiada posisi: jangan paksa trade.',
   '', '🎯 PELUANG PROFIT','% profit belum disahkan. Arah harga bukan jaminan untung.',
   '', '🚨 BAHAYA MENINGKAT JIKA','Harga kerap patah balik atau spread melebar.',
   '', '🛡️ PANDUAN ZENCORE',a.highRisk?'Market kuat libas. Jaga modal dahulu. Jangan tambah posisi atau longgarkan SL.':'Jaga modal dahulu. Lindungi posisi yang untung. Jangan tambah posisi untuk cover rugi.');
 }
 const malay=lines.join('\n');
 return {kind:'GUIDE',symbol:'XAUUSD',timeframe:tf,time:now,guideSlot:slot,guideValidUntil:end,notificationKey:`ZENCORE_GUIDE_V1|${tf}|${slot}`,guideText:malay+'\n\nPanduan umum • bukan arahan buka/tutup order.',guideFresh:a.fresh};
}
function createScheduler({getMarkets,history,record,now=Date.now}){
 let running=false;const done=new Set();
 async function tick(){if(running)return;running=true;try{
  const at=now(),due=Object.keys(INTERVALS).map(tf=>({tf,slot:Math.floor(at/INTERVALS[tf])*INTERVALS[tf]})).filter(x=>at-x.slot<=120000&&!done.has(x.tf+'|'+x.slot));
  if(!due.length)return;
  let markets=[];try{markets=await getMarkets();}catch{}
  for(const {tf,slot} of due){const rows=(markets||[]).filter(m=>m.symbol==='XAUUSD'&&String(m.timeframe)===tf).sort((a,b)=>(b.signalObservedAt||0)-(a.signalObservedAt||0));
   if(await record(buildGuide(tf,rows[0],history(tf,at),at,slot))!==false)done.add(tf+'|'+slot);
  }
  if(done.size>20){const keys=[...done];keys.slice(0,-10).forEach(k=>done.delete(k));}
 }finally{running=false;}}
 return {tick};
}
module.exports={INTERVALS,assess,buildGuide,createScheduler};
