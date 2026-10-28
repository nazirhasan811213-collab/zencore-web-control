(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.ZenCoreFusion=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const VERSION='ZENCORE_FUSION_RESEARCH_V1';
const METHODS=Object.freeze({ema:[20,40],rsi:14,atr:14,warmup:80,localAtr:2.5,structureWindow:40});
const SOURCES=Object.freeze([
 {name:'EMA · trend',url:'https://www.tradingview.com/support/solutions/43000592270-exponential-moving-average/'},
 {name:'RSI · momentum',url:'https://www.tradingview.com/support/solutions/43000502338-relative-strength-index-rsi/'},
 {name:'ATR · saiz gerak',url:'https://www.tradingview.com/support/solutions/43000501823-average-true-range-atr/'},
 {name:'Ujian tanpa data masa depan',url:'https://www.tradingview.com/pine-script-docs/concepts/strategies/'},
 {name:'Selang anggaran win rate · NIST',url:'https://www.itl.nist.gov/div898/handbook/prc/section2/prc241.htm'}
]);
const num=Number.isFinite;
function average(a){return a.reduce((s,v)=>s+v,0)/a.length;}
function smooth(a,n,alpha){
 const out=Array(a.length).fill(null);if(a.length<n)return out;
 let previous=average(a.slice(0,n));out[n-1]=previous;
 for(let i=n;i<a.length;i++){previous=alpha*a[i]+(1-alpha)*previous;out[i]=previous;}return out;
}
// SMA-seeded EMA and Wilder RMA. Fixed research definitions, not Pine HEMA.
function ema(a,n){return smooth(a,n,2/(n+1));}
function rma(a,n){return smooth(a,n,1/n);}
function rsi(a,n=14){
 const gains=[],losses=[];
 for(let i=1;i<a.length;i++){const d=a[i]-a[i-1];gains.push(Math.max(0,d));losses.push(Math.max(0,-d));}
 const g=rma(gains,n),l=rma(losses,n),out=Array(a.length).fill(null);
 for(let i=0;i<g.length;i++)if(g[i]!==null)out[i+1]=l[i]===0?(g[i]===0?50:100):100-100/(1+g[i]/l[i]);return out;
}
function atr(c,n=14){return rma(c.map((v,i)=>Math.max(v.high-v.low,i?Math.abs(v.high-c[i-1].close):0,i?Math.abs(v.low-c[i-1].close):0)),n);}
const timestamp=v=>typeof v==='number'?v:typeof v==='string'?Date.parse(v):NaN;
function normalize(input,options={}){
 if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('Format data tidak sah.');
 const secretKeys=/^(authToken|password|secret|apiKey|authorization|access_token|refresh_token)$/i;
 const inspect=(obj,depth=0)=>{if(depth>12)throw new Error('Data terlalu dalam.');if(obj&&typeof obj==='object')for(const [key,value]of Object.entries(obj)){if(secretKeys.test(key))throw new Error('Buang token atau password daripada fail sebelum import.');inspect(value,depth+1);}};inspect(input);
 const p=input.pine||input.market,h=input.history;
 if(!p||!h||!Array.isArray(h.candles))throw new Error('Perlu dua bahagian: pine dan history.candles.');
 const tf=String(p.timeframe),symbol=p.symbol;
 if(symbol!=='XAUUSD'||h.symbol!==symbol||!['2','15'].includes(tf)||String(h.timeframe)!==tf)throw new Error('Simbol dan TF Pine/candle mesti sepadan: XAUUSD TF2 atau TF15.');
 const asOf=timestamp(p.signalObservedAt??p.emittedAt),receivedAt=timestamp(p.receivedAt??input.receivedAt);
 if(!num(asOf)||asOf<=0)throw new Error('Masa signal Pine tidak sah.');
 if(h.candles.length>5000)throw new Error('Maksimum 5,000 candle bagi satu import.');
 const candles=[],seen=new Set();let previous=0,excludedOpen=0;
 for(const c of h.candles){
  const t=timestamp(c.time);
  if(!num(t)||t<=0||t<=previous||seen.has(t))throw new Error('Candle mesti tersusun dan tidak berulang.');
  if(c.timeframe!==undefined&&String(c.timeframe)!==tf)throw new Error('Timeframe candle bercampur.');
  if(![c.open,c.high,c.low,c.close].every(v=>num(v)&&v>0)||c.high<Math.max(c.open,c.close)||c.low>Math.min(c.open,c.close)||c.low>c.high)throw new Error('Nilai OHLC candle tidak sah.');
  previous=t;seen.add(t);
  if(t+Number(tf)*60000>asOf){excludedOpen++;continue;}
  candles.push({time:t,open:c.open,high:c.high,low:c.low,close:c.close});
 }
 if(!candles.length&&!(input.mode==='ZENCORE_READONLY'&&options.originVerified===true))throw new Error('Belum ada candle yang sudah tutup pada masa signal.');
 const m=p.setupMeta||{},strategy=p.strategyNormal||{},dash=m.dashboardAi?.dashboard||{};
 const hema=p.hemaConfirmation?.['tf'+tf]||strategy.sop?.['hema'+tf]||{};
 const price=p.normal3Close??p.close;
 if(!num(price)||price<=0)throw new Error('Harga Pine tidak sah.');
 const side=m.solidSide||strategy.side;
 const plan={entry:p.normal3Entry??strategy.plan?.entry,sl:p.initialSl??strategy.plan?.sl,tp1:p.tp1??strategy.plan?.tp1,tp2:p.tp2??strategy.plan?.tp2,tp3:p.tp3??strategy.plan?.tp3};
 // Only reviewed market fields survive normalization; no user/account payload is retained.
 return {version:VERSION,mode:input.mode==='SAMPLE'?'SAMPLE':input.mode==='ZENCORE_READONLY'&&options.originVerified===true?'ZENCORE_READONLY':'MANUAL',symbol,tf,asOf,receivedAt,barTime:timestamp(p.sourceBarTime??p.time),confirmed:p.confirmed===true,
  price,side:['BUY','SELL'].includes(side)?side:null,solid:m.solidHoldActive===true&&m.solidClosedAt==null,
  policy:String(m.entryPolicyVersion||m.entryRuleVersion||''),rule:String(m.entryRuleVersion||''),serverReady:strategy.state==='READY',
  hemaFast:num(hema.fast)?hema.fast:null,hemaSlow:num(hema.slow)?hema.slow:null,
  pineRsi:num(dash.rsi)?dash.rsi:null,plan,candles,excludedOpen,
  spread:num(input.costs?.spread)?input.costs.spread:null,slippage:num(input.costs?.slippageRoundTrip)?input.costs.slippageRoundTrip:null,
  commission:num(input.costs?.commissionPrice)?input.costs.commissionPrice:null,
  newsClear:input.news?.clear===true,newsCheckedAt:timestamp(input.news?.checkedAt),newsCoverage:String(input.news?.coverage||''),newsStart:timestamp(input.news?.windowStartsAt),newsEnd:timestamp(input.news?.windowEndsAt)};
}
function structure(c,price,a){
 const bars=c.slice(-METHODS.structureWindow),highs=[],lows=[];
 // A pivot is considered only after both right-hand bars have CLOSED.
 for(let i=2;i<bars.length-2;i++){
  const around=[bars[i-2],bars[i-1],bars[i+1],bars[i+2]];
  if(around.every(b=>bars[i].high>b.high))highs.push(bars[i].high);
  if(around.every(b=>bars[i].low<b.low))lows.push(bars[i].low);
 }
 const up=highs.length>=2&&lows.length>=2&&highs.at(-1)>highs.at(-2)&&lows.at(-1)>lows.at(-2);
 const down=highs.length>=2&&lows.length>=2&&highs.at(-1)<highs.at(-2)&&lows.at(-1)<lows.at(-2);
 const levels=[...highs,...lows,...(highs.length||lows.length?[]:[Math.max(...bars.map(b=>b.high)),Math.min(...bars.map(b=>b.low))])];
 const local=levels.filter(v=>num(a)&&Math.abs(v-price)<=METHODS.localAtr*a);
 return {direction:up?'BUY':down?'SELL':'RANGE',support:local.filter(v=>v<price).sort((a,b)=>b-a)[0]??null,resistance:local.filter(v=>v>price).sort((a,b)=>a-b)[0]??null};
}
function analyze(data,now=Date.now(),horizon=30,calendar=[]){
 const c=data.candles,closes=c.map(x=>x.close),e20=ema(closes,20),e40=ema(closes,40),rs=rsi(closes),at=atr(c),a=at.at(-1),last=c.at(-1),side=data.side;
 const trend=num(e20.at(-1))&&num(e40.at(-1))?(e20.at(-1)>e40.at(-1)&&e20.at(-1)>e20.at(-2)?'BUY':e20.at(-1)<e40.at(-1)&&e20.at(-1)<e20.at(-2)?'SELL':'RANGE'):'WAIT';
 const s=structure(c,data.price,a),r=rs.at(-1)??null,warm=c.length>=METHODS.warmup;
 const gap=last?Math.abs(data.price-last.close):Infinity,matched=!!last&&data.barTime===last.time&&gap<=.01+1e-9;
 const gaps=c.some((v,i)=>i&&v.time-c[i-1].time!==Number(data.tf)*60000);
 const fresh=num(data.receivedAt)&&now-data.receivedAt>=-5000&&now-data.receivedAt<=(data.tf==='2'?60000:30000)&&now-data.asOf>=-5000&&now-data.asOf<=(data.tf==='2'?60000:30000);
 const sign=side==='BUY'?1:side==='SELL'?-1:0,p=data.plan;
 const planOK=!!sign&&[p.entry,p.sl,p.tp1,p.tp2,p.tp3].every(v=>num(v)&&v>0)&&sign*(p.entry-p.sl)>0&&sign*(p.tp1-p.entry)>0&&sign*(p.tp2-p.tp1)>0&&sign*(p.tp3-p.tp2)>0;
 const knownRule=data.tf==='2'?['TF2_SOLID_RIBBON_V1','TF2_SOLID_HOLD_SCALP_CAP_V5','TF2_CURRENT_SOLID_3GREEN_HEMA_PRICE_V1','TF2_SEP24_4GREEN_HEMA5_V1'].includes(data.rule):data.rule==='TF15_SOLID_RIBBON_V1';
 const knownPolicy=knownRule&&/^(PINE_3TRIGGERS_3OF4_CHOP50_V3|PINE_3TRIGGERS_3OF4_FORECAST45_V4|PINE_SOLID_3OF4_FORECAST45_V5|TF2_SOLID_HOLD_SCALP_CAP_V5|TF2_CURRENT_SOLID_3GREEN_HEMA_PRICE_V1|TF2_SEP24_4GREEN_HEMA5_V1)$/.test(data.policy);
 const costsKnown=[data.spread,data.slippage,data.commission].every(v=>num(v)&&v>=0);
 const costs=costsKnown?data.spread+data.slippage+data.commission:null;
 const netReward=planOK&&costsKnown?sign*(p.tp1-p.entry)-costs:null;
 const rr=planOK&&costsKnown?netReward/(sign*(p.entry-p.sl)+costs):null;
 const newsOK=[30,60].includes(Number(horizon))&&data.newsClear&&data.newsCoverage==='REPORT_WINDOW'&&num(data.newsCheckedAt)&&now-data.newsCheckedAt>=0&&now-data.newsCheckedAt<=15*60000&&data.newsStart<=data.asOf&&data.newsEnd>=data.asOf+Number(horizon)*60000;
 const knownEvents=calendar.filter(e=>{const at=timestamp(e.at);return num(at)&&at>=data.asOf&&at<=data.asOf+Number(horizon)*60000;});
 const lastLarge=!!last&&num(a)&&last.high-last.low>=1.5*a;
 const hemaDirection=num(data.hemaFast)&&num(data.hemaSlow)?data.hemaFast>data.hemaSlow?'BUY':data.hemaFast<data.hemaSlow?'SELL':'RANGE':'WAIT';
 const row=(name,status,value,detail)=>({name,status,value,detail});
 const rows=[
  row('Pine',matched&&data.confirmed&&data.solid&&data.serverReady&&knownPolicy&&planOK?'PASS':'WAIT',side||'Belum ada arah',matched?'Perlu SOLID, candle tutup dan keputusan server asal.':'Masa/harga Pine belum sepadan dengan candle tutup.'),
  row('Trend',!warm?'WAIT':trend===side&&hemaDirection===side?'PASS':trend==='WAIT'||hemaDirection==='WAIT'?'WAIT':'CONFLICT',trend==='BUY'?'Menaik':trend==='SELL'?'Menurun':'Belum jelas','EMA20/40 dan HEMA Pine dalam satu kumpulan trend.'),
  row('Struktur harga',!warm?'WAIT':s.direction===side?'PASS':s.direction==='RANGE'?'WAIT':'CONFLICT',s.direction==='BUY'?'Puncak & lantai naik':s.direction==='SELL'?'Puncak & lantai turun':'Belum membentuk arah','Swing disahkan selepas dua candle di kanan tutup.'),
  row('Momentum',!warm||r===null?'WAIT':side==='BUY'&&r>50&&r<70||side==='SELL'&&r>30&&r<50?'PASS':'CONFLICT',r===null?'RSI belum cukup':`RSI14 ${r.toFixed(1)}`,'Julat RSI V1 ialah calon penapis untuk diuji, bukan ambang yang terbukti terbaik.'),
  row('Gerak & kos',!warm||!costsKnown||!planOK?'WAIT':lastLarge||!(netReward>0)?'CONFLICT':'PASS',num(a)?`ATR14 ${a.toFixed(2)}`:'Belum cukup candle',!costsKnown?'Spread, slippage dan komisen belum lengkap.':lastLarge?'Candle besar: tunggu semakan SOP.':`R:R indikatif selepas kos ke TP1: ${rr.toFixed(2)}. Pelan asal Pine dikekalkan.`),
  row('Berita',knownEvents.length?'CONFLICT':newsOK?'PASS':'WAIT',knownEvents.length?'Ada berita dalam tempoh':newsOK?'Tetingkap disemak':'Belum disemak',knownEvents.length?'Jadual yang diketahui: '+knownEvents.map(e=>e.name).join(', ')+'.': 'Perlu semakan berita untuk seluruh tempoh laporan; kalendar lama tidak meluluskan setup.')
 ];
 const conflicts=rows.filter(x=>x.status==='CONFLICT'),waiting=rows.filter(x=>x.status==='WAIT');
 const aligned=warm&&!gaps&&matched&&data.confirmed&&fresh&&rows.every(x=>x.status==='PASS');
 let title=!fresh?'Data lama. Tunggu data baharu.':!warm?'Tunggu candle yang cukup.':!matched?'Tunggu padanan Pine yang sah.':conflicts.length?'Bacaan bercanggah. Tunggu.':waiting.length?'Semakan belum lengkap.':aligned?'Sehala · calon untuk diuji.':'Tunggu data yang lengkap.';
 if(data.mode==='SAMPLE')title='CONTOH · '+title;
 else title=(data.mode==='ZENCORE_READONLY'?'ZENCORE · BACA SAHAJA · ':'IMPORT MANUAL · ')+title;
 return {version:VERSION,mode:data.mode,title,aligned,liveSignal:false,orderExecution:false,side,rows,trend,structure:s,ema20:e20.at(-1),ema40:e40.at(-1),rsi:r,atr:a,netRR:rr,warmup:c.length,warmupRequired:METHODS.warmup,gaps,matched,fresh,excludedOpen:data.excludedOpen,
  conclusion:aligned?'Penapis V1 sehala. Masih perlu ujian luar sampel; ini bukan signal live yang disahkan.':!warm?`Perlu sekurang-kurangnya ${METHODS.warmup} candle tutup; ada ${c.length}.`:gaps?'Ada jurang candle. Lengkapkan sejarah dahulu.':conflicts.length?'Yang bercanggah: '+conflicts.map(x=>x.name).join(', ')+'. Jangan paksa entry.':waiting.length?'Belum lengkap: '+waiting.map(x=>x.name).join(', ')+'.':'Semak masa dan padanan candle.',
  reference:{price:data.price,plan:planOK?{...p}:null,support:s.support,resistance:s.resistance}};
}
function wilson(wins,n){
 if(!Number.isInteger(n)||n<=0||!Number.isInteger(wins)||wins<0||wins>n)return null;
 const z=1.959963984540054,p=wins/n,d=1+z*z/n,centre=(p+z*z/(2*n))/d,half=z*Math.sqrt(p*(1-p)/n+z*z/(4*n*n))/d;
 return {low:Math.max(0,centre-half),high:Math.min(1,centre+half)};
}
function performance(records,tf,horizon,now=Date.now()){
 if(!Array.isArray(records)||records.length>100000)throw new Error('Format rekod ujian tidak sah.');
 const selected=records.filter(t=>String(t.timeframe)===String(tf)&&Number(t.horizonMinutes)===Number(horizon)&&t.split==='OOS');
 const seen=new Set();let previousClose=0,equity=0,peak=0,maxDrawdown=0,wins=0,positive=0,negative=0;
 for(const t of selected){
  const opened=timestamp(t.openedAt),closed=timestamp(t.closedAt);
  if(typeof t.id!=='string'||!t.id||seen.has(t.id)||t.variant!==VERSION||!num(t.netR)||!num(t.costR)||t.costR<0||!num(t.grossR)||Math.abs(t.netR-(t.grossR-t.costR))>1e-8||!num(opened)||!num(closed)||closed<opened||opened<previousClose||closed>now||closed>opened+Number(horizon)*60000)throw new Error('Satu rekod bagi satu setup: unik, tidak bertindih, selepas kos dan dalam horizon ujian.');
  if(!['SOP','HORIZON'].includes(t.exitKind)||t.exitKind==='HORIZON'&&closed!==opened+Number(horizon)*60000)throw new Error('Hasil perlu exit SOP dalam tetingkap, atau penilaian tepat pada akhir horizon.');
  if(t.labelGeneratedAt===undefined||timestamp(t.labelGeneratedAt)>opened||timestamp(t.labelGeneratedAt)<=0||!num(timestamp(t.labelGeneratedAt)))throw new Error('Masa analisis mesti wujud sebelum entry.');
  seen.add(t.id);previousClose=closed;if(t.netR>0){wins++;positive+=t.netR;}else negative-=t.netR;
  equity+=t.netR;peak=Math.max(peak,equity);maxDrawdown=Math.max(maxDrawdown,peak-equity);
 }
 const n=selected.length;
 return {n,wins,breakevens:selected.filter(t=>t.netR===0).length,winRate:n?wins/n:null,interval:wilson(wins,n),netR:n?equity:null,expectancy:n?equity/n:null,profitFactor:n?(negative>0?positive/negative:null):null,noLosses:n>0&&negative===0,maxDrawdown:n?maxDrawdown:null,provenance:'MANUAL_UNVERIFIED',scope:'OOS_CLOSED_TRADES_ONLY',prediction:false};
}
return {VERSION,METHODS,SOURCES,ema,rma,rsi,atr,normalize,structure,analyze,wilson,performance};
});
