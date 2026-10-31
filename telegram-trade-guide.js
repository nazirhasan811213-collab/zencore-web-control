'use strict';
const MINUTE=60000,INTERVALS={'2':30*MINUTE,'15':60*MINUTE};
const finite=Number.isFinite;
const clock=t=>new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Kuala_Lumpur',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(t));
// Only confirmed, completed source candles may supply structure or indicators.
function closedRows(candles,now,tf){
 const period=Number(tf)*MINUTE,map=new Map();
 for(const c of candles||[]){
  if(String(c.timeframe)!==tf||c.confirmed!==true||!finite(c.time)||c.time>now-period||c.time<now-5*60*MINUTE||
    !finite(c.observedAt)||c.observedAt<c.time+period-1000||c.observedAt>now+5000||
    ![c.open,c.high,c.low,c.close].every(v=>finite(v)&&v>0)||c.high<Math.max(c.open,c.close)||c.low>Math.min(c.open,c.close))continue;
  if(!map.has(c.time)||c.observedAt>map.get(c.time).observedAt)map.set(c.time,c);
 }
 return [...map.values()].sort((a,b)=>a.time-b.time).slice(tf==='2'?-15:-12);
}
function nearbyLevels(rows,price,atr,tf){
 if(rows.length<3||!finite(price)||!finite(atr)||atr<=0)return {supports:[],resistances:[]};
 const cap=tf==='2'?Math.min(atr*2,3.5):atr*3,levels=[];
 for(let i=1;i<rows.length-1;i++){
  const c=rows[i];
  if(c.high>rows[i-1].high&&c.high>=rows[i+1].high)levels.push(c.high);
  if(c.low<rows[i-1].low&&c.low<=rows[i+1].low)levels.push(c.low);
 }
 // Window extremes remain actual traded prices, not synthetic ATR targets.
 levels.push(Math.max(...rows.map(c=>c.high)),Math.min(...rows.map(c=>c.low)));
 // Recent traded highs/lows also provide nearby boundaries when a pivot has not formed.
 if(!levels.some(v=>v>price&&v-price<=cap))levels.push(...rows.slice(-5).map(c=>c.high));
 if(!levels.some(v=>v<price&&price-v<=cap))levels.push(...rows.slice(-5).map(c=>c.low));
 const distinct=[...new Set(levels)].filter(v=>Math.abs(v-price)<=cap&&Math.abs(v-price)>=.01);
 return {supports:distinct.filter(v=>v<price).sort((a,b)=>b-a).slice(0,2),resistances:distinct.filter(v=>v>price).sort((a,b)=>a-b).slice(0,2)};
}
function assess(m,candles,now,tf){
 const observed=m?.signalObservedAt,age=now-observed,rows=closedRows(candles,now,tf),last=rows.at(-1),period=Number(tf)*MINUTE;
 if(!m||m.symbol!=='XAUUSD'||String(m.timeframe)!==tf||!finite(observed)||age< -5000||age>90000||
   !last||now-(last.time+period)>period+60000)return {fresh:false};
 const {hema20:fast,hema40:slow,waveTrend1:wt1,waveTrend2:wt2,atr}=last;
 if(![fast,slow,wt1,wt2,atr,m.price].every(finite)||atr<=0||m.price<=0)return {fresh:false};
 const sign=fast>slow?1:fast<slow?-1:0,side=sign===1?'BUY':sign===-1?'SELL':'BELUM JELAS';
 let flips=0,previous=0;for(const c of rows){const d=Math.sign(c.close-c.open);if(d&&previous&&d!==previous)flips++;if(d)previous=d;}
 const wicks=rows.reduce((v,c)=>v+(c.high>c.low?1-Math.abs(c.close-c.open)/(c.high-c.low):1),0)/rows.length;
 const reasons=[];
 if(flips>=3)reasons.push('Candle kerap bertukar arah.');
 if(rows.length>=4&&wicks>=.55)reasons.push('Wick panjang, harga kerap ditarik semula.');
 if(finite(last.chopIndex)&&last.chopIndex>=61.8)reasons.push('Harga mendatar, arah kurang jelas.');
 if(Math.abs(fast-slow)<atr*.10)reasons.push('HEMA sempit, arah belum jelas.');
 const opposite=sign===0||sign*(wt1-wt2)<=0;
 if(opposite)reasons.push('Momentum belum searah HEMA.');
 const prev=rows.at(-2),momentum=prev&&[prev.waveTrend1,prev.waveTrend2].every(finite)?(Math.abs(wt1-wt2)>Math.abs(prev.waveTrend1-prev.waveTrend2)?'menguat':Math.abs(wt1-wt2)<Math.abs(prev.waveTrend1-prev.waveTrend2)?'melemah':'stabil'):'belum cukup bukti';
 const levels=nearbyLevels(rows,m.price,atr,tf),limited=rows.length<3;
 const n=m.strategyNormal,p=n?.plan,late=!!(n?.solid&&p&&((n.side==='BUY'&&m.price>=p.tp1)||(n.side==='SELL'&&m.price<=p.tp1)));
 const near=sign===1?levels.resistances[0]:levels.supports[0],nearBarrier=finite(near)&&Math.abs(near-m.price)<=atr*.35;
 const slope=prev&&finite(prev.hema20)&&finite(prev.hema40)?sign*(fast-prev.hema20)+sign*(slow-prev.hema40):0;
 const outlook=sign!==0&&!opposite&&slope>=0?side:'BELUM JELAS';
 return {fresh:true,outlook,side,sign,highRisk:reasons.length>=2,limited,reasons,aligned:!opposite,momentum,levels,atr,late,nearBarrier,closedAt:last.time+period};
}
const price=v=>v.toFixed(2);
function buildGuide(tf,m,candles,now,slot=Math.floor(now/INTERVALS[tf])*INTERVALS[tf]){
 const a=assess(m,candles,now,tf),end=slot+INTERVALS[tf];
 const date=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Kuala_Lumpur',day:'2-digit',month:'2-digit',year:'numeric'}).format(new Date(slot));
 const lines=[`📊 ZENCORE • TF${tf}`,tf==='2'?'PANDUAN 30 MINIT':'PANDUAN 1 JAM',`${date} • XAUUSD`,`🕙 ${clock(slot)}–${clock(end)} MYT`,a.fresh?`Data ${clock(m.signalObservedAt)} MYT • Candle tutup ${clock(a.closedAt)} MYT`:'Data belum segar / candle tutup belum cukup',''];
 if(!a.fresh)lines.push('🔴 DATA BELUM CUKUP / TIDAK SEGAR','ELAK ENTRY BAHARU berdasarkan report ini.','','🛡️ PANDUAN ZENCORE','Tunggu data candle tutup yang sah. Jika pegang posisi, semak SL dan sambungan MT5.');
 else{
  const avoid=a.highRisk||a.limited||a.sign===0||!a.levels.supports.length||!a.levels.resistances.length;
  lines.push(avoid?'🔴 ELAK ENTRY BAHARU':a.late||a.nearBarrier?'🟡 TUNGGU PULLBACK — JANGAN KEJAR HARGA':'🟢 TUNGGU SOP ENTRY — BUKAN ARAHAN MASUK',
   '',`💰 Harga semasa: ${price(m.price)}`);
  for(const [name,values] of [['🔴 R',a.levels.resistances],['🟢 S',a.levels.supports]]){
   if(!values.length)lines.push(`${name.startsWith('🔴')?'Resistance':'Support'}: tiada paras dekat yang jelas.`);
   values.forEach((v,i)=>lines.push(`${name}${i+1}: ${price(v)} • jarak ${price(Math.abs(v-m.price))} USD`));
  }
  lines.push('', '🔮 JANGKAAN PERGERAKAN SETERUSNYA',a.highRisk?'Harga berisiko terus ulang-alik; breakout mudah gagal.':a.outlook==='BUY'?'Senario utama: kenaikan berpotensi bersambung selepas pullback bertahan.':a.outlook==='SELL'?'Senario utama: penurunan berpotensi bersambung selepas lantunan gagal.':'Senario utama: arah seterusnya belum kukuh; tunggu pecahan paras dekat.',`Momentum: ${a.momentum}.`,...a.reasons.slice(0,3),
   a.highRisk?'🔴 MARKET BAHAYA • RISIKO LIBAS TINGGI':a.limited?'🟡 SEJARAH DATA MASIH TERHAD':'🟡 Risiko libas: perlu dipantau.');
  const s=a.levels.supports[0],r=a.levels.resistances[0];
  if(finite(s)&&finite(r)){
   lines.push('', '🔎 SENARIO SETERUSNYA',`Atas ${price(r)}: tunggu candle TF${tf} tutup dan harga bertahan. Kenaikan boleh bersambung${a.levels.resistances[1]?` ke ${price(a.levels.resistances[1])}`:''}.`,
    `Bawah ${price(s)}: tunggu candle TF${tf} tutup dan harga kekal di bawah. Penurunan boleh bersambung${a.levels.supports[1]?` ke ${price(a.levels.supports[1])}`:''}.`,
    a.sign===1?`Pandangan naik terbatal jika candle tutup bawah ${price(s)}.`:a.sign===-1?`Pandangan turun terbatal jika candle tutup atas ${price(r)}.`:'Harga di tengah kawasan ini: tunggu arah jelas.');
  }else{
   lines.push('', '🔎 SENARIO SETERUSNYA');
   if(finite(s))lines.push(`Selagi candle TF${tf} bertahan atas ${price(s)}, support ini belum pecah. Close bawahnya meningkatkan risiko sambungan turun.`);
   if(finite(r))lines.push(`Selagi candle TF${tf} kekal bawah ${price(r)}, resistance ini belum ditembusi. Close atasnya membuka senario sambungan naik.`);
   lines.push('Paras sebelah lagi belum terbentuk dekat harga. Jangan reka target atau kejar breakout.');
  }
  if(a.late)lines.push('', '⚠️ Entry asal sudah melepasi TP1. Tunggu setup baharu.');
  lines.push('', '👤 PANDUAN POSISI','• Pegang BUY: lindungi profit ikut SOP; jika support pecah, awasi risiko turun.','• Pegang SELL: lindungi profit ikut SOP; jika resistance pecah, awasi risiko naik.',
   '• Belum masuk: tunggu signal SOP yang sah. Jangan kejar candle panjang.', '', '🛡️ PANDUAN ZENCORE',
   a.highRisk?'Market kuat libas. Jaga modal dahulu. Jangan tambah posisi atau longgarkan SL.':'Elakkan entry di tengah kawasan sempit atau dekat halangan. Jangan tambah posisi untuk cover rugi.',
   '', '% profit belum disahkan. Skor indikator bukan kebarangkalian untung.', 'Panduan terbatal lebih awal jika struktur berubah.');
 }
 const compact=[`📊 ZENCORE • TF${tf}`,tf==='2'?'PANDUAN 30 MINIT':'PANDUAN 1 JAM',`${date} • XAUUSD`,`🕒 ${clock(slot)}–${clock(end)} MYT`];
 if(!a.fresh)compact.push('Data belum cukup. Tunggu data sah.','Jika pegang posisi: semak SL dan sambungan MT5.','Panduan ZenCore — Jangan entry berdasarkan laporan ini.');
 else{
  const support=a.levels.supports[0],resistance=a.levels.resistances[0],last=closedRows(candles,now,tf).at(-1);
  const hema=a.sign===1?'HEMA hijau':a.sign===-1?'HEMA merah':'HEMA belum jelas';
  const wt=last.waveTrend1>last.waveTrend2?'WT menyokong BUY':last.waveTrend1<last.waveTrend2?'WT menyokong SELL':'WT mendatar';
  compact.push('',`Harga: ${price(m.price)}`,
   a.highRisk?'Risiko: TINGGI — harga mudah libas.':a.limited?'Risiko: data struktur masih terhad.':a.nearBarrier?'Risiko: harga dekat halangan.':'Risiko: pantau pecahan paras dekat.',
   a.highRisk?'Jangkaan: mudah ulang-alik / libas.':a.outlook==='BUY'?'Jangkaan: cenderung naik.':a.outlook==='SELL'?'Jangkaan: cenderung turun.':'Jangkaan: arah belum jelas.',
   `Sebab: ${hema}; ${wt}; momentum ${a.momentum}.`,...a.reasons.slice(0,2),
   '',`Support: ${finite(support)?price(support):'belum jelas'} | Resistance: ${finite(resistance)?price(resistance):'belum jelas'}`);
  if(finite(resistance))compact.push(`Tutup atas ${price(resistance)} dan bertahan: peluang sambung naik.`);
  if(finite(support))compact.push(`Tutup bawah ${price(support)} dan bertahan: risiko sambung turun.`);
  if(a.outlook==='BUY'&&finite(support))compact.push(`Pandangan naik batal jika candle TF${tf} tutup bawah ${price(support)}.`);
  if(a.outlook==='SELL'&&finite(resistance))compact.push(`Pandangan turun batal jika candle TF${tf} tutup atas ${price(resistance)}.`);
  compact.push('',finite(support)?`Pegang BUY: jika ${price(support)} pecah, awasi tekanan turun. Jaga SL.`:'Pegang BUY: support dekat belum jelas; ikut SL dan signal exit.',
   finite(resistance)?`Pegang SELL: jika ${price(resistance)} ditembusi, awasi tekanan naik. Jaga SL.`:'Pegang SELL: resistance dekat belum jelas; ikut SL dan signal exit.',
   a.late?'Belum entry: harga sudah lepas TP1 setup asal. Tunggu setup baharu.':'Belum entry: tunggu signal SOP; jangan kejar candle panjang.',
   'Panduan ZenCore — '+(a.highRisk?'Market kuat libas. Tunggu, jaga modal.':a.late||a.nearBarrier?'Jangan kejar harga. Tunggu pullback dan SOP.':'Tunggu SOP. Jika pegang posisi, jaga profit.'),
   `Data: ${clock(m.signalObservedAt)} MYT • Candle TF${tf} tutup ${clock(a.closedAt)} MYT.`,
   'Panduan sahaja • bukan signal entry atau jaminan arah.');
 }

 return {kind:'GUIDE',symbol:'XAUUSD',timeframe:tf,time:now,guideSlot:slot,guideValidUntil:end,notificationKey:`ZENCORE_GUIDE_V1|${tf}|${slot}`,guideCompactText:compact.join('\n'),guideText:lines.join('\n')+'\n\nPanduan market sahaja • entry mesti ikut signal SOP yang sah.',guideFresh:a.fresh};
}
function createScheduler({getMarkets,history,record,now=Date.now}){
 let running=false;const done=new Set();
 async function tick(){if(running)return;running=true;try{
  const at=now(),due=Object.keys(INTERVALS).map(tf=>({tf,slot:Math.floor(at/INTERVALS[tf])*INTERVALS[tf]})).filter(x=>at-x.slot<=120000&&!done.has(x.tf+'|'+x.slot));
  if(!due.length)return;
  let markets=[];try{markets=await getMarkets();}catch{}
  for(const {tf,slot} of due){const rows=(markets||[]).filter(m=>m.symbol==='XAUUSD'&&String(m.timeframe)===tf).sort((a,b)=>(b.signalObservedAt||0)-(a.signalObservedAt||0));
   const guide=buildGuide(tf,rows[0],history(tf,at),at,slot);
   // Wait through the slot grace window for valid close snapshots; do not lock in an empty report.
   if(!guide.guideFresh&&at-slot<105000)continue;
   if(await record(guide)!==false)done.add(tf+'|'+slot);
  }
  if(done.size>20){const keys=[...done];keys.slice(0,-10).forEach(k=>done.delete(k));}
 }finally{running=false;}}
 return {tick};
}
module.exports={INTERVALS,closedRows,nearbyLevels,assess,buildGuide,createScheduler};
