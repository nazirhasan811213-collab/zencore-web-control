const http=require('http');
const fs=require('fs');
const path=require('path');

const PUBLIC_PORT=Number(process.env.PORT||8080);
const V16_PORT=PUBLIC_PORT===10001?10002:10001;
process.env.PORT=String(V16_PORT);
require('./server-v16.js');
process.env.PORT=String(PUBLIC_PORT);

const DEFAULT_MARKETS=['XAUUSD','EURUSD','GBPUSD','USDJPY','AUDUSD','NZDUSD','USDCAD','USDCHF','EURJPY','GBPJPY','EURGBP','AUDJPY'];
const latestBySymbol=new Map();
const historyBySymbol=new Map();
const marketClients=new Set();
const predictionClients=new Map();
const signalCoreBySymbol=new Map();
const opportunityBySymbol=new Map();
const sidewaysGuardBySymbol=new Map();
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
  const e=N(d?.entry),sl=N(d?.sl),tp=N(d?.tp3);
  if(e==null||sl==null||tp==null)return null;
  const r=Math.abs(e-sl); return r?Math.abs(tp-e)/r:null;
}
function freshness(ts){
  const age=Math.max(0,Date.now()-(N(ts)||0));
  return age<90000?'LIVE':age<240000?'STALE':'OFFLINE';
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
  return{direction,confidence,consensus,totalEvidence:ev.length,strength,horizon:'NEXT 1–3 BARS',reasons,conflict,bullScore:buy,bearScore:sell,agreement:Math.round(agreeWeight*100),currentAction:U(d.action||'WAIT'),freshness:freshness(d.receivedAt)};
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
  const explicitSideways=/SIDEWAY|CHOP|RANGE|FLAT/.test(structure);
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
  const danger=hardChop||explicitSideways||softChop&&fastWhipsaw||fastWhipsaw||noisyWhipsaw;

  let dangerStreak=g.dangerStreak||0,cleanStreak=g.cleanStreak||0,active=!!g.active;
  if(danger){dangerStreak++;cleanStreak=0;}else{cleanStreak++;dangerStreak=0;}

  if(!active&&(hardChop||explicitSideways||dangerStreak>=SIDEWAYS_TRIGGER_STREAK))active=true;
  if(active&&cleanStreak>=SIDEWAYS_CLEAR_STREAK)active=false;

  let reason='Market clear';
  if(active){
    if(hardChop)reason=`Chop tinggi ${chop.toFixed(1)}% — market terlalu serabut.`;
    else if(explicitSideways)reason='Structure SIDEWAYS/RANGE — signal baru dipause.';
    else if(fastWhipsaw)reason=`Price whipsaw laju — EMA9 flip ${emaFlips}x, arah price bertukar ${priceReversals}x.`;
    else reason='Market ulang-alik terlalu kerap — tunggu clear.';
  }

  g={active,dangerStreak,cleanStreak,lastKey:key,reason,activatedAt:active?(g.activatedAt||now):0,chop,emaFlips,priceReversals,range,atr,fastWhipsaw,explicitSideways};
  sidewaysGuardBySymbol.set(symbol,g);return g;
}

