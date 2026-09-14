const http=require('http');
const fs=require('fs');
const path=require('path');

const PUBLIC_PORT=Number(process.env.PORT||8080);
const V16_PORT=PUBLIC_PORT===10001?10002:10001;
process.env.PORT=String(V16_PORT);
require('./server-v16.js');
process.env.PORT=String(PUBLIC_PORT);

const DEFAULT_MARKETS=['XAUUSD','EURUSD','GBPUSD','USDJPY','US30','USDCAD','USDCHF','EURJPY','GBPJPY','EURGBP','BTCUSD'];
const latestBySymbol=new Map();
const historyBySymbol=new Map();
const marketClients=new Set();
const predictionClients=new Map();
const signalCoreBySymbol=new Map();
const opportunityBySymbol=new Map();
const sidewaysGuardBySymbol=new Map();
const fastStrategyBySymbol=new Map();
const normalStrategyBySymbol=new Map();
const validationOpenByKey=new Map();
const validationClosed=[];
const validationSeen=new Set();
const SIGNAL_INVALID_STREAK=2;
const SIGNAL_REVERSAL_COOLDOWN_MS=45000;
const SIGNAL_TRADE_COOLDOWN_MS=60000;
const SIDEWAYS_TRIGGER_STREAK=2;
const SIDEWAYS_CLEAR_STREAK=3;

const N=v=>{if(v===null||v===undefined||v===''||v==='null'||v==='NaN')return null;const x=Number(v);return Number.isFinite(x)?x:null};
const U=v=>String(v||'').toUpperCase();
const normSymbol=v=>U(v).replace(/^.*:/,'').replace(/[^A-Z0-9._-]/g,'');
const clamp=(v,a=0,b=100)=>Math.max(a,Math.min(b,v));

function dirText(v){
  const s=U(v);
  if(/BULL|BUY|LONG|UP/.test(s)) return 'BUY';
  if(/BEAR|SELL|SHORT|DOWN/.test(s)) return 'SELL';
  return 'WAIT';
}
function rr(d){
  const e=N(d?.entry),sl=N(d?.initialSl??d?.sl),tp=N(d?.tp3);
  if(e==null||sl==null||tp==null)return null;
  const r=Math.abs(e-sl); return r?Math.abs(tp-e)/r:null;
}
function freshness(ts,tf='3'){
  const age=Math.max(0,Date.now()-(N(ts)||0));
  const mins=Math.max(1,N(tf)||3);
  // Confirmed-bar feeds naturally update once per chart bar.
  // Allow one full bar + safety margin before calling the feed stale.
  const liveMs=Math.max(120000,mins*60000+60000);
  const staleMs=Math.max(360000,mins*60000+300000);
  return age<liveMs?'LIVE':age<staleMs?'STALE':'OFFLINE';
}
function zoneInfo(d){
  const e=N(d?.entry),a=N(d?.atr),c=N(d?.close);
  if(e==null||a==null||a<=0||c==null)return{state:'NO DATA',near:false,inZone:false,dist:null};
  const lo=e-a*.15,hi=e+a*.15,inZone=c>=lo&&c<=hi,dist=c<lo?lo-c:c>hi?c-hi:0,near=!inZone&&dist<=a*.28;
  return{state:inZone?'IN ENTRY ZONE':near?'NEAR ENTRY':c<lo?'BELOW ZONE':'ABOVE ZONE',near,inZone,dist,lo,hi};
}
function addEvidence(list,side,weight,label){ list.push({side,weight,label}); }
function recentPriceMomentum(symbol){
  const arr=(historyBySymbol.get(symbol)||[]).slice(-5);
  const closes=arr.map(x=>N(x.close)).filter(x=>x!=null);
  if(closes.length<3)return{dir:'WAIT',strength:0};
  const last=closes[closes.length-1],prev=closes[Math.max(0,closes.length-3)];
  const atr=N(arr[arr.length-1]?.atr); const move=last-prev;
  if(!atr||Math.abs(move)<atr*.10)return{dir:'WAIT',strength:0};
  return{dir:move>0?'BUY':'SELL',strength:Math.min(1.5,Math.abs(move)/atr)};
}
function rawForecastDir(d){
  const f=dirText(d?.forecast3Bars); if(f!=='WAIT')return f;
  const p=dirText(d?.powerText); if(p!=='WAIT')return p;
  return 'WAIT';
}
function predictionStability(symbol){
  const arr=(historyBySymbol.get(symbol)||[]).slice(-10);
  const dirs=arr.map(rawForecastDir).filter(x=>x!=='WAIT');
  if(!dirs.length)return 0;
  let flips=0; for(let i=1;i<dirs.length;i++)if(dirs[i]!==dirs[i-1])flips++;
  const last=dirs[dirs.length-1]; const share=dirs.filter(x=>x===last).length/dirs.length;
  let run=0;for(let i=dirs.length-1;i>=0&&dirs[i]===last;i--)run++;
  return clamp(Math.round(45+share*45+Math.min(10,run*2)-flips*12));
}
function predictionEngine(d,symbol){
  if(!d)return{direction:'WAIT',confidence:0,consensus:0,totalEvidence:0,strength:'NO DATA',horizon:'NEXT 1–3 BARS',reasons:[],conflict:true};
  const ev=[];
  const f3=dirText(d.forecast3Bars); if(f3!=='WAIT')addEvidence(ev,f3,28,'3-bar forecast');
  const p10=dirText(d.powerText); if(p10!=='WAIT')addEvidence(ev,p10,18,'10-bar market power');
  const ms=dirText(d.marketStructure); if(ms!=='WAIT')addEvidence(ev,ms,13,'market structure');
  const hema=dirText(d.hemaTrend); if(hema!=='WAIT')addEvidence(ev,hema,12,'HEMA trend');
  const mom=dirText(d.momentum); if(mom!=='WAIT')addEvidence(ev,mom,11,'momentum');
  const gt=N(d.globalTrend); if(gt!=null&&gt!==0)addEvidence(ev,gt>0?'BUY':'SELL',7,'global trend');
  for(const [k,label] of [['mtf1','MTF-1'],['mtf2','MTF-2'],['mtf3','MTF-3']]){ const v=N(d[k]);if(v!=null&&v!==0)addEvidence(ev,v>0?'BUY':'SELL',5,label); }
  const c=N(d.close),e9=N(d.ema9),e20=N(d.ema20),e50=N(d.ema50);
  if([c,e9,e20,e50].every(v=>v!=null)){
    if(c>e9&&e9>e20&&e20>e50)addEvidence(ev,'BUY',12,'EMA stack');
    else if(c<e9&&e9<e20&&e20<e50)addEvidence(ev,'SELL',12,'EMA stack');
  }
  const hf=N(d.hemaFast),hs=N(d.hemaSlow); if(hf!=null&&hs!=null&&hf!==hs)addEvidence(ev,hf>hs?'BUY':'SELL',8,'HEMA slope');
  const w1=N(d.waveTrend1),w2=N(d.waveTrend2); if(w1!=null&&w2!=null&&Math.abs(w1-w2)>.2)addEvidence(ev,w1>w2?'BUY':'SELL',7,'WaveTrend');
  const rsi=N(d.rsi); if(rsi!=null){if(rsi>=56)addEvidence(ev,'BUY',5,'RSI pressure');else if(rsi<=44)addEvidence(ev,'SELL',5,'RSI pressure');}
  const rpm=recentPriceMomentum(symbol); if(rpm.dir!=='WAIT')addEvidence(ev,rpm.dir,Math.round(7*rpm.strength),'recent price impulse');

  const buy=ev.filter(x=>x.side==='BUY').reduce((a,x)=>a+x.weight,0);
  const sell=ev.filter(x=>x.side==='SELL').reduce((a,x)=>a+x.weight,0);
  const leader=buy>=sell?'BUY':'SELL'; const lead=Math.abs(buy-sell);
  const leaderEvidence=ev.filter(x=>x.side===leader).sort((a,b)=>b.weight-a.weight);
  const totalWeight=buy+sell||1; const agreeWeight=Math.max(buy,sell)/totalWeight; const consensus=leaderEvidence.length;
  const chop=N(d.chopIndex); const chopPenalty=chop!=null?(chop>=65?22:chop>=58?12:chop<=38?-4:0):0;
  const conflict=(f3!=='WAIT'&&p10!=='WAIT'&&f3!==p10) || agreeWeight<.61;
  const freshPenalty=freshness(d.receivedAt)==='LIVE'?0:freshness(d.receivedAt)==='STALE'?18:40;
  const rvol=N(d.relativeVolume); const volumeBoost=rvol!=null&&rvol>=1.2?4:0;
  let confidence=50+lead*.28+(agreeWeight-.5)*42+Math.min(10,consensus*1.5)+volumeBoost-chopPenalty-freshPenalty-(conflict?10:0);
  confidence=clamp(Math.round(confidence));
  let direction='WAIT';
  if(lead>=24&&consensus>=4&&agreeWeight>=.64&&confidence>=68)direction=leader;
  if(chop!=null&&chop>=68&&confidence<84)direction='WAIT';
  if(f3!=='WAIT'&&p10!=='WAIT'&&f3!==p10&&confidence<82)direction='WAIT';

  const strength=direction==='WAIT'?(confidence>=70?'CONFLICT':'LOW'):confidence>=86?'STRONG':confidence>=76?'GOOD':'EARLY';
  const reasons=leaderEvidence.slice(0,4).map(x=>x.label);
  return{direction,confidence,consensus,totalEvidence:ev.length,strength,horizon:'NEXT 1–3 BARS',reasons,conflict,bullScore:buy,bearScore:sell,agreement:Math.round(agreeWeight*100),currentAction:U(d.action||'WAIT'),freshness:freshness(d.receivedAt,d.timeframe)};
}


