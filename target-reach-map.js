'use strict';
const FX=new Set(['EURUSD','GBPUSD','USDJPY','USDCAD','USDCHF','EURJPY','GBPJPY','EURGBP']);
const n=v=>v===null||v===undefined||v===''?null:Number.isFinite(Number(v))?Number(v):null;
function unit(symbol){
  if(FX.has(symbol))return {name:'pip',size:symbol.endsWith('JPY')?.01:.0001};
  if(symbol==='XAUUSD')return {name:'USD/oz',size:1};
  if(symbol==='US30')return {name:'mata indeks',size:1};
  if(symbol==='BTCUSD')return {name:'USD',size:1};
  return null;
}
function targetReachMap({symbol,sop,external,scenario,stats}={}){
  const empty={status:'WAIT_SOP',reason:'Pelan Entry/SL/TP semasa belum disahkan.',targets:[],
    note:'Julat 15 minit ialah rujukan volatiliti, bukan jarak yang dijamin. Keuntungan wang memerlukan saiz lot, spesifikasi broker dan kos.'};
  if(!sop||sop.state!=='READY'||!['BUY','SELL'].includes(sop.side)||!sop.plan||!unit(symbol))return empty;
  const sign=sop.side==='BUY'?1:-1,entry=n(sop.plan.entry),sl=n(sop.plan.sl);
  const levels=['tp1','tp2','tp3'].map(k=>n(sop.plan[k]));
  if(entry===null||sl===null||(entry-sl)*sign<=0||levels.some(v=>v===null)||
     levels.some((v,i)=>(v-(i?levels[i-1]:entry))*sign<=0))return {...empty,reason:'Pelan Entry/SL/TP tidak lengkap atau susunan paras tidak sah.'};
  const u=unit(symbol),risk=Math.abs(entry-sl),price=n(external?.currentPrice),atr=n(external?.atr3m);
  const fresh=external?.status==='AVAILABLE'&&scenario?.status!=='WAIT_DATA'&&price!==null&&atr!==null&&atr>0;
  const room=fresh?1.5*atr:null,count=n(stats?.sample),sample=count!==null&&count>=30?count:null;
  const targets=levels.map((level,i)=>{
    const distance=(level-entry)*sign,remaining=price===null?null:(level-price)*sign;
    const observed=n(stats?.['hitTp'+(i+1)]);
    return {name:'TP'+(i+1),price:level,priceDistance:Number(distance.toFixed(8)),
      distance:Number((distance/u.size).toFixed(1)),unit:u.name,
      rr:Number((distance/risk).toFixed(2)),remaining: fresh?Number((Math.max(0,remaining)/u.size).toFixed(1)):null,
      reach:fresh?(remaining<=0?'SUDAH DILEPASI':remaining<=room?'DALAM JULAT 15M':'DI LUAR JULAT 15M'):'BELUM DAPAT DINILAI',
      historical:sample!==null&&observed!==null&&observed>=0&&observed<=sample?
        {rate:Math.round(observed/sample*1000)/10,hit:observed,sample}:null};
  });
  return {status:fresh?'AVAILABLE':'PLAN_ONLY',side:sop.side,entry,sl,
    riskDistance:Number((risk/u.size).toFixed(1)),unit:u.name,referencePrice:fresh?price:null,
    referenceKind:'Close candle 1M luaran; bukan bid/ask MT5',room15m:fresh?Number((room/u.size).toFixed(1)):null,
    targets,reason:fresh?'Ruang sasaran dibandingkan dengan 1.5 ATR 3M dari harga rujukan.':'Pelan sah, tetapi harga luaran segar tiada; hanya jarak daripada entry dipaparkan.',
    note:'Peratus ialah kadar capai sejarah validasi ZenCore bagi pair dan arah sama (minimum 30 rekod selesai, ambiguous dikecualikan), bukan peluang menang setup ini. Kos, spread dan slippage belum dimasukkan.'};
}
module.exports={targetReachMap,unit};