function exactAction(v){const s=U(v);return s==='BUY'||s==='SELL'?s:'WAIT';}
function confirmationForSide(d,side){
  if(side!=='BUY'&&side!=='SELL')return{passed:0,total:4,mtfAligned:0,items:[]};
  const items=[];
  const mtf=[N(d?.mtf1),N(d?.mtf2),N(d?.mtf3)];
  const mtfAligned=mtf.filter(v=>v!=null&&(side==='BUY'?v>0:v<0)).length;
  items.push({name:'MTF',pass:mtfAligned>=2});
  items.push({name:'HEMA',pass:dirText(d?.hemaTrend)===side});
  items.push({name:'Momentum',pass:dirText(d?.momentum)===side});
  items.push({name:'Structure',pass:dirText(d?.marketStructure)===side});
  return{passed:items.filter(x=>x.pass).length,total:items.length,mtfAligned,items};
}
function planGeometry(d,side){
  const e=N(d?.entry),sl=N(d?.sl),t1=N(d?.tp1),t2=N(d?.tp2),t3=N(d?.tp3);
  if([e,sl,t1,t2,t3].some(v=>v==null))return false;
  return side==='BUY'?sl<e&&e<t1&&t1<t2&&t2<t3:side==='SELL'?sl>e&&e>t1&&t1>t2&&t2>t3:false;
}
function exactPineZone(d){
  const e=N(d?.entry),sl=N(d?.sl);
  if(e==null||sl==null||e===sl)return null;
  const z1=sl+(e-sl)*.786,z2=sl+(e-sl)*.236;
  return{lo:Math.min(z1,z2),hi:Math.max(z1,z2)};
}
function entryReadyForSide(d,side){
  const z=exactPineZone(d),price=N(d?.close),atr=N(d?.atr),entry=N(d?.entry),ch=N(d?.chopIndex),r=rr(d);
  if(!z||price==null||atr==null||atr<=0||entry==null)return false;
  const inZone=price>=z.lo&&price<=z.hi;
  const zoneDist=price<z.lo?z.lo-price:price>z.hi?price-z.hi:0;
  const nearZone=!inZone&&zoneDist<=atr*.20;
  const nearEntry=Math.abs(price-entry)<=atr*.25;
  return planGeometry(d,side)&&r!=null&&r>=1.5&&(ch==null||ch<61.8)&&(inZone||nearZone||nearEntry)&&exactAction(d?.action)===side;
}
function signalWarnings(d,p,side){
  const notes=[];let count=0;
  const opposite=side==='BUY'?'SELL':'BUY';
  if(p?.direction===opposite&&p.confidence>=82&&p.agreement>=68){count++;notes.push('Prediction kuat dah lawan');}
  if(dirText(d?.hemaTrend)===opposite){count++;notes.push('HEMA dah flip');}
  if(dirText(d?.momentum)===opposite){count++;notes.push('Momentum dah lawan');}
  if(dirText(d?.marketStructure)===opposite){count++;notes.push('Structure dah pecah');}
  const mtf=[N(d?.mtf1),N(d?.mtf2),N(d?.mtf3)];
  const oppMtf=mtf.filter(v=>v!=null&&(opposite==='BUY'?v>0:v<0)).length;
  if(oppMtf>=2){count++;notes.push(`MTF ${oppMtf}/3 dah lawan`);}
  const ch=N(d?.chopIndex);if(ch!=null&&ch>=68){count++;notes.push('Market terlalu serabut');}
  return{count,notes,oppMtf};
}
function signalConfidenceForSide(p,side){
  if(!p||side==='WAIT')return 0;
  if(p.direction===side)return p.confidence;
  const b=N(p.bullScore)||0,s=N(p.bearScore)||0,total=b+s;
  if(!total)return 0;
  return clamp(Math.round((side==='BUY'?b:s)/total*100));
}
function signalPlanKey(d,side=''){return [side||exactAction(d?.action),N(d?.entry),N(d?.sl),N(d?.tp3)].join('|');}
function freshCore(){
  return{side:'WAIT',stage:'WAIT',locked:false,lockedAt:0,updatedAt:Date.now(),invalidStreak:0,cooldownUntil:0,reason:'Tunggu setup',warnings:[],planKey:'',endPlanKey:''};
}
function updateSignalCore(symbol,d){
  const now=Date.now(),p=predictionEngine(d,symbol),st=predictionStability(symbol),fresh=freshness(d?.receivedAt);
  let c=signalCoreBySymbol.get(symbol)||freshCore();
  const tp3=d?.tp3Hit===true,sl=d?.slHit===true&&!tp3,active=d?.tradeActive===true&&!tp3&&!sl;
  const currentPlanKey=signalPlanKey(d,c.side);
  const freshPlanAfterEnd=(tp3||sl)&&c.stage==='COOLDOWN'&&now>=c.cooldownUntil&&exactAction(d?.action)!=='WAIT'&&c.endPlanKey&&currentPlanKey!==c.endPlanKey;

  if((tp3||sl)&&!freshPlanAfterEnd){
    const oldSide=c.side||c.lastSide||'WAIT';
    if(c.stage!=='COOLDOWN'||c.endPlanKey!==currentPlanKey){
      c={...freshCore(),side:'WAIT',stage:'COOLDOWN',locked:false,cooldownUntil:now+SIGNAL_TRADE_COOLDOWN_MS,updatedAt:now,reason:tp3?'TP3 settle — tunggu setup baru':'SL kena — jangan revenge trade',lastSide:oldSide,endPlanKey:currentPlanKey};
    }else{
      c={...c,side:'WAIT',locked:false,updatedAt:now,reason:tp3?'TP3 settle — tunggu setup baru':'SL kena — jangan revenge trade'};
    }
    signalCoreBySymbol.set(symbol,c);return c;
  }
  if(freshPlanAfterEnd)c=freshCore();
  if(active){
    const tradeSide=d?.tradeIsBuy===true?'BUY':d?.tradeIsBuy===false?'SELL':c.side!=='WAIT'?c.side:p.direction;
    c={...c,side:tradeSide,stage:'ACTIVE',locked:true,lockedAt:c.lockedAt||now,invalidStreak:0,cooldownUntil:0,updatedAt:now,reason:'Position aktif — signal ikut arah trade',warnings:[],planKey:signalPlanKey(d,tradeSide)};
    signalCoreBySymbol.set(symbol,c);return c;
  }
  const sg=sidewaysGuard(symbol,d);
  if(sg.active){
    c={...freshCore(),side:'WAIT',stage:'SIDEWAYS',locked:false,updatedAt:now,reason:'MARKET SIDEWAYS — signal entry baru dipause',warnings:[sg.reason],lastSide:c.side||c.lastSide||'WAIT'};
    signalCoreBySymbol.set(symbol,c);return c;
  }
  if(fresh!=='LIVE'){
    c={...c,stage:c.locked?'LOCKED_WAIT':'WAIT',updatedAt:now,reason:'Data lambat — signal baru dibekukan'};
    signalCoreBySymbol.set(symbol,c);return c;
  }
  if(c.stage==='COOLDOWN'&&now<c.cooldownUntil){
    c={...c,side:'WAIT',locked:false,updatedAt:now,reason:'Cooldown — tunggu setup fresh'};
    signalCoreBySymbol.set(symbol,c);return c;
  }
  if(c.stage==='COOLDOWN'&&now>=c.cooldownUntil)c=freshCore();

  if(c.locked&&c.side!=='WAIT'){
    const w=signalWarnings(d,p,c.side);
    let streak=c.invalidStreak||0;
    if(w.count>=3)streak++;else if(w.count<=1)streak=0;else streak=Math.max(0,streak-1);
    if(streak>=SIGNAL_INVALID_STREAK){
      const oldSide=c.side;
      c={...freshCore(),side:'WAIT',stage:'COOLDOWN',locked:false,cooldownUntil:now+SIGNAL_REVERSAL_COOLDOWN_MS,updatedAt:now,reason:`Signal ${oldSide} batal — setup dah berubah`,lastSide:oldSide,warnings:w.notes};
      signalCoreBySymbol.set(symbol,c);return c;
    }
    const cf=confirmationForSide(d,c.side),ch=N(d?.chopIndex);
    const stillReady=cf.passed>=3&&(ch==null||ch<61.8);
    const entryReady=stillReady&&entryReadyForSide(d,c.side);
    c={...c,stage:entryReady?'ENTRY_READY':stillReady?'SETUP_READY':'LOCKED_WAIT',invalidStreak:streak,updatedAt:now,planKey:c.planKey||signalPlanKey(d,c.side),reason:entryReady?`${c.side} dah confirm — entry ikut plan`:stillReady?`${c.side} dikunci — setup masih sehala`:`${c.side} masih dikunci — tunggu confirmation balik`,warnings:w.notes};
    signalCoreBySymbol.set(symbol,c);return c;
  }

  if(p.direction==='WAIT'){
    c={...freshCore(),updatedAt:now,reason:'Belum ada arah cukup kuat'};signalCoreBySymbol.set(symbol,c);return c;
  }
  const side=p.direction,cf=confirmationForSide(d,side),ch=N(d?.chopIndex);
  const watch=p.confidence>=68&&p.consensus>=4;
  const setupReady=p.confidence>=82&&p.consensus>=6&&st>=70&&p.agreement>=68&&!p.conflict&&(ch==null||ch<61.8)&&cf.passed>=3;
  if(setupReady){
    const entryReady=entryReadyForSide(d,side);
    c={...freshCore(),side,stage:entryReady?'ENTRY_READY':'SETUP_READY',locked:true,lockedAt:now,updatedAt:now,reason:entryReady?`${side} dah confirm — entry ikut plan`:`${side} setup dah cukup kuat — arah dikunci`,planKey:signalPlanKey(d,side)};
  }else if(watch){
    c={...freshCore(),side,stage:'WATCH',locked:false,updatedAt:now,reason:`${side} ada potensi — belum lock`};
  }else{
    c={...freshCore(),updatedAt:now,reason:'Tunggu setup lebih kuat'};
  }
  signalCoreBySymbol.set(symbol,c);return c;
}