function snapshotKey(d){return String(N(d?.time)??N(d?.barIndex)??N(d?.receivedAt)??'');}
function flipCount(vals){
  const xs=vals.filter(v=>v===1||v===-1);let n=0;
  for(let i=1;i<xs.length;i++)if(xs[i]!==xs[i-1])n++;
  return n;
}
function sidewaysGuard(symbol,d){
  const now=Date.now(),key=snapshotKey(d);
  let g=sidewaysGuardBySymbol.get(symbol)||{active:false,dangerStreak:0,cleanStreak:0,lastKey:'',reason:'Market clear',activatedAt:0,chop:null,emaFlips:0,priceReversals:0};
  if(g.lastKey===key)return g;

  const arr=(historyBySymbol.get(symbol)||[]).slice(-8);
  const chop=N(d?.chopIndex);
  const structure=U(d?.marketStructure);
  const explicitSideways=/SIDEWAY|CHOP|RANGE|FLAT/.test(structure);const a3=analysis3m(symbol,d);
  const hardChop=chop!=null&&chop>=68;
  const softChop=chop!=null&&chop>=61.8;

  const emaSides=arr.map(x=>{
    const c=N(x?.close),e=N(x?.ema9);if(c==null||e==null||c===e)return 0;return c>e?1:-1;
  });
  const emaFlips=flipCount(emaSides);

  const closes=arr.map(x=>N(x?.close)).filter(v=>v!=null);
  const moveSigns=[];
  for(let i=1;i<closes.length;i++){
    const diff=closes[i]-closes[i-1];if(diff!==0)moveSigns.push(diff>0?1:-1);
  }
  const priceReversals=flipCount(moveSigns);
  const atr=N(d?.atr);
  const range=closes.length?Math.max(...closes)-Math.min(...closes):0;
  const fastWhipsaw=atr!=null&&atr>0&&range>=atr*.55&&emaFlips>=3&&priceReversals>=2;
  const noisyWhipsaw=emaFlips>=4&&priceReversals>=3;
  const danger=a3.sideways||hardChop||explicitSideways||softChop&&fastWhipsaw||fastWhipsaw||noisyWhipsaw;

  let dangerStreak=g.dangerStreak||0,cleanStreak=g.cleanStreak||0,active=!!g.active;
  if(danger){dangerStreak++;cleanStreak=0;}else{cleanStreak++;dangerStreak=0;}

  if(!active&&(a3.sideways||hardChop||explicitSideways||dangerStreak>=SIDEWAYS_TRIGGER_STREAK))active=true;
  if(active&&cleanStreak>=SIDEWAYS_CLEAR_STREAK)active=false;

  let reason='Market clear';
  if(active){
    if(a3.sideways)reason='Analysis 3m SIDEWAYS — semua signal baru dipause.';
    else if(hardChop)reason=`Chop tinggi ${chop.toFixed(1)}% — market terlalu serabut.`;
    else if(explicitSideways)reason='Structure SIDEWAYS/RANGE — signal baru dipause.';
    else if(fastWhipsaw)reason=`Price whipsaw laju — EMA9 flip ${emaFlips}x, arah price bertukar ${priceReversals}x.`;
    else reason='Market ulang-alik terlalu kerap — tunggu clear.';
  }

  g={active,dangerStreak,cleanStreak,lastKey:key,reason,activatedAt:active?(g.activatedAt||now):0,chop,emaFlips,priceReversals,range,atr,fastWhipsaw,explicitSideways};
  sidewaysGuardBySymbol.set(symbol,g);return g;
}


