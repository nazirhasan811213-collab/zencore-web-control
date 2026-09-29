'use strict';
const FX=new Set(['EURUSD','GBPUSD','USDJPY','USDCAD','USDCHF','EURJPY','GBPJPY','EURGBP']);
const n=v=>v===null||v===undefined||v===''?null:Number.isFinite(Number(v))?Number(v):null;
function unit(symbol){
  if(FX.has(symbol))return {name:'pip',size:symbol.endsWith('JPY')?.01:.0001};
  if(symbol==='XAUUSD')return {name:'USD/oz',size:1};
  if(symbol==='BTCUSD')return {name:'USD',size:1};
  return null;
}
function targetReachMap({symbol,sop}={}){
  const empty={status:'WAIT_SOP',reason:'Pelan Entry/SL/TP semasa belum disahkan.',targets:[],
    note:'Sasaran dan julat indikator bukan jarak profit yang dijamin.'};
  if(!sop||sop.state!=='READY'||!['BUY','SELL'].includes(sop.side)||!sop.plan||!unit(symbol))return empty;
  const sign=sop.side==='BUY'?1:-1,entry=n(sop.plan.entry),sl=n(sop.plan.sl);
  const levels=['tp1','tp2','tp3'].map(k=>n(sop.plan[k]));
  if(entry===null||sl===null||(entry-sl)*sign<=0||levels.some(v=>v===null)||
     levels.some((v,i)=>(v-(i?levels[i-1]:entry))*sign<=0))return {...empty,reason:'Pelan Entry/SL/TP tidak lengkap atau susunan paras tidak sah.'};
  const u=unit(symbol),risk=Math.abs(entry-sl),d=sop.indicator||{};
  const price=n(d.close),atr=n(d.atr),ema9=n(d.ema9),ema20=n(d.ema20),ema50=n(d.ema50);
  const hema20=n(d.hema20),hema40=n(d.hema40),wt1=n(d.waveTrend1),wt2=n(d.waveTrend2);
  const rsi=n(d.rsi),chop=n(d.chop),rvol=n(d.relativeVolume),trend=n(d.globalTrend),power=n(d.power),green=n(d.green);
  const forecast=String(d.forecast||'').toUpperCase();
  const complete=[price,atr,ema9,ema20,ema50,hema20,hema40,wt1,wt2,rsi,chop,trend,power,green].every(v=>v!==null)&&
    atr>0&&price>0&&rsi>=0&&rsi<=100&&chop>=0&&chop<=100&&power>=0&&power<=100&&green>=0&&green<=5&&
    ['BULLISH','BEARISH','NEUTRAL','CHOPPY'].includes(forecast);
  const opposite=sign===1?'BEARISH':'BULLISH';
  const checks=complete?[
    {label:'Trend 3M dan MTF',pass:trend*sign>=2},
    {label:'EMA 9/20/50 searah',pass:sign===1?price>ema9&&ema9>ema20&&ema20>ema50:price<ema9&&ema9<ema20&&ema20<ema50},
    {label:'HEMA 20/40 searah',pass:(hema20-hema40)*sign>0},
    {label:'WaveTrend searah',pass:(wt1-wt2)*sign>0},
    {label:'RSI ada ruang',pass:sign===1?rsi<70:rsi>30},
    {label:'Pasaran tidak choppy',pass:chop<=61.8},
    {label:'Forecast Pine searah',pass:forecast===(sign===1?'BULLISH':'BEARISH')},
    {label:'Power dan SOP menyokong',pass:power>=50&&green>=4},
    ...(rvol!==null&&rvol>0?[{label:'Volume relatif menyokong',pass:rvol>=.8}]:[])
  ]:[];
  // ATR is a volatility scale, not a calibrated prediction of the next five bars.
  // The envelope starts at the source 3M close and is restricted by the nearer EMA20/HEMA20 barrier.
  const rawRoom=complete?1.5*atr:null;
  const barrier=complete?[ema20,hema20].filter(v=>(v-price)*sign>0).sort((a,b)=>(a-b)*sign)[0]??null:null;
  const room=complete?Math.min(rawRoom,barrier===null?rawRoom:Math.max(0,(barrier-price)*sign)):null;
  const conflict=complete&&(forecast===opposite||chop>61.8);
  const support=checks.filter(c=>c.pass).length;
  const targets=levels.map((level,i)=>{
    const distance=(level-entry)*sign,remaining=complete?(level-price)*sign:null;
    let reach='DATA INDIKATOR TIDAK LENGKAP';
    if(complete)reach=remaining<=0?'PARAS TELAH DILEPASI':conflict?'TERHALANG · KONFLIK INDIKATOR':
      barrier!==null&&(level-barrier)*sign>0?'TERHALANG · EMA/HEMA':
      remaining>room?'DI LUAR JULAT INDIKATOR':support>=6?'DISOKONG INDIKATOR':'SOKONGAN TERHAD';
    return {name:'TP'+(i+1),price:level,priceDistance:Number(distance.toFixed(8)),
      distance:Number((distance/u.size).toFixed(1)),unit:u.name,rr:Number((distance/risk).toFixed(2)),
      remaining:complete?Number((Math.max(0,remaining)/u.size).toFixed(1)):null,reach};
  });
  return {status:complete?'AVAILABLE':'PLAN_ONLY',side:sop.side,entry,sl,
    riskDistance:Number((risk/u.size).toFixed(1)),unit:u.name,referencePrice:complete?price:null,
    room15m:complete?Number((room/u.size).toFixed(1)):null,
    indicator:{support:complete?support:null,total:checks.length,checks,atr:complete?atr:null,power:complete?power:null,
      forecast:complete?forecast:null,barrier:complete?barrier:null,close:complete?price:null},targets,
    reason:complete?`Snapshot Pine 3M: ${support}/${checks.length} penapis menyokong ${sop.side}. Julat 1.5 ATR dihadkan paras EMA/HEMA terdekat; semak setiap TP.`:
      'Pelan sah, tetapi input indikator Pine semasa tidak lengkap; hanya jarak daripada entry dipaparkan.',
    note:'Ini penilaian indikator pada candle 3M semasa, bukan peratus peluang mencapai TP, bukti prestasi sejarah atau keuntungan dijamin. Julat 1.5 ATR ialah heuristik; spread, slippage dan kos belum dikira.'};
}
module.exports={targetReachMap,unit};
