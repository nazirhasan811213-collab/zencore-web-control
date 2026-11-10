'use strict';
// Analysis only. Weights are a versioned heuristic, never a calibrated win probability.
const VERSION='PINE_TECHNICAL_STRENGTH_V1';
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const clamp=x=>Math.max(0,Math.min(1,x));
function assess(m,now=Date.now(),candles=[]){
 const n=m?.strategyNormal||{},s=n.sop||{},p=n.plan||{},tf=String(m?.timeframe||'').replace(/m$/,''),sign=n.side==='BUY'?1:n.side==='SELL'?-1:0;
 const at=m?.signalObservedAt||m?.receivedAt;
 const base={version:VERSION,asOf:now,sourceAt:at||null,timeframe:tf,side:n.side||null,setupKey:m?.setupKey||null,status:'INCOMPLETE',overall:null,targets:null,range:null,coverage:0,missing:[],warnings:[],groups:[],plan:{...p},meaning:'TECHNICAL_SUPPORT_NOT_WIN_PROBABILITY'};
 if(!['2','15'].includes(tf)||!sign||n.solid!==true){base.missing.push('direction/timeframe');return base;}
 if(!finite(at)||at>now+5000||now-at>(tf==='2'?60000:30000)){base.status='STALE';return base;}
 if(!['entry','sl','tp1','tp2','tp3'].every(k=>finite(p[k])&&p[k]>0)||sign*(p.entry-p.sl)<=0||sign*(p.tp1-p.entry)<=0||sign*(p.tp2-p.tp1)<=0||sign*(p.tp3-p.tp2)<=0){base.missing.push('validPlan');return base;}
 const h=s['hema'+tf]||{},bar=s.currentBar||m;
 const v={fast:m.hemaFast??m.hema20??h.fast,slow:m.hemaSlow??m.hema40??h.slow,e9:m.ema9,e20:m.ema20,e50:m.ema50,wt1:m.waveTrend1??h.waveTrend1,wt2:m.waveTrend2??h.waveTrend2,rsi:m.rsi,chop:m.chopIndex??s.chopIndex,volume:m.relativeVolume,mtf:s.mtfScore,atr:s.atrReference??m.atr,open:bar.open,high:bar.high,low:bar.low,close:bar.close,power:s.marketPower};
 base.inputs={...v,forecast:s.forecast||null};
 const add=(name,weight,keys,score)=>{const missing=keys.filter(k=>!finite(v[k]));base.missing.push(...missing);base.groups.push({name,weight,score:missing.length?null:Math.round(clamp(score())*weight*100)/100});};
 add('HEMA',15,['fast','slow'],()=>sign*(v.fast-v.slow)>0?1:0);
 add('EMA',10,['e9','e20','e50'],()=>((sign*(v.e9-v.e20)>0?1:0)+(sign*(v.e20-v.e50)>0?1:0))/2);
 add('WaveTrend',15,['wt1','wt2'],()=>sign*(v.wt1-v.wt2)>0?1:0);
 add('RSI',10,['rsi'],()=>v.rsi<0||v.rsi>100?0:sign===1?(v.rsi>=50&&v.rsi<=70?1:v.rsi>70?0.25:0):(v.rsi<=50&&v.rsi>=30?1:v.rsi<30?0.25:0));
 add('Candle',10,['open','high','low','close'],()=>v.high>v.low&&sign*(v.close-v.open)>0?0.5+0.5*clamp(Math.abs(v.close-v.open)/(v.high-v.low)):0);
 add('Structure',10,['chop'],()=>clamp((65-v.chop)/25));
 add('Volume',5,['volume'],()=>clamp(v.volume/1.2));
 add('MTF',10,['mtf'],()=>clamp((sign*v.mtf+3)/6));
 const f=String(s.forecast||'').toUpperCase(),aligned=sign===1?f.startsWith('BULLISH'):f.startsWith('BEARISH'),opposed=sign===1?f.startsWith('BEARISH'):f.startsWith('BULLISH');
 if(!/^(BULLISH|BEARISH|NEUTRAL)/.test(f))base.missing.push('forecast');
 add('Forecast',15,['power'],()=>aligned?clamp(v.power/100):opposed?0:0.5);
 if(!finite(v.atr)||v.atr<=0)base.missing.push('atr');
 if(v.rsi<0||v.rsi>100||v.chop<0||v.chop>100||v.power<0||v.power>100||Math.abs(v.mtf)>3||v.volume<0||v.high<Math.max(v.open,v.close)||v.low>Math.min(v.open,v.close))base.missing.push('invalidIndicatorRange');
 base.missing=[...new Set(base.missing)];base.coverage=base.groups.reduce((a,g)=>a+(g.score===null?0:g.weight),0);
 if(base.missing.length)return base;
 let total=base.groups.reduce((a,g)=>a+g.score,0);
 if(opposed){total=Math.min(total,55);base.warnings.push('Forecast melawan arah setup');}
 if(sign*v.mtf<=-2){total=Math.min(total,55);base.warnings.push('MTF melawan arah setup');}
 if(v.chop>=60){total=Math.min(total,55);base.warnings.push('Market berulang-alik');}
 base.status='AVAILABLE';base.overall=Math.round(total);
 const levels=require('./telegram-trade-guide').nearbyLevels(require('./telegram-trade-guide').closedRows(candles,now,tf),p.entry,v.atr,tf);
 const obstacles=sign===1?levels.resistances:levels.supports;
 const obstacle=Array.isArray(obstacles)?obstacles.map(x=>typeof x==='number'?x:x.price).filter(x=>finite(x)&&sign*(x-p.entry)>0).sort((a,b)=>sign*(a-b))[0]:null;
 const budget=Math.min(sign*(p.tp3-p.entry),v.atr*(0.5+base.overall/100));
 const far=Math.min(budget,finite(obstacle)?sign*(obstacle-p.entry):Infinity),near=far*0.75;
 base.range={low:Math.min(p.entry+sign*near,p.entry+sign*far),high:Math.max(p.entry+sign*near,p.entry+sign*far),basis:'ATR_HEURISTIC_CAPPED_BY_TP3_AND_NEARBY_STRUCTURE',structureAvailable:finite(obstacle),horizon:tf==='2'?'NEXT_30_MIN':'NEXT_60_MIN'};
 base.targets=Object.fromEntries([1,2,3].map(i=>{const dist=sign*(p['tp'+i]-p.entry),penalty=Math.max(0,dist/v.atr-0.5)*15+(finite(obstacle)&&sign*(p['tp'+i]-obstacle)>0?10:0);return ['tp'+i,Math.max(0,Math.round(base.overall-penalty))];}));
 base.warnings.push('Skor teknikal dan julat indikator; belum dikalibrasi dengan hasil sebenar');return base;
}
function evaluate(records){
 const groups=[];
 for(const tf of ['2','15'])for(const floor of [0,40,60,80]){
  const upper=floor===0?40:floor===40?60:floor===60?80:101;
  const rows=records.filter(r=>r.timeframe===tf&&r.setupAssessment?.version===VERSION&&r.setupAssessment.status==='AVAILABLE'&&r.setupAssessment.overall>=floor&&r.setupAssessment.overall<upper);
  if(rows.length)groups.push({timeframe:tf,band:floor+'–'+(upper-1),sample:rows.length,open:rows.filter(r=>r.state==='OPEN').length,tp1Observed:rows.filter(r=>r.hitTp1).length,tp2Observed:rows.filter(r=>r.hitTp2).length,tp3Observed:rows.filter(r=>r.hitTp3).length});
 }
 return {version:VERSION,scope:'LATEST_500_RETAINED_SIGNALS',groups,note:'Pemerhatian TP sahaja; bukan kadar kemenangan atau TP sebelum SL. Rekod lama tanpa snapshot dikecualikan.'};
}
module.exports={assess,evaluate,VERSION};