function emaLast(values,len){
  const xs=values.filter(v=>Number.isFinite(v));if(!xs.length)return null;
  const k=2/(len+1);let e=xs[0];for(let i=1;i<xs.length;i++)e=xs[i]*k+e*(1-k);return e;
}
function hemaLast(values,len){
  if(!values.length)return null;
  const half=Math.max(1,Math.round(len/2)),root=Math.max(1,Math.round(Math.sqrt(len)));
  const emaSeries=(xs,n)=>{const k=2/(n+1);let e=xs[0];return xs.map((v,i)=>{e=i===0?v:v*k+e*(1-k);return e})};
  const a=emaSeries(values,half),b=emaSeries(values,len),diff=a.map((v,i)=>2*v-b[i]);
  return emaLast(diff,root);
}
function rsiLast(values,len=14){
  if(values.length<2)return null;let gain=0,loss=0,n=Math.min(len,values.length-1);
  for(let i=values.length-n;i<values.length;i++){const d=values[i]-values[i-1];if(d>0)gain+=d;else loss-=d;}
  if(!n)return null;const ag=gain/n,al=loss/n;if(al===0)return 100;const rs=ag/al;return 100-(100/(1+rs));
}
function trValue(b,prevClose){return Math.max(b.high-b.low,Math.abs(b.high-prevClose),Math.abs(b.low-prevClose));}
function atrBars(bars,len=14){
  if(bars.length<2)return null;const start=Math.max(1,bars.length-len);let sum=0,n=0;
  for(let i=start;i<bars.length;i++){sum+=trValue(bars[i],bars[i-1].close);n++}return n?sum/n:null;
}
function chopBars(bars,len=14){
  if(bars.length<3)return null;const xs=bars.slice(-Math.min(len,bars.length));if(xs.length<3)return null;
  let sum=0;for(let i=1;i<xs.length;i++)sum+=trValue(xs[i],xs[i-1].close);
  const hi=Math.max(...xs.map(x=>x.high)),lo=Math.min(...xs.map(x=>x.low)),span=hi-lo;
  if(!span||sum<=0)return null;return 100*(Math.log10(sum/span)/Math.log10(xs.length));
}
function threeMinuteBars(symbol,d){
  const arr=(historyBySymbol.get(symbol)||[]).filter(x=>N(x?.time)!=null).sort((a,b)=>N(a.time)-N(b.time));
  if(!arr.length)return[];
  const map=new Map();
  for(const x of arr){
    const t=N(x.time),bucket=Math.floor(t/180000)*180000;
    let b=map.get(bucket);
    const o=N(x.open),h=N(x.high),l=N(x.low),c=N(x.close),vol=N(x.volume)||0;
    if([o,h,l,c].some(v=>v==null))continue;
    if(!b)b={time:bucket,open:o,high:h,low:l,close:c,volume:vol,lastTime:t,count:1};
    else{b.high=Math.max(b.high,h);b.low=Math.min(b.low,l);b.close=c;b.volume+=vol;b.lastTime=t;b.count++}
    map.set(bucket,b);
  }
  const currentBucket=N(d?.time)!=null?Math.floor(N(d.time)/180000)*180000:null;
  return [...map.values()].sort((a,b)=>a.time-b.time).filter(b=>currentBucket==null||b.time<currentBucket).slice(-120);
}
function fallback3mHemaFromSop(d){
  if(typeof d?.sop5!=='boolean')return'WAIT';
  let base=d?.tradeActive===true?(d?.tradeIsBuy===true?'BUY':d?.tradeIsBuy===false?'SELL':'WAIT'):dirText(d?.hemaTrend);
  if(base==='WAIT')return'WAIT';
  return d.sop5?base:(base==='BUY'?'SELL':'BUY');
}
function analysis3m(symbol,d){
  const bars=threeMinuteBars(symbol,d),closes=bars.map(b=>b.close),last=bars[bars.length-1],prev=bars[bars.length-2];
  const fallback=fallback3mHemaFromSop(d);
  if(!last){
    return{tf:'3m',bias:fallback,confidence:fallback==='WAIT'?0:58,status:'WARMING',sideways:false,reason:fallback==='WAIT'?'Tunggu 3m pertama complete':'Guna HEMA 3m Pine sementara history warm-up',bars:0,chop:null};
  }
  const e9=emaLast(closes,9),e20=emaLast(closes,20),e50=emaLast(closes,50),h20=hemaLast(closes,20),h40=hemaLast(closes,40),rsi=rsiLast(closes,14),atr=atrBars(bars,14),chop=chopBars(bars,14);
  let buy=0,sell=0,reasons=[];
  if(h20!=null&&h40!=null){if(h20>h40){buy+=3;reasons.push('HEMA 3m bull')}else if(h20<h40){sell+=3;reasons.push('HEMA 3m bear')}}
  if(e9!=null&&e20!=null){if(e9>e20)buy+=2;else if(e9<e20)sell+=2}
  if(e20!=null&&e50!=null){if(e20>e50)buy+=2;else if(e20<e50)sell+=2}
  if(last&&e20!=null){if(last.close>e20)buy+=1;else if(last.close<e20)sell+=1}
  if(rsi!=null){if(rsi>=54)buy+=1;else if(rsi<=46)sell+=1}
  if(prev){if(last.close>prev.close)buy+=1;else if(last.close<prev.close)sell+=1}
  if(fallback==='BUY')buy+=2;else if(fallback==='SELL')sell+=2;
  const diff=buy-sell,total=buy+sell||1;
  const sideways=(chop!=null&&chop>=61.8)||Math.abs(diff)<=1;
  let bias=sideways?'WAIT':diff>=2?'BUY':diff<=-2?'SELL':'WAIT';
  let confidence=Math.round(clamp(50+Math.abs(diff)*5+(Math.max(buy,sell)/total-.5)*25-(sideways?18:0)));
  const mature=bars.length>=20,status=sideways?'SIDEWAYS':mature?'CONFIRMED':'WARMING';
  if(!mature&&bias==='WAIT'&&fallback!=='WAIT'){bias=fallback;confidence=Math.max(confidence,58)}
  return{tf:'3m',bias,confidence,status,sideways,reason:sideways?'3m tengah sideways/chop':bias==='BUY'?'3m trend lebih cenderung BUY':bias==='SELL'?'3m trend lebih cenderung SELL':'3m belum clear',bars:bars.length,chop,ema9:e9,ema20:e20,ema50:e50,hema20:h20,hema40:h40,rsi,atr,lastBarTime:last.time,reasons};
}
function pipSizeFor(symbol){if(symbol==='XAUUSD'||symbol==='XAGUSD')return .01;if(/JPY$/.test(symbol))return .01;return .0001;}
function fastTrade1m(symbol,d,a3){
  const pip=pipSizeFor(symbol),targetPips=20,targetDistance=pip*targetPips,c=N(d?.close),atr=N(d?.atr),ch=N(d?.chopIndex);
  const side=a3?.bias||'WAIT';
  if(!d||c==null)return{tf:'1m',state:'WAIT',side:'WAIT',score:0,targetPips,targetPrice:null,reason:'Tiada data 1m'};
  if(String(d.timeframe||'1')!=='1')return{tf:'1m',state:'WAIT',side:'WAIT',score:0,targetPips,targetPrice:null,reason:'Fast Trade perlukan feed 1 min'};
  if(a3?.status==='WARMING'&&(N(a3?.bars)||0)<2)return{tf:'1m',state:'PAUSE',side:'WAIT',score:0,targetPips,targetPrice:null,reason:'3m tengah warm-up — tunggu sekurang-kurangnya 2 candle 3m complete'};
  if(a3?.sideways||side==='WAIT')return{tf:'1m',state:'PAUSE',side:'WAIT',score:0,targetPips,targetPrice:null,reason:'3m tak clear / sideways — fast trade pause'};
  const sg=sidewaysGuardBySymbol.get(symbol);if(sg?.active)return{tf:'1m',state:'PAUSE',side:'WAIT',score:0,targetPips,targetPrice:null,reason:'1m whipsaw — fast trade pause'};
  let score=0,checks=[];
  const hema=dirText(d?.hemaTrend),mom=dirText(d?.momentum),ms=dirText(d?.marketStructure);
  const e9=N(d?.ema9),e20=N(d?.ema20),rsi=N(d?.rsi),rvol=N(d?.relativeVolume),mtf=mtfTotalOf(d);
  const aligned=(cond,label,pts)=>{if(cond){score+=pts;checks.push(label)}};
  aligned(hema===side,'HEMA 1m',15);aligned(mom===side,'Momentum 1m',15);aligned(ms===side,'Structure 1m',10);
  aligned(e9!=null&&e20!=null&&(side==='BUY'?e9>e20:e9<e20),'EMA 1m',15);
  aligned(rsi!=null&&(side==='BUY'?rsi>=52&&rsi<=74:rsi<=48&&rsi>=26),'RSI okay',10);
  aligned(side==='BUY'?mtf>=1:mtf<=-1,'MTF support',10);
  aligned(rvol==null||rvol>=.8,'Volume okay',8);
  if(atr!=null&&atr>0&&e9!=null){const dist=Math.abs(c-e9);aligned(dist<=atr*.35,'Price dekat trigger',12);aligned(atr>=targetDistance*.65,'Volatility cukup',5)}
  const opp=opportunityBySymbol.get(symbol);
  const trigger=(exactAction(d?.action)===side)||(opp&&opp.side===side&&opp.type!=='NONE'&&opp.risk!=='NO_ADD');
  const notChop=ch==null||ch<58;
  const scoreFinal=Math.round(clamp(score));
  let state='WAIT',reason='1m belum cukup confirm';
  if(scoreFinal>=75&&trigger&&notChop){state='READY';reason=`FAST ${side} ready — 3m sehala + trigger 1m confirm`;}
  else if(scoreFinal>=65&&notChop){state='WATCH';reason=`Bias 3m ${side}, tunggu trigger 1m yang lebih cun`;}
  else if(!notChop){state='PAUSE';reason='1m chop tinggi — jangan paksa fast trade';}
  const targetPrice=state==='READY'?(side==='BUY'?c+targetDistance:c-targetDistance):null;
  return{tf:'1m',state,side:state==='PAUSE'?'WAIT':side,score:scoreFinal,targetPips,pipSize:pip,targetDistance,targetPrice,entryPrice:c,reason,checks,analysisBias3m:side};
}