function predictionGrade(p){
  if(p.direction==='WAIT')return p.confidence>=75?'B':'C';
  if(p.confidence>=90&&p.consensus>=7)return'A+';
  if(p.confidence>=82&&p.consensus>=6)return'A';
  if(p.confidence>=74&&p.consensus>=5)return'B';
  if(p.confidence>=66)return'C';
  return'D';
}
function predictionReadiness(d,symbol,p){
  const z=zoneInfo(d),r=rr(d),st=predictionStability(symbol);
  let score=p.confidence*.56+st*.20+(p.consensus>=6?8:p.consensus>=4?4:0);
  if(z.inZone)score+=10;else if(z.near)score+=6;
  if(r!=null&&r>=1.5)score+=5;
  if(p.direction==='WAIT')score-=18;
  if(freshness(d.receivedAt)!=='LIVE')score-=20;
  return clamp(Math.round(score));
}
function predictionRadarScore(d,symbol,p){
  const rd=predictionReadiness(d,symbol,p),st=predictionStability(symbol),z=zoneInfo(d),r=rr(d);
  let score=p.confidence*.48+rd*.24+st*.16+(z.inZone?8:z.near?5:0)+(r!=null?Math.min(6,r*1.5):0);
  if(p.direction==='WAIT')score-=18; if(p.conflict)score-=6; return clamp(Math.round(score));
}
function predictionStatus(d,symbol,p){
  if(!d)return'OFFLINE'; const fresh=freshness(d.receivedAt); if(fresh==='OFFLINE')return'OFFLINE'; if(fresh==='STALE')return'STALE';
  if(d.tradeActive===true&&!d.tp3Hit&&!d.slHit)return'TRADE ACTIVE';
  const z=zoneInfo(d),rd=predictionReadiness(d,symbol,p),st=predictionStability(symbol);
  if(p.direction!=='WAIT'&&p.confidence>=82&&p.consensus>=6&&st>=65&&rd>=70&&(z.inZone||z.near))return'HOT PREDICTION';
  if(p.direction!=='WAIT'&&p.confidence>=74&&p.consensus>=5)return'PREDICTION READY';
  if(p.direction!=='WAIT'&&p.confidence>=68)return'WATCH';
  if(z.inZone||z.near)return'NEAR ENTRY'; return'WAIT';
}

