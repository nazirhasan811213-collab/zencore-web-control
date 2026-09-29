'use strict';
// Candidate analysis. No broker orders and no writes to legacy signal state.
const PAIRS = Object.freeze(['XAUUSD','EURUSD','GBPUSD','USDJPY','USDCAD','USDCHF','EURJPY','GBPJPY','EURGBP']);
const num = v => v === null || v === undefined || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null;
const clamp = (v,a,b) => Math.max(a,Math.min(b,v));
function forecastGate(momentum, forecast, strength, dominance) {
  if (forecast === 'CHOPPY') return false;
  if (forecast === 'NEUTRAL') return num(dominance)!==null && (momentum==='BUY'?dominance>50:momentum==='SELL'?dominance<50:false);
  return num(strength)!==null && strength>50 && ((momentum==='BUY'&&forecast==='BULLISH')||(momentum==='SELL'&&forecast==='BEARISH'));
}
function buildPlan(c) {
  const {side,price,atr,tickSize,spread,swingLow,swingHigh,resistance,support}=c;
  if (![price,atr,tickSize,spread,swingLow,swingHigh].every(v=>num(v)!==null) || price<=0 || atr<=0 || tickSize<=0 || spread<0 || swingLow>=price || swingHigh<=price) return null;
  const sign=side==='BUY'?1:side==='SELL'?-1:0;
  if(!sign)return null;
  const round=(v,dir)=>Number(((dir>0?Math.ceil(v/tickSize-1e-8):Math.floor(v/tickSize+1e-8))*tickSize).toFixed(10));
  const entry=round(price,sign);
  const buffer=Math.max(atr*.15,spread*1.5,tickSize*2);
  const sl=round(sign>0?swingLow-buffer:swingHigh+buffer,-sign);
  const risk=Math.abs(entry-sl);
  if(risk<=spread*3 || risk>atr*2.5)return null;
  const strength=clamp(num(c.strength)??50,0,100);
  const horizonRange=atr*(1.1+strength/100); // research heuristic, not calibrated probability
  const obstacle=sign>0?num(resistance):num(support);
  const room=obstacle!==null?(obstacle-entry)*sign-buffer:Infinity;
  if(room<=0)return null;
  const d1=Math.min(Math.max(risk*.8,atr*.6),room);
  if(d1<risk*.7 || d1<spread*4)return null;
  const d2=Math.min(Math.max(d1+atr*.45,risk*1.3),room);
  const d3=Math.min(Math.max(d2+atr*.55,risk*1.8),room);
  const targets=[d1,d2,d3].map(d=>round(entry+sign*d,-sign));
  if(targets.some((v,i)=>(v-(i?targets[i-1]:entry))*sign<tickSize*.99))return null;
  return {side,entry,sl,initialSl:sl,tp1:targets[0],tp2:targets[1],tp3:targets[2],riskDistance:risk,tickSize,spread,
    rr:targets.map(p=>Number((Math.abs(p-entry)/risk).toFixed(2))),horizonMinutes:15,
    primaryTarget: d3<=horizonRange?'TP3':d2<=horizonRange?'TP2':'TP1',
    targetBasis:'Struktur + ATR 3M; parameter penyelidikan, belum dikalibrasi',
    zoneLow:round(c.zone-atr*.2,-1),zoneHigh:round(c.zone+atr*.2,1)};
}
function analyse(c={}, now=Date.now()) {
  const base={version:'33-preview',symbol:c.symbol,timeframe:'3M',horizonBars:5,horizonMinutes:15,generatedAt:now,
    dataAt:num(c.dataAt),status:'WAIT',side:'WAIT',reason:'Menunggu feed V33: setup 3M lengkap dan pencetus 1M.',plan:null,checks:[]};
  if(!PAIRS.includes(c.symbol))return {...base,reason:'Pair tidak disokong.'};
  if(c.schema!=='33.0')return base;
  const freshness=num(c.dataAt)!==null&&now-c.dataAt<=90000&&now-c.dataAt>=-5000;
  const setupFresh=num(c.setupAt)!==null&&now-c.setupAt>=0&&now-c.setupAt<=6*60000;
  const required=['price','atr','zone','tickSize','spread','swingLow','swingHigh'];
  if(!required.every(k=>num(c[k])!==null))return {...base,reason:'Data harga, spread atau struktur belum lengkap.'};
  const side=c.momentum==='BUY'?'BUY':c.momentum==='SELL'?'SELL':'WAIT';
  const fpass=forecastGate(side,c.forecast,c.strength,c.dominance);
  const structure=c.hema===side&&c.basisSide===side;
  const checks=[{label:'Data 1M segar',pass:freshness},{label:'Setup 3M confirmed',pass:c.confirmed3===true&&setupFresh},
    {label:'Bukan choppy',pass:c.choppy===false&&c.forecast!=='CHOPPY'},{label:'Momentum + forecast',pass:fpass},
    {label:'HEMA + struktur',pass:structure},{label:'Candle ZenCore searah',pass:c.candleSide===side&&side!=='WAIT'},
    {label:'Pencetus 1M confirmed',pass:c.trigger1===side&&c.confirmed1===true}];
  const score=Math.round(checks.filter(x=>x.pass).length/checks.length*100);
  const out={...base,side,checks,score,forecast:c.forecast,strength:c.strength,dominance:c.dominance};
  if(!freshness)return {...out,reason:'Data lewat. Jangan gunakan snapshot ini untuk entry.'};
  if(c.choppy!==false||c.forecast==='CHOPPY')return {...out,reason:'CHOPPY — jangan entry.'};
  if(!checks.slice(1,6).every(x=>x.pass))return {...out,status:'WATCH',reason:'Setup belum sepadan: '+checks.slice(1,6).filter(x=>!x.pass).map(x=>x.label).join(', ')};
  const distance=(c.price-c.zone)*(side==='BUY'?1:-1);
  if(Math.abs(distance)>c.atr*.65)return {...out,status:'WAIT_PULLBACK',reason:'Harga jauh daripada zon. Tunggu pullback; jangan kejar candle.'};
  if(!checks[6].pass)return {...out,status:'ARMED',reason:'Setup 3M tersedia. Menunggu pengesahan pullback/retest 1M.'};
  const plan=buildPlan({...c,side});
  if(!plan)return {...out,reason:'Ruang sasaran atau struktur SL tidak sesuai selepas kos.'};
  return {...out,status:'ENTRY_READY',reason:'Setup 3M searah, pencetus 1M sah dan harga masih dalam zon.',plan,
    setupId:`${c.symbol}:${c.setupAt}:${side}`,entryQuality:Math.round(clamp(100-Math.abs(distance)/c.atr*45-c.spread/c.atr*100,0,100))};
}
// Forward-only position audit. Entry bars never use earlier high/low to infer fills.
class PositionTracker {
  constructor(){this.positions=new Map();this.seen=new Set();this.history=[];}
  update(c, decision, now=Date.now()) {
    let p=this.positions.get(c.symbol);
    const dataAt=num(c.dataAt);
    if(dataAt===null || now-dataAt>90000 || dataAt>now+5000)return p?structuredClone(p):null;
    if(p && dataAt>p.lastDataAt){
      p.lastDataAt=dataAt;
      const sign=p.plan.side==='BUY'?1:-1,price=num(c.price);
      const hi=num(c.high1),lo=num(c.low1);
      // A complete 1M bar strictly after entry is required for range checks.
      const rangeValid=c.confirmed1===true&&num(c.barOpen1)!==null&&c.barOpen1>=p.enteredAt&&hi!==null&&lo!==null;
      if(price!==null){p.mae=Math.max(p.mae,Math.max(0,(p.plan.entry-price)*sign));p.mfe=Math.max(p.mfe,Math.max(0,(price-p.plan.entry)*sign));}
      if(rangeValid){
        p.mae=Math.max(p.mae,Math.max(0,(p.plan.entry-(sign>0?lo:hi))*sign));
        p.mfe=Math.max(p.mfe,Math.max(0,((sign>0?hi:lo)-p.plan.entry)*sign));
        const slHit=sign>0?lo<=p.activeSl:hi>=p.activeSl;
        if(slHit){p.status='CLOSED';p.exitReason='SL_OR_STEPLOCK';p.exitPrice=p.activeSl;}
        else {
          const hit=[p.plan.tp1,p.plan.tp2,p.plan.tp3].reduce((n,t,i)=>(sign>0?hi>=t:lo<=t)?i+1:n,0);
          p.targetStage=Math.max(p.targetStage,hit);
          // New lock is effective from next observation, not retroactively within this bar.
          p.activeSl=[p.plan.sl,p.plan.entry,p.plan.tp1,p.plan.tp2][p.targetStage];
        }
      }
      if(p.status==='ACTIVE'&&dataAt>=p.expiresAt){p.status='CLOSED';p.exitReason='TIME_REVIEW_15M';p.exitPrice=price;}
      if(p.status==='CLOSED'){p.closedAt=dataAt;this.history.push(structuredClone(p));if(this.history.length>900)this.history.shift();this.positions.delete(c.symbol);return structuredClone(p);}
    }
    if(!p&&decision.status==='ENTRY_READY'&&!this.seen.has(decision.setupId)){
      p={id:decision.setupId,symbol:c.symbol,status:'ACTIVE',plan:structuredClone(decision.plan),enteredAt:dataAt,lastDataAt:dataAt,expiresAt:dataAt+900000,activeSl:decision.plan.sl,targetStage:0,mae:0,mfe:0};
      this.positions.set(c.symbol,p);this.seen.add(p.id);
    }
    return p?structuredClone(p):null;
  }
}
module.exports={PAIRS,forecastGate,buildPlan,analyse,PositionTracker};