function aggregateClosedBars(symbol,d,minutes){
  const ms=minutes*60000,arr=(historyBySymbol.get(symbol)||[]).filter(x=>N(x?.time)!=null).sort((a,b)=>N(a.time)-N(b.time)),map=new Map();
  for(const x of arr){
    const t=N(x.time),bucket=Math.floor(t/ms)*ms,o=N(x.open),h=N(x.high),l=N(x.low),c=N(x.close),vol=N(x.volume)||0;
    if([o,h,l,c].some(v=>v==null))continue;
    let b=map.get(bucket);
    if(!b)b={time:bucket,open:o,high:h,low:l,close:c,volume:vol,lastTime:t};
    else{b.high=Math.max(b.high,h);b.low=Math.min(b.low,l);b.close=c;b.volume+=vol;b.lastTime=t}
    map.set(bucket,b);
  }
  const current=N(d?.time)!=null?Math.floor(N(d.time)/ms)*ms:null;
  return[...map.values()].sort((a,b)=>a.time-b.time).filter(b=>current==null||b.time<current).slice(-160);
}
function analyzeClosedTF(symbol,d,minutes){
  const bars=aggregateClosedBars(symbol,d,minutes),closes=bars.map(x=>x.close),last=bars[bars.length-1],prev=bars[bars.length-2];
  if(!last)return{tf:`${minutes}m`,bias:'WAIT',confidence:0,sideways:false,status:'WARMING',bars:0,reason:`Tunggu candle ${minutes}m complete`,atr:null,chop:null};
  const e9=emaLast(closes,9),e20=emaLast(closes,20),e50=emaLast(closes,50),h20=hemaLast(closes,20),h40=hemaLast(closes,40),rsi=rsiLast(closes,14),atr=atrBars(bars,14),chop=chopBars(bars,14);
  let buy=0,sell=0,checks=[];
  const vote=(condB,condS,w,label)=>{if(condB){buy+=w;checks.push(label+' BUY')}else if(condS){sell+=w;checks.push(label+' SELL')}};
  vote(h20!=null&&h40!=null&&h20>h40,h20!=null&&h40!=null&&h20<h40,24,'HEMA');
  vote(e9!=null&&e20!=null&&e9>e20,e9!=null&&e20!=null&&e9<e20,18,'EMA9/20');
  vote(e20!=null&&e50!=null&&e20>e50,e20!=null&&e50!=null&&e20<e50,14,'EMA20/50');
  vote(e20!=null&&last.close>e20,e20!=null&&last.close<e20,12,'Price/EMA20');
  vote(rsi!=null&&rsi>=54,rsi!=null&&rsi<=46,10,'RSI');
  vote(prev&&last.close>prev.close,prev&&last.close<prev.close,8,'Close slope');
  const max=Math.max(buy,sell),gap=Math.abs(buy-sell),leader=buy>sell?'BUY':sell>buy?'SELL':'WAIT';
  const sideways=(chop!=null&&chop>=61.8)||gap<18;
  const bias=sideways?'WAIT':max>=55?leader:'WAIT';
  const confidence=Math.round(clamp(max-(sideways?15:0)));
  const minBars=minutes===5?3:minutes===3?4:3;
  const status=bars.length<minBars?'WARMING':sideways?'SIDEWAYS':bias==='WAIT'?'WAIT':'CONFIRMED';
  const lows=bars.slice(-5).map(x=>x.low),highs=bars.slice(-5).map(x=>x.high);
  return{tf:`${minutes}m`,bias,confidence,sideways,status,bars:bars.length,reason:sideways?`${minutes}m sideways/chop`:bias==='WAIT'?`${minutes}m belum cukup solid`:`${minutes}m ${bias} clear`,atr,chop,ema9:e9,ema20:e20,ema50:e50,hema20:h20,hema40:h40,rsi,lastClose:last.close,swingLow:lows.length?Math.min(...lows):null,swingHigh:highs.length?Math.max(...highs):null,checks};
}
function oneMinuteAnalysis(symbol,d){
  const chop=N(d?.chopIndex),structure=U(d?.marketStructure),arr=(historyBySymbol.get(symbol)||[]).slice(-8);
  const emaSides=arr.map(x=>{const c=N(x?.close),e=N(x?.ema9);return c==null||e==null||c===e?0:c>e?1:-1});
  const closes=arr.map(x=>N(x?.close)).filter(v=>v!=null),signs=[];
  for(let i=1;i<closes.length;i++){const z=closes[i]-closes[i-1];if(z)signs.push(z>0?1:-1)}
  const whipsaw=flipCount(emaSides)>=3&&flipCount(signs)>=3;
  const sideways=(chop!=null&&chop>=61.8)||/SIDEWAY|CHOP|RANGE|FLAT/.test(structure)||whipsaw;
  let buy=0,sell=0,checks=[];
  const vote=(b,se,w,label)=>{if(b){buy+=w;checks.push(label+' BUY')}else if(se){sell+=w;checks.push(label+' SELL')}};
  const hema=dirText(d?.hemaTrend),mom=dirText(d?.momentum),ms=dirText(d?.marketStructure),forecast=rawForecastDir(d);
  const c=N(d?.close),o=N(d?.open),e9=N(d?.ema9),e20=N(d?.ema20),e50=N(d?.ema50),rsi=N(d?.rsi),w1=N(d?.waveTrend1),w2=N(d?.waveTrend2),rvol=N(d?.relativeVolume),atr=N(d?.atr);
  vote(hema==='BUY',hema==='SELL',20,'HEMA');
  vote(mom==='BUY',mom==='SELL',18,'Momentum');
  vote(ms==='BUY',ms==='SELL',14,'Structure');
  vote([c,e9,e20,e50].every(v=>v!=null)&&c>e9&&e9>e20&&e20>e50,[c,e9,e20,e50].every(v=>v!=null)&&c<e9&&e9<e20&&e20<e50,20,'EMA stack');
  vote(w1!=null&&w2!=null&&w1>w2,w1!=null&&w2!=null&&w1<w2,10,'WaveTrend');
  vote(rsi!=null&&rsi>=54&&rsi<=76,rsi!=null&&rsi<=46&&rsi>=24,8,'RSI');
  vote(forecast==='BUY',forecast==='SELL',6,'Forecast');
  vote(c!=null&&o!=null&&c>o,c!=null&&o!=null&&c<o,4,'Candle');
  const max=Math.max(buy,sell),gap=Math.abs(buy-sell),leader=buy>sell?'BUY':sell>buy?'SELL':'WAIT';
  const bias=sideways?'WAIT':max>=66&&gap>=18?leader:'WAIT';
  const confidence=Math.round(clamp(max-(sideways?18:0)));
  return{tf:'1m',bias,confidence,sideways,status:sideways?'SIDEWAYS':bias==='WAIT'?'WAIT':'CONFIRMED',reason:sideways?'1m choppy/sideways':bias==='WAIT'?'1m belum clear':`1m ${bias} clear`,chop,whipsaw,checks,close:c,open:o,ema9:e9,ema20:e20,ema50:e50,rsi,waveTrend1:w1,waveTrend2:w2,rvol,atr};
}
function strategyStreak(map,symbol,key,side,valid){
  let st=map.get(symbol)||{lastKey:'',candidate:'WAIT',streak:0,plan:null,lockedUntil:0};
  if(st.lastKey!==key){
    if(valid&&side!=='WAIT'){if(st.candidate===side)st.streak++;else{st.candidate=side;st.streak=1}}
    else{st.candidate='WAIT';st.streak=0;st.plan=null;st.lockedUntil=0}
    st.lastKey=key;map.set(symbol,st);
  }
  return st;
}
function makePlan(side,entry,sl,tp1,tp2,tp3,meta={}){
  return{side,entry,sl,tp1,tp2,tp3,...meta};
}
function fastTradeStrategy(symbol,d){
  const life=signalCoreBySymbol.get(symbol);
  if(life?.stage==='COOLDOWN')return{mode:'FAST',tf:'1m',state:'COOLDOWN',side:'WAIT',score:0,reason:life.reason||'Trade selesai — tunggu setup baru',analysis1m:null,plan:null,targetRange:'20–30 pips'};
  const a1=oneMinuteAnalysis(symbol,d),key=snapshotKey(d),pip=pipSizeFor(symbol),c=N(d?.close),atr=N(d?.atr),e9=N(d?.ema9),e20=N(d?.ema20),w1=N(d?.waveTrend1),w2=N(d?.waveTrend2);
  const st=strategyStreak(fastStrategyBySymbol,symbol,key,a1.bias,a1.bias!=='WAIT'&&!a1.sideways&&a1.confidence>=78);
  if(a1.sideways)return{mode:'FAST',tf:'1m',state:'PAUSE',side:'WAIT',score:a1.confidence,reason:'1m sideways/whipsaw — fast trade stop',analysis1m:a1,plan:null,targetRange:'20–30 pips'};
  if(a1.bias==='WAIT')return{mode:'FAST',tf:'1m',state:'WAIT',side:'WAIT',score:a1.confidence,reason:'1m belum ada arah yang cukup kuat',analysis1m:a1,plan:null,targetRange:'20–30 pips'};
  const side=a1.bias;
  const candleOkay=c!=null&&N(d?.open)!=null&&(side==='BUY'?c>N(d.open):c<N(d.open));
  const emaOkay=e9!=null&&e20!=null&&(side==='BUY'?e9>e20:e9<e20);
  const wtOkay=w1!=null&&w2!=null&&(side==='BUY'?w1>w2:w1<w2);
  const nearTrigger=atr!=null&&atr>0&&e9!=null&&Math.abs(c-e9)<=atr*.45;
  const exact=exactAction(d?.action)===side;
  const trigger=(exact||(candleOkay&&emaOkay&&wtOkay&&nearTrigger));
  let state=a1.confidence>=74?'WATCH':'WAIT',reason=`1m ${side} ada, tunggu trigger lebih kemas`;
  if(a1.confidence>=84&&st.streak>=2&&trigger){state='READY';reason=`FAST ${side} READY — 1m analysis + trigger confirm`;}
  const atrPips=atr!=null?atr/pip:20;
  const slPips=Math.round(clamp(atrPips*.18,10,18));
  const targetPips=a1.confidence>=92&&atrPips>=28?30:a1.confidence>=87?25:20;
  let plan=null;
  if(state==='READY'&&c!=null){
    const sl=side==='BUY'?c-slPips*pip:c+slPips*pip,tp1=side==='BUY'?c+20*pip:c-20*pip,tp2=side==='BUY'?c+30*pip:c-30*pip;
    plan=makePlan(side,c,sl,tp1,tp2,null,{recommendedPips:targetPips,slPips,targetRange:'20–30 pips',planType:'FAST 1M'});
  }
  return{mode:'FAST',tf:'1m',state,side,score:a1.confidence,streak:st.streak,reason,analysis1m:a1,plan,targetRange:'20–30 pips'};
}
function normalScalpStrategy(symbol,d){
  const life=signalCoreBySymbol.get(symbol);
  if(life?.stage==='COOLDOWN')return{mode:'NORMAL',tf:'3m',state:'COOLDOWN',side:'WAIT',score:0,reason:life.reason||'Trade selesai — tunggu setup baru',confirmations:{m1:'WAIT',m3:'WAIT',m5:'WAIT'},sop:null,solid:false,plan:null};

  const hasPineSop=d?.normalSopVersion==='32.0' || d?.normalSopVersion===32 || d?.normalSopVersion==='V32';
  if(!hasPineSop){
    return{
      mode:'NORMAL',tf:'3m',state:'WARMING',side:'WAIT',score:0,
      reason:'UPDATE FEED REQUIRED — Normal SOP perlukan data Pine V32 untuk Solid Entry + current 5m HEMA ribbon.',
      confirmations:{m1:'WAIT',m3:'WAIT',m5:'WAIT'},
      sop:{feedReady:false,passed:0,total:5},
      solid:false,plan:null
    };
  }

  const side=U(d?.normal3Side||'WAIT');
  const entry=N(d?.normal3Entry),close3=N(d?.normal3Close),atr3=N(d?.normal3Atr);
  const solid=d?.normal3Solid===true;
  const pricePast=d?.normal3PricePastEntry===true;
  const sopFlags=[d?.normal3Sop1,d?.normal3Sop2,d?.normal3Sop3,d?.normal3Sop4,d?.normal3Sop5].map(v=>v===true);
  const sopGreen=sopFlags.filter(Boolean).length;
  const forecast=U(d?.normal3Forecast||'WAIT').replace(/[^A-Z]/g,'');
  const power=N(d?.normal3MarketPower);
  const forecastPass=power!=null&&(
    side==='BUY'?((forecast==='BULLISH'||forecast==='NEUTRAL')&&power>50):
    side==='SELL'?((forecast==='BEARISH'&&power>50)||(forecast==='NEUTRAL'&&power<50)):false
  );
  const m5pos=U(d?.normal5Position||'WAIT');
  const m5Pass=side==='BUY'?m5pos==='ABOVE':side==='SELL'?m5pos==='BELOW':false;
  const allReady=(side==='BUY'||side==='SELL')&&solid&&pricePast&&sopGreen>=4&&forecastPass&&m5Pass;

  const gates=[
    {key:'solid',label:'Solid Entry Signal',pass:solid},
    {key:'entry',label:'Price Lepas Entry Line',pass:pricePast},
    {key:'sop',label:'SOP Checklist ≥4 Green',pass:sopGreen>=4,detail:`${sopGreen}/5`},
    {key:'forecast',label:'10-Candle Forecast >50%',pass:forecastPass,detail:`${forecast} ${power==null?'—':power+'%'}`},
    {key:'m5',label:'Current 5m vs HEMA Ribbon',pass:m5Pass,detail:m5pos}
  ];
  const passed=gates.filter(g=>g.pass).length;
  const score=Math.round(passed/gates.length*100);

  let state='WAIT',reason='Normal 3m belum ada setup yang lengkap.';
  if(side==='BUY'||side==='SELL'){
    state=passed>=3?'WATCH':'WAIT';
    const failed=gates.filter(g=>!g.pass).map(g=>g.label);
    reason=allReady?`SOLID ${side} ENTRY — semua SOP Normal lulus.`:`${side} setup belum lengkap — tunggu: ${failed.join(' • ')}`;
  }
  if(allReady)state='READY';

  let plan=null;
  if(allReady&&entry!=null&&atr3!=null&&atr3>0){
    const riskDist=atr3;
    const sl=side==='BUY'?entry-riskDist:entry+riskDist;
    const tp1=side==='BUY'?entry+riskDist:entry-riskDist;
    const tp2=side==='BUY'?entry+riskDist*2:entry-riskDist*2;
    const tp3=side==='BUY'?entry+riskDist*3:entry-riskDist*3;
    plan=makePlan(side,entry,sl,tp1,tp2,tp3,{
      riskDistance:riskDist,rr1:1,rr2:2,rr3:3,
      condition:'PINE SOP NORMAL',planType:'NORMAL SCALPING 3M — PINE SOP V32'
    });
  }

  return{
    mode:'NORMAL',tf:'3m',state,side,score,reason,solid,plan,
    confirmations:{m1:'N/A',m3:allReady?'PASS':'WAIT',m5:m5Pass?'PASS':'WAIT'},
    sop:{
      feedReady:true,passed,total:gates.length,gates,
      solid,pricePastEntry:pricePast,sopGreen,
      sop1:sopFlags[0],sop2:sopFlags[1],sop3:sopFlags[2],sop4:sopFlags[3],sop5:sopFlags[4],
      forecast,marketPower:power,forecastPass,
      m5Position:m5pos,m5Close:N(d?.normal5Close),m5Hema20:N(d?.normal5Hema20),m5Hema40:N(d?.normal5Hema40),m5Pass,
      entry,close3,atr3
    }
  };
}