function previousClosedSnapshot(symbol,d){
  const arr=historyBySymbol.get(symbol)||[];
  const curKey=N(d?.time)||N(d?.barIndex);
  for(let i=arr.length-1;i>=0;i--){
    const x=arr[i]; const k=N(x?.time)||N(x?.barIndex);
    if(curKey==null||k!==curKey)return x;
  }
  return null;
}
function mtfTotalOf(d){
  const direct=N(d?.mtfTotal);if(direct!=null)return direct;
  return [['mtf1',N(d?.mtf1)],['mtf2',N(d?.mtf2)],['mtf3',N(d?.mtf3)]]
    .reduce((a,[,v])=>a+(v==null?0:v>0?1:v<0?-1:0),0);
}
function opportunityStrength(d,side){
  const mtf=mtfTotalOf(d),stars=N(d?.confluenceStars)||0,rvol=N(d?.relativeVolume)||0;
  const strong=(side==='BUY'&&mtf>=2&&stars>=3&&rvol>1)||(side==='SELL'&&mtf<=-2&&stars>=3&&rvol>1);
  const weak=(side==='BUY'&&mtf<=0)||(side==='SELL'&&mtf>=0)||stars<=2;
  return{grade:strong?'STRONG':weak?'WEAK':'NORMAL',mtf,stars,rvol};
}
function updateOpportunity(symbol,d){
  const now=Date.now(),prev=previousClosedSnapshot(symbol,d),sg=sidewaysGuard(symbol,d);
  let last=opportunityBySymbol.get(symbol)||{type:'NONE',side:'WAIT',strength:'NONE',triggeredAt:0,barIndex:null,reason:'Tiada pullback trigger sekarang',risk:'WAIT'};
  if(sg.active){
    last={type:'NONE',side:'WAIT',strength:'NONE',triggeredAt:0,barIndex:last.barIndex,reason:'MARKET SIDEWAYS — pullback/re-entry/momentum dipause. Jangan add position.',risk:'NO_ADD'};
    opportunityBySymbol.set(symbol,last);return last;
  }
  const c=N(d?.close),pclose=N(prev?.close),ema9=N(d?.ema9),pema9=N(prev?.ema9),ema20=N(d?.ema20),atr=N(d?.atr),o=N(d?.open),wt1=N(d?.waveTrend1),wt2=N(d?.waveTrend2),entry=N(d?.entry);
  if([c,ema9].some(v=>v==null))return last;
  const crossUp=prev&&pclose!=null&&pema9!=null&&pclose<=pema9&&c>ema9;
  const crossDown=prev&&pclose!=null&&pema9!=null&&pclose>=pema9&&c<ema9;
  const active=d?.tradeActive===true&&!d?.tp3Hit&&!d?.slHit;
  const tradeSide=d?.tradeIsBuy===true?'BUY':d?.tradeIsBuy===false?'SELL':'WAIT';
  const positive=entry==null?false:tradeSide==='BUY'?c>entry:tradeSide==='SELL'?c<entry:false;
  const hema=dirText(d?.hemaTrend);
  const chop=N(d?.chopIndex);
  const bar=N(d?.barIndex)??N(d?.time);
  const cooldownOkay=last.barIndex==null||bar==null||Math.abs(bar-last.barIndex)>5;

  let type='NONE',side='WAIT',reason='';
  if(cooldownOkay&&active&&tradeSide==='BUY'&&positive&&crossUp&&wt1!=null&&wt2!=null&&wt1>wt2&&ema20!=null&&c>ema20){
    type='PULLBACK';side='BUY';reason='BUY pullback: price reclaim EMA9, momentum bullish, masih atas EMA20 dan trade asal masih profit.';
  }else if(cooldownOkay&&active&&tradeSide==='SELL'&&positive&&crossDown&&wt1!=null&&wt2!=null&&wt1<wt2&&ema20!=null&&c<ema20){
    type='PULLBACK';side='SELL';reason='SELL pullback: price reject bawah EMA9, momentum bearish, masih bawah EMA20 dan trade asal masih profit.';
  }else if(cooldownOkay&&!active&&hema==='BUY'&&crossUp&&wt1!=null&&wt2!=null&&wt1>wt2){
    type='REENTRY';side='BUY';reason='BUY re-entry: HEMA bullish, price reclaim EMA9 dan momentum sambung naik.';
  }else if(cooldownOkay&&!active&&hema==='SELL'&&crossDown&&wt1!=null&&wt2!=null&&wt1<wt2){
    type='REENTRY';side='SELL';reason='SELL re-entry: HEMA bearish, price reject EMA9 dan momentum sambung turun.';
  }else if(cooldownOkay&&atr!=null&&atr>0&&o!=null){
    const body=c-o,rvol=N(d?.relativeVolume)||0;
    if(hema==='BUY'&&body>atr*1.2&&rvol>1.2&&c>ema9){type='MOMENTUM';side='BUY';reason='Momentum BUY: candle kuat + volume + HEMA masih bullish.';}
    else if(hema==='SELL'&&-body>atr*1.2&&rvol>1.2&&c<ema9){type='MOMENTUM';side='SELL';reason='Momentum SELL: candle kuat + volume + HEMA masih bearish.';}
  }

  if(type!=='NONE'){
    const st=opportunityStrength(d,side);
    const risk=(st.grade==='WEAK'||(chop!=null&&chop>=61.8))?'NO_ADD':active?'MANAGE_RISK':'WATCH_ENTRY';
    last={type,side,strength:st.grade,triggeredAt:now,barIndex:bar,reason,risk,mtf:st.mtf,stars:st.stars,rvol:st.rvol,price:c,activeTrade:active};
    opportunityBySymbol.set(symbol,last);return last;
  }

  const age=now-(last.triggeredAt||0);
  if(last.type!=='NONE'&&age<=90000)return last;
  last={type:'NONE',side:'WAIT',strength:'NONE',triggeredAt:0,barIndex:last.barIndex,reason:'Tiada pullback / re-entry trigger sekarang',risk:'WAIT'};
  opportunityBySymbol.set(symbol,last);return last;
}