function validationKey(symbol,mode){return symbol+'|'+mode;}
function signalId(symbol,mode,strat,d){
  const t=N(d?.time)||N(d?.barIndex)||Date.now();
  const side=U(strat?.side||'WAIT'),entry=N(strat?.plan?.entry);
  return [symbol,mode,side,entry,t].join('|');
}
function validationSnapshot(symbol,mode,strat,d){
  if(!strat||U(strat.state)!=='READY'||!strat.plan)return;
  const key=validationKey(symbol,mode),id=signalId(symbol,mode,strat,d);
  if(validationSeen.has(id)||validationOpenByKey.has(key))return;
  const p=strat.plan,entry=N(p.entry),sl=N(p.sl),tp1=N(p.tp1),tp2=N(p.tp2),tp3=N(p.tp3);
  if(entry==null||sl==null||tp1==null)return;
  const rec={
    id,symbol,mode,side:U(strat.side),state:'OPEN',
    openedAt:Date.now(),openedTime:N(d?.time),openedBar:N(d?.barIndex),
    openedKey:snapshotKey(d),entry,sl,tp1,tp2,tp3,
    score:N(strat.score)||0,reason:strat.reason||'',
    confirmations:strat.confirmations||null,
    condition:p.condition||null,
    targetRange:p.targetRange||strat.targetRange||null,
    slPips:N(p.slPips),recommendedPips:N(p.recommendedPips),
    hitTp1:false,hitTp2:false,hitTp3:false,
    outcome:null,resolvedAt:null,resolvedTime:null,resolvedBar:null
  };
  validationSeen.add(id);validationOpenByKey.set(key,rec);
}
function hitLevel(side,kind,level,hi,lo){
  if(level==null||hi==null||lo==null)return false;
  if(kind==='TP')return side==='BUY'?hi>=level:lo<=level;
  return side==='BUY'?lo<=level:hi>=level;
}
function resolveValidation(symbol,d){
  const hi=N(d?.high),lo=N(d?.low),keyNow=snapshotKey(d);
  if(hi==null||lo==null)return;
  for(const mode of ['FAST','NORMAL']){
    const key=validationKey(symbol,mode),r=validationOpenByKey.get(key);
    if(!r||r.openedKey===keyNow)continue;
    const t1=hitLevel(r.side,'TP',r.tp1,hi,lo);
    const t2=hitLevel(r.side,'TP',r.tp2,hi,lo);
    const t3=hitLevel(r.side,'TP',r.tp3,hi,lo);
    const hadTp1=r.hitTp1,hadTp2=r.hitTp2,hadTp3=r.hitTp3;
    const activeSlBefore=mode==='NORMAL'?(hadTp3?r.tp2:hadTp2?r.tp1:hadTp1?r.entry:r.sl):r.sl;
    const slHit=hitLevel(r.side,'SL',activeSlBefore,hi,lo);
    const newTargetHit=(t1&&!hadTp1)||(t2&&!hadTp2)||(t3&&!hadTp3);
    if(t1)r.hitTp1=true;if(t2)r.hitTp2=true;if(t3)r.hitTp3=true;
    r.activeSl=mode==='NORMAL'?(r.hitTp3?r.tp2:r.hitTp2?r.tp1:r.hitTp1?r.entry:r.sl):r.sl;
    r.slLockStage=mode==='NORMAL'?(r.hitTp3?3:r.hitTp2?2:r.hitTp1?1:0):0;

    let done=false,outcome=null;
    const maxAge=mode==='FAST'?20*60*1000:90*60*1000;
    const timedOut=Date.now()-r.openedAt>=maxAge;
    const pineExit=U(d?.positionExitAction);

    if(slHit&&newTargetHit){done=true;outcome='AMBIGUOUS';}
    else if(slHit){
      done=true;
      outcome=mode==='NORMAL'?(hadTp3?'TP3_PROTECTED':hadTp2?'TP2_PROTECTED':hadTp1?'PROTECTED_WIN':'SL'):(hadTp1?'PROTECTED_WIN':'SL');
    }
    else if(mode==='FAST'&&t2){done=true;outcome='TP30';}
    else if(mode==='NORMAL'&&['EXIT_REMAINING','EXIT_ALL'].includes(pineExit)){
      done=true;
      outcome=r.hitTp3?'TP3_MANAGED':r.hitTp2?'TP2_MANAGED':r.hitTp1?'TP1_MANAGED':'MANAGED_EXIT';
    }
    else if(timedOut){
      done=true;
      if(mode==='FAST')outcome=r.hitTp1?'TP20':'TIMEOUT';
      else outcome=r.hitTp3?'TP3':r.hitTp2?'TP2':r.hitTp1?'TP1':'TIMEOUT';
    }

    if(done){
      r.state='CLOSED';r.outcome=outcome;r.resolvedAt=Date.now();r.resolvedTime=N(d?.time);r.resolvedBar=N(d?.barIndex);
      validationClosed.push({...r});if(validationClosed.length>1000)validationClosed.splice(0,validationClosed.length-1000);
      validationOpenByKey.delete(key);
    }
  }
}
function validationSummary(symbol,mode){
  const rows=validationClosed.filter(r=>(!symbol||r.symbol===symbol)&&(!mode||r.mode===mode));
  const resolved=rows.filter(r=>r.outcome!=='AMBIGUOUS');
  const wins=resolved.filter(r=>['TP20','TP30','TP1','TP2','TP3','PROTECTED_WIN','TP2_PROTECTED','TP3_PROTECTED','TP1_MANAGED','TP2_MANAGED','TP3_MANAGED'].includes(r.outcome)).length;
  const losses=resolved.filter(r=>r.outcome==='SL').length;
  const ambiguous=rows.filter(r=>r.outcome==='AMBIGUOUS').length;
  const winRate=resolved.length?Math.round(wins/resolved.length*1000)/10:null;
  const byOutcome={};
  rows.forEach(r=>byOutcome[r.outcome]=(byOutcome[r.outcome]||0)+1);
  return{
    sample:rows.length,resolved:resolved.length,wins,losses,ambiguous,winRate,
    maturity:resolved.length<20?'EARLY':resolved.length<50?'BUILDING':resolved.length<100?'MINIMUM SAMPLE':'MATURE',
    byOutcome,
    recent:rows.slice(-20).reverse(),
    open:[...validationOpenByKey.values()].filter(r=>(!symbol||r.symbol===symbol)&&(!mode||r.mode===mode))
  };
}
function updateValidation(symbol,d){
  resolveValidation(symbol,d);
  const f=fastTradeStrategy(symbol,d),n=normalScalpStrategy(symbol,d);
  validationSnapshot(symbol,'FAST',f,d);
  validationSnapshot(symbol,'NORMAL',n,d);
}

function marketSummary(symbol){
  const d=latestBySymbol.get(symbol);
  if(!d)return{symbol,online:false,freshness:'OFFLINE',status:'OFFLINE',signal:'WAIT',signalState:'WAIT',signalLocked:false,strategyFast:{mode:'FAST',state:'WAIT',side:'WAIT',score:0,reason:'Tiada data',plan:null},strategyNormal:{mode:'NORMAL',state:'WAIT',side:'WAIT',score:0,reason:'Tiada data',plan:null},sidewaysGuard:false,sidewaysReason:'Tiada data',sidewaysChop:null,sidewaysEmaFlips:0,sidewaysPriceReversals:0,opportunityType:'NONE',opportunitySide:'WAIT',opportunityStrength:'NONE',opportunityReason:'Tiada data',opportunityRisk:'WAIT',prediction:'WAIT',rawPrediction:'WAIT',predictionConfidence:0,signalConfidence:0,predictionConsensus:0,predictionHorizon:'NEXT 1–3 BARS',currentAction:'WAIT',grade:'—',stability:0,readiness:0,radarScore:0,zone:'NO DATA',rr:null,price:null,timeframe:'—',receivedAt:null,tradeActive:false,reasons:[]};
  const p=predictionEngine(d,symbol),z=zoneInfo(d),st=predictionStability(symbol),rd=predictionReadiness(d,symbol,p),a3=analysis3m(symbol,d),sg=sidewaysGuard(symbol,d),fast=fastTrade1m(symbol,d,a3);
  const core=signalCoreBySymbol.get(symbol)||updateSignalCore(symbol,d),opp=opportunityBySymbol.get(symbol)||updateOpportunity(symbol,d);
  const strategyFast=fastTradeStrategy(symbol,d),strategyNormal=normalScalpStrategy(symbol,d);
  const signal=core.side||'WAIT',signalConf=signalConfidenceForSide(p,signal);
  return{symbol,online:true,freshness:freshness(d.receivedAt),status:predictionStatus(d,symbol,p),strategyFast,strategyNormal,analysis3m:a3,fastTrade1m:fast,sidewaysGuard:!!sg.active,sidewaysReason:sg.reason,sidewaysChop:sg.chop,sidewaysEmaFlips:sg.emaFlips,sidewaysPriceReversals:sg.priceReversals,signal,signalState:core.stage,signalLocked:!!core.locked,signalReason:core.reason,signalWarnings:core.warnings||[],opportunityType:opp.type,opportunitySide:opp.side,opportunityStrength:opp.strength,opportunityReason:opp.reason,opportunityRisk:opp.risk,opportunityPrice:opp.price||null,opportunityTriggeredAt:opp.triggeredAt||0,signalInvalidStreak:core.invalidStreak||0,signalLockedAt:core.lockedAt||0,signalCooldownUntil:core.cooldownUntil||0,signalConfidence:signalConf,prediction:sg.active?'WAIT':p.direction,underlyingPrediction:p.direction,rawPrediction:sg.active?'WAIT':p.direction,predictionConfidence:sg.active?0:p.confidence,predictionConsensus:p.consensus,predictionEvidence:p.totalEvidence,predictionAgreement:p.agreement,predictionStrength:p.strength,predictionHorizon:p.horizon,predictionConflict:p.conflict,reasons:p.reasons,currentAction:p.currentAction,grade:predictionGrade(p),stability:st,readiness:rd,radarScore:predictionRadarScore(d,symbol,p),zone:z.state,rr:rr(d),price:N(d.close),timeframe:String(d.timeframe||'—'),receivedAt:N(d.receivedAt),tradeActive:d.tradeActive===true&&!d.slHit,setupProbability:N(d.setupProbability),confluence:N(d.confluenceStars),feedMode:d.confirmed===false?'INTRABAR':'BAR-CLOSE',positionManagement:{stage:U(d.positionExitStage||'IDLE'),action:U(d.positionExitAction||'IDLE'),partialArmed:d.exitPartialArmed===true,oppositeYellow:d.exitOppositeYellow===true,remainingPct:N(d.exitRemainingPct),yellowType:U(d.exitYellowType||'NONE'),reason:String(d.exitReason||''),initialSl:N(d.initialSl??d.sl),activeSl:N(d.activeSl??d.sl),slLockStage:N(d.slLockStage)||0,slLockLabel:U(d.slLockLabel||'INITIAL'),slMoveAction:U(d.slMoveAction||'NONE'),slMoveTriggered:d.slMoveTriggered===true,exitCloseType:U(d.exitCloseType||'NONE')}};
}
function priority(m){return m.status==='TRADE ACTIVE'?700:m.status==='HOT PREDICTION'?600:m.status==='PREDICTION READY'?500:m.status==='WATCH'?400:m.status==='NEAR ENTRY'?300:m.status==='WAIT'?200:m.status==='STALE'?80:0;}
function marketsPayload(){
  const symbols=[...new Set([...DEFAULT_MARKETS,...latestBySymbol.keys()])];
  const markets=symbols.map(marketSummary).sort((a,b)=>(priority(b)+b.radarScore)-(priority(a)+a.radarScore));
  const count=s=>markets.filter(m=>m.status===s).length; const live=markets.filter(m=>m.freshness==='LIVE').length;
  const best=markets.filter(m=>m.freshness==='LIVE'&&m.prediction!=='WAIT').sort((a,b)=>b.radarScore-a.radarScore)[0]||null;
  return{ok:true,engine:'ZenCore V32 Pine SOP Normal Entry',generatedAt:Date.now(),note:'Prediction remains forward-looking. Signal is locked separately by V26 to reduce flip-flop; scores are not guaranteed win probabilities.',summary:{markets:markets.length,live,hot:count('HOT PREDICTION'),ready:count('PREDICTION READY'),active:count('TRADE ACTIVE'),near:count('NEAR ENTRY'),watch:count('WATCH'),offline:count('OFFLINE')},best,markets};
}
function chartPayload(symbol,limit=180){
  const lim=Math.max(30,Math.min(400,Number(limit)||180));
  const arr=(historyBySymbol.get(symbol)||[]).slice(-lim);
  const points=arr.map(d=>({
    time:N(d?.time),barIndex:N(d?.barIndex),
    open:N(d?.open),high:N(d?.high),low:N(d?.low),close:N(d?.close),
    hema20:N(d?.hema20),hema40:N(d?.hema40),basis:N(d?.basis),
    entry:N(d?.normal3Entry??d?.entry),sl:N(d?.sl),tp1:N(d?.tp1),tp2:N(d?.tp2),tp3:N(d?.tp3),
    solid:d?.normal3Solid===true,
    side:U(d?.normal3Side||'WAIT'),
    sopGreen:[d?.normal3Sop1,d?.normal3Sop2,d?.normal3Sop3,d?.normal3Sop4,d?.normal3Sop5].filter(v=>v===true).length,
    forecast:U(d?.normal3Forecast||'WAIT').replace(/[^A-Z]/g,''),
    marketPower:N(d?.normal3MarketPower??d?.marketPower),
    action:U(d?.action||'WAIT')
  })).filter(p=>p.time!=null&&p.close!=null);
  return{ok:true,symbol,feed:'ZENCORE_NATIVE_CHART_V1',generatedAt:Date.now(),count:points.length,points};
}