function marketSummary(symbol){
  const d=latestBySymbol.get(symbol);
  if(!d)return{symbol,online:false,freshness:'OFFLINE',status:'OFFLINE',signal:'WAIT',signalState:'WAIT',signalLocked:false,sidewaysGuard:false,sidewaysReason:'Tiada data',sidewaysChop:null,sidewaysEmaFlips:0,sidewaysPriceReversals:0,opportunityType:'NONE',opportunitySide:'WAIT',opportunityStrength:'NONE',opportunityReason:'Tiada data',opportunityRisk:'WAIT',prediction:'WAIT',rawPrediction:'WAIT',predictionConfidence:0,signalConfidence:0,predictionConsensus:0,predictionHorizon:'NEXT 1–3 BARS',currentAction:'WAIT',grade:'—',stability:0,readiness:0,radarScore:0,zone:'NO DATA',rr:null,price:null,timeframe:'—',receivedAt:null,tradeActive:false,reasons:[]};
  const p=predictionEngine(d,symbol),z=zoneInfo(d),st=predictionStability(symbol),rd=predictionReadiness(d,symbol,p),sg=sidewaysGuard(symbol,d);
  const core=signalCoreBySymbol.get(symbol)||updateSignalCore(symbol,d),opp=opportunityBySymbol.get(symbol)||updateOpportunity(symbol,d);
  const signal=core.side||'WAIT',signalConf=signalConfidenceForSide(p,signal);
  return{symbol,online:true,freshness:freshness(d.receivedAt),status:sg.active?'SIDEWAYS — SIGNAL PAUSE':predictionStatus(d,symbol,p),sidewaysGuard:!!sg.active,sidewaysReason:sg.reason,sidewaysChop:sg.chop,sidewaysEmaFlips:sg.emaFlips,sidewaysPriceReversals:sg.priceReversals,signal,signalState:core.stage,signalLocked:!!core.locked,signalReason:core.reason,signalWarnings:core.warnings||[],opportunityType:opp.type,opportunitySide:opp.side,opportunityStrength:opp.strength,opportunityReason:opp.reason,opportunityRisk:opp.risk,opportunityPrice:opp.price||null,opportunityTriggeredAt:opp.triggeredAt||0,signalInvalidStreak:core.invalidStreak||0,signalLockedAt:core.lockedAt||0,signalCooldownUntil:core.cooldownUntil||0,signalConfidence:signalConf,prediction:sg.active?'WAIT':p.direction,underlyingPrediction:p.direction,rawPrediction:sg.active?'WAIT':p.direction,predictionConfidence:sg.active?0:p.confidence,predictionConsensus:p.consensus,predictionEvidence:p.totalEvidence,predictionAgreement:p.agreement,predictionStrength:p.strength,predictionHorizon:p.horizon,predictionConflict:p.conflict,reasons:p.reasons,currentAction:p.currentAction,grade:predictionGrade(p),stability:st,readiness:rd,radarScore:predictionRadarScore(d,symbol,p),zone:z.state,rr:rr(d),price:N(d.close),timeframe:String(d.timeframe||'—'),receivedAt:N(d.receivedAt),tradeActive:d.tradeActive===true&&!d.tp3Hit&&!d.slHit,setupProbability:N(d.setupProbability),confluence:N(d.confluenceStars),feedMode:d.confirmed===false?'INTRABAR':'BAR-CLOSE'};
}
function priority(m){return m.status==='TRADE ACTIVE'?700:m.status==='HOT PREDICTION'?600:m.status==='PREDICTION READY'?500:m.status==='WATCH'?400:m.status==='NEAR ENTRY'?300:m.status==='WAIT'?200:m.status==='STALE'?80:0;}
function marketsPayload(){
  const symbols=[...new Set([...DEFAULT_MARKETS,...latestBySymbol.keys()])];
  const markets=symbols.map(marketSummary).sort((a,b)=>(priority(b)+b.radarScore)-(priority(a)+a.radarScore));
  const count=s=>markets.filter(m=>m.status===s).length; const live=markets.filter(m=>m.freshness==='LIVE').length;
  const best=markets.filter(m=>m.freshness==='LIVE'&&m.prediction!=='WAIT').sort((a,b)=>b.radarScore-a.radarScore)[0]||null;
  return{ok:true,engine:'ZenCore Signal Core v26.2 + Sideways Safety Guard',generatedAt:Date.now(),note:'Prediction remains forward-looking. Signal is locked separately by V26 to reduce flip-flop; scores are not guaranteed win probabilities.',summary:{markets:markets.length,live,hot:count('HOT PREDICTION'),ready:count('PREDICTION READY'),active:count('TRADE ACTIVE'),near:count('NEAR ENTRY'),watch:count('WATCH'),offline:count('OFFLINE')},best,markets};
}
function broadcastMarkets(){const payload=JSON.stringify(marketsPayload());for(const res of marketClients){try{res.write(`event: markets\ndata: ${payload}\n\n`)}catch(_){marketClients.delete(res)}}}
function broadcastPrediction(symbol){const set=predictionClients.get(symbol);if(!set)return;const payload=JSON.stringify(marketSummary(symbol));for(const res of set){try{res.write(`event: prediction\ndata: ${payload}\n\n`)}catch(_){set.delete(res)}}}
function captureBody(body){
  let parsed=null;try{parsed=JSON.parse(body)}catch(_){}
  if(parsed&&parsed.source==='ZenCore AI Dashboard Pro + Alerts'){
    const symbol=normSymbol(parsed.symbol||parsed.tickerid);if(!symbol)return;
    const d={...parsed,symbol,receivedAt:Date.now(),feedType:parsed.feedType||'LIVE'}; latestBySymbol.set(symbol,d);
    const arr=historyBySymbol.get(symbol)||[]; const key=N(d.time)||N(d.barIndex)||Date.now();
    const i=arr.findIndex(x=>(N(x.time)||N(x.barIndex))===key); if(i>=0)arr[i]=d;else arr.push(d); if(arr.length>600)arr.splice(0,arr.length-600); historyBySymbol.set(symbol,arr);
    updateSignalCore(symbol,d);
    updateOpportunity(symbol,d);
    broadcastMarkets();broadcastPrediction(symbol);
  }
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
  if(req.method==='GET'&&pathname==='/market-events'){
    res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'keep-alive','Access-Control-Allow-Origin':'*','X-Accel-Buffering':'no'});marketClients.add(res);res.write(`event: markets\ndata: ${JSON.stringify(marketsPayload())}\n\n`);const ping=setInterval(()=>{try{res.write(': ping\n\n')}catch(_){}},20000);req.on('close',()=>{clearInterval(ping);marketClients.delete(res)});return;
  }
  let m=pathname.match(/^\/api\/prediction\/([A-Za-z0-9._-]+)$/); if(req.method==='GET'&&m){const s=normSymbol(m[1]);return send(res,200,JSON.stringify(marketSummary(s)))}
  m=pathname.match(/^\/prediction-events\/([A-Za-z0-9._-]+)$/); if(req.method==='GET'&&m){const s=normSymbol(m[1]);res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'keep-alive','Access-Control-Allow-Origin':'*','X-Accel-Buffering':'no'});if(!predictionClients.has(s))predictionClients.set(s,new Set());predictionClients.get(s).add(res);res.write(`event: prediction\ndata: ${JSON.stringify(marketSummary(s))}\n\n`);const ping=setInterval(()=>{try{res.write(': ping\n\n')}catch(_){}},20000);req.on('close',()=>{clearInterval(ping);predictionClients.get(s)?.delete(res)});return;}
  m=pathname.match(/^\/pair\/([A-Za-z0-9._-]+)\/?$/); if(req.method==='GET'&&m)return proxyPairHtml(req,res,normSymbol(m[1]));
  return proxy(req,res);
});

server.listen(PUBLIC_PORT,'0.0.0.0',()=>console.log(`ZenCore V17 Forward Prediction gateway running on port ${PUBLIC_PORT} -> V16 ${V16_PORT}`));