function broadcastMarkets(){const payload=JSON.stringify(marketsPayload());for(const res of marketClients){try{res.write(`event: markets\ndata: ${payload}\n\n`)}catch(_){marketClients.delete(res)}}}
function broadcastPrediction(symbol){const set=predictionClients.get(symbol);if(!set)return;const payload=JSON.stringify(marketSummary(symbol));for(const res of set){try{res.write(`event: prediction\ndata: ${payload}\n\n`)}catch(_){set.delete(res)}}}
function expandCompactMarket(row,batch){
  if(!Array.isArray(row)||row.length<60)return null;
  const [symbol,time,barIndex,open,high,low,close,ema9,ema20,ema50,hema20,hema40,basis,waveTrend1,waveTrend2,rsi,chopIndex,relativeVolume,globalTrend,setupProbability,confluenceStars,atr,entry,initialSl,activeSl,tp1,tp2,tp3,tradeActive,tradeIsBuy,tp1Hit,tp2Hit,tp3Hit,slHit,normal3Side,normal3Solid,normal3PricePastEntry,normal3Sop1,normal3Sop2,normal3Sop3,normal3Sop4,normal3Sop5,normal3Forecast,normal3MarketPower,normal5Position,normal5Close,normal5Hema20,normal5Hema40,positionExitStage,positionExitAction,exitPartialArmed,exitOppositeYellow,exitRemainingPct,exitYellowType,exitCloseType,exitReason,slLockStage,slLockLabel,slMoveAction,slMoveTriggered,action]=row;
  return{
    schemaVersion:batch.schemaVersion||'32.3-EXIT-STEPLOCK',
    source:'ZenCore AI Dashboard Pro + Alerts',feedType:'MULTI_PAIR_BATCH',confirmed:true,
    symbol,timeframe:'3',time,barIndex,open,high,low,close,ema9,ema20,ema50,
    hemaFast:hema20,hemaSlow:hema40,hema20,hema40,basis,waveTrend1,waveTrend2,rsi,
    chopIndex,relativeVolume,globalTrend,setupProbability,confluenceStars,atr,action,
    entry,sl:initialSl,initialSl,activeSl,tp1,tp2,tp3,tradeActive,tradeIsBuy,tp1Hit,tp2Hit,tp3Hit,slHit,
    normalSopVersion:'32.0',normal3Side,normal3Solid,normal3PricePastEntry,
    normal3Sop1,normal3Sop2,normal3Sop3,normal3Sop4,normal3Sop5,
    normal3Forecast,normal3MarketPower,normal3Entry:entry,normal3Close:close,normal3Atr:atr,
    normal5Position,normal5Close,normal5Hema20,normal5Hema40,
    positionExitStage,positionExitAction,exitPartialArmed,exitOppositeYellow,exitRemainingPct,
    exitYellowType,exitCloseType,exitReason,slLockStage,slLockLabel,slMoveAction,slMoveTriggered
  };
}
function storeSnapshot(parsed){
  if(!parsed||parsed.source!=='ZenCore AI Dashboard Pro + Alerts')return null;
  const symbol=normSymbol(parsed.symbol||parsed.tickerid);
  if(!symbol||N(parsed.close)==null)return null;
  const d={...parsed,symbol,receivedAt:Date.now(),feedType:parsed.feedType||'LIVE'};
  latestBySymbol.set(symbol,d);
  const arr=historyBySymbol.get(symbol)||[];
  const key=N(d.time)||N(d.barIndex)||Date.now();
  const i=arr.findIndex(x=>(N(x.time)||N(x.barIndex))===key);
  if(i>=0)arr[i]=d;else arr.push(d);
  if(arr.length>600)arr.splice(0,arr.length-600);
  historyBySymbol.set(symbol,arr);
  updateSignalCore(symbol,d);
  updateOpportunity(symbol,d);
  updateValidation(symbol,d);
  return symbol;
}
function captureBody(body){
  let parsed=null;try{parsed=JSON.parse(body)}catch(_){}
  if(!parsed)return;
  if(parsed.source==='ZenCore Multi-Pair Feed'&&parsed.encoding==='zencore-compact-v1'&&Array.isArray(parsed.markets)){
    const touched=[];
    for(const row of parsed.markets){
      const symbol=storeSnapshot(expandCompactMarket(row,parsed));
      if(symbol&&!touched.includes(symbol))touched.push(symbol);
    }
    if(touched.length){broadcastMarkets();for(const symbol of touched)broadcastPrediction(symbol);}
    return;
  }
  const symbol=storeSnapshot(parsed);
  if(symbol){broadcastMarkets();broadcastPrediction(symbol);}
}
function send(res,code,body,type='application/json; charset=utf-8'){res.writeHead(code,{'Content-Type':type,'Cache-Control':'no-store, no-cache, must-revalidate','Pragma':'no-cache','Access-Control-Allow-Origin':'*'});res.end(body);}
function readBody(req,limit=160000){return new Promise(resolve=>{let b='';req.on('data',c=>{if(b.length<limit)b+=c});req.on('end',()=>resolve(b))})}
function proxy(req,res,body=null){
  const headers={...req.headers,host:`127.0.0.1:${V16_PORT}`}; if(body!==null)headers['content-length']=Buffer.byteLength(body);
  const p=http.request({hostname:'127.0.0.1',port:V16_PORT,path:req.url,method:req.method,headers},u=>{res.writeHead(u.statusCode||200,u.headers);u.pipe(res)});
  p.on('error',e=>send(res,503,JSON.stringify({ok:false,error:'ZenCore V16 core starting',detail:e.message}))); if(body!==null)p.end(body);else req.pipe(p);
}
function serveFile(res,file,type){try{return send(res,200,fs.readFileSync(path.join(__dirname,file)),type)}catch(e){return send(res,404,JSON.stringify({ok:false,error:'Asset not found',file}))}}
function proxyPairHtml(req,res,symbol){
  const p=http.request({hostname:'127.0.0.1',port:V16_PORT,path:req.url,method:'GET',headers:{host:`127.0.0.1:${V16_PORT}`}},u=>{
    const chunks=[];u.on('data',c=>chunks.push(c));u.on('end',()=>{let html=Buffer.concat(chunks).toString('utf8');if(!html.includes('/prediction-ui-v17.js'))html=html.replace('</body>',`<script src="/prediction-ui-v17.js?v=17.0"></script></body>`);html=html.replace(/<title>[^<]*<\/title>/i,`<title>ZenCore ${symbol} — Forward Prediction Analysis</title>`);send(res,u.statusCode||200,html,'text/html; charset=utf-8')});
  });p.on('error',e=>send(res,503,JSON.stringify({ok:false,error:'Pair page starting',detail:e.message})));p.end();
}

const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,`http://${req.headers.host||'localhost'}`),pathname=url.pathname;
  if(req.method==='OPTIONS')return send(res,204,'');
  if(req.method==='POST'&&pathname==='/webhook'){const body=await readBody(req);captureBody(body);return proxy(req,res,body);}
  if(req.method==='GET'&&(pathname==='/'||pathname==='/index.html'))return serveFile(res,'market-radar-v17.html','text/html; charset=utf-8');
  if(req.method==='GET'&&pathname==='/radar-v17.js')return serveFile(res,'radar-v17.js','application/javascript; charset=utf-8');
  if(req.method==='GET'&&pathname==='/prediction-ui-v17.js')return serveFile(res,'prediction-ui-v17.js','application/javascript; charset=utf-8');
  if(req.method==='GET'&&pathname==='/api/markets')return send(res,200,JSON.stringify(marketsPayload()));
  let cm=pathname.match(/^\/api\/chart\/([A-Za-z0-9._-]+)$/i);
  if(req.method==='GET'&&cm){
    const sym=normSymbol(cm[1]);
    const limit=Number(url.searchParams.get('limit')||180);
    return send(res,200,JSON.stringify(chartPayload(sym,limit)));
  }
  let vm=pathname.match(/^\/api\/strategy-performance\/([A-Za-z0-9._-]+)(?:\/(FAST|NORMAL))?$/i);
  if(req.method==='GET'&&vm){const sym=normSymbol(vm[1]),mode=vm[2]?U(vm[2]):null;return send(res,200,JSON.stringify({ok:true,symbol:sym,mode:mode||'ALL',generatedAt:Date.now(),summary:validationSummary(sym,mode)}));}
  if(req.method==='GET'&&pathname==='/market-events'){
    res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'keep-alive','Access-Control-Allow-Origin':'*','X-Accel-Buffering':'no'});marketClients.add(res);res.write(`event: markets\ndata: ${JSON.stringify(marketsPayload())}\n\n`);const ping=setInterval(()=>{try{res.write(': ping\n\n')}catch(_){}},20000);req.on('close',()=>{clearInterval(ping);marketClients.delete(res)});return;
  }
  let m=pathname.match(/^\/api\/prediction\/([A-Za-z0-9._-]+)$/); if(req.method==='GET'&&m){const s=normSymbol(m[1]);return send(res,200,JSON.stringify(marketSummary(s)))}
  m=pathname.match(/^\/prediction-events\/([A-Za-z0-9._-]+)$/); if(req.method==='GET'&&m){const s=normSymbol(m[1]);res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'keep-alive','Access-Control-Allow-Origin':'*','X-Accel-Buffering':'no'});if(!predictionClients.has(s))predictionClients.set(s,new Set());predictionClients.get(s).add(res);res.write(`event: prediction\ndata: ${JSON.stringify(marketSummary(s))}\n\n`);const ping=setInterval(()=>{try{res.write(': ping\n\n')}catch(_){}},20000);req.on('close',()=>{clearInterval(ping);predictionClients.get(s)?.delete(res)});return;}
  m=pathname.match(/^\/pair\/([A-Za-z0-9._-]+)\/?$/); if(req.method==='GET'&&m)return proxyPairHtml(req,res,normSymbol(m[1]));
  return proxy(req,res);
});

server.listen(PUBLIC_PORT,'0.0.0.0',()=>console.log(`ZenCore V17 Forward Prediction gateway running on port ${PUBLIC_PORT} -> V16 ${V16_PORT}`));
