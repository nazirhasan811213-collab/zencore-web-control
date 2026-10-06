(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(require('./dashboard-live-core'));else root.ZenCoreGoldCopilot=factory(root.ZenCoreDashboardLive);})(typeof globalThis!=='undefined'?globalThis:this,function(Live){
 'use strict';
 const num=v=>v===null||v===undefined||v===''?null:Number.isFinite(Number(v))?Number(v):null;
 function analyse(views,tf,now=Date.now()){
  const v=views.find(v=>Number(v.timeframe)===Number(tf)),m=v?.market,n=m?.strategyNormal||{},s=n.sop||{},p=n.plan||{};
  const base={timeframe:tf,higher:tf===2?3:30,method:'Bacaan ni ikut data Pine dan SOP ZenCore.',note:'Skor forecast bukan win rate. Market boleh berubah bila-bila.'};
  if(!Live.fresh(v,now))return {...base,status:'WAIT_DATA',action:'DATA LAMBAT — TUNGGU DULU',headline:'TF'+tf+' belum ada bacaan fresh.',reason:'Data tak masuk atau dah lebih 30 saat. Jangan entry pakai signal lama.',levels:null,scenarios:[],checks:[]};
  const side=['BUY','SELL'].includes(n.side)?n.side:'WAIT',sign=side==='BUY'?1:side==='SELL'?-1:0;
  const quote=Live.quote(views,now),price=num(quote?.market?.price),levels=Object.fromEntries(['entry','sl','tp1','tp2','tp3'].map(k=>[k,num(p[k])]));
  const valid=sign!==0&&price>0&&Object.values(levels).every(x=>x>0)&&sign*(levels.entry-levels.sl)>0&&sign*(levels.tp1-levels.entry)>0&&sign*(levels.tp2-levels.tp1)>0&&sign*(levels.tp3-levels.tp2)>0;
  const inRange=valid&&sign*(price-levels.entry)>0&&sign*(levels.tp1-price)>0;
  const checks=Array.isArray(s.gates)?s.gates.map(g=>({label:String(g.label||g.key),pass:g.pass===true,detail:String(g.detail||'')})):[];
  const higher=base.higher,aligned=s['hema'+tf]?.mode===side&&s['hema'+higher]?.mode===side;
  const approved=v.entryReady===true&&n.state==='READY'&&n.solid===true&&checks.length>0&&checks.every(g=>g.pass)&&aligned&&(!s.hemaShape||s.hemaShape.pass===true);
  const actionable=approved&&inRange;
  const failed=checks.filter(g=>!g.pass).map(g=>g.label);
  const invalidated=valid&&sign*(price-levels.sl)<=0;
  const status=!valid?'WAIT_PLAN':invalidated?'INVALIDATED':actionable?'QUALIFIED':approved&&!inRange?'WAIT_RANGE':'WAIT_CONFIRMATION';
  const action=status==='QUALIFIED'?'SETUP '+side+' DAH CUKUP SOP':status==='INVALIDATED'?'SETUP NI DAH BATAL':status==='WAIT_RANGE'?'JANGAN KEJAR — TUNGGU PRICE MASUK RANGE':'BELUM CUKUP SOP — TUNGGU DULU';
  const reason=!valid?'Price atau level entry/SL/TP belum lengkap, atau susunannya tak betul. Tunggu setup yang sah dulu.':invalidated?'Price dah kena atau lepas SL setup ni. Tunggu setup baru.':actionable?'SOP TF'+tf+' dah cukup. Price masih antara entry dengan TP1. Sebelum entry, check price broker, spread, lot dan connection akaun dulu.':status==='WAIT_RANGE'?'Price dah luar range entry–TP1. Jangan kejar. Bila price masuk range balik, check SOP semula.':failed.length?'Yang belum lepas: '+failed.join(' • '):'Sistem belum bagi entry lagi. '+(n.reason||'Tunggu semua confirmation cukup dulu.');
  const scenarios=valid?[
   'Kalau momentum '+side+' sambung dan SOP masih cukup, target ikut TP1 → TP2 → TP3. Belum tentu semua target sampai.',
   'Kalau price patah balik ke entry, check HEMA dan SOP semula. Kalau dah ada posisi, ikut setting manage trade. Jangan tambah layer semata-mata sebab ulasan ni.',
   'Kalau price lepas SL, HEMA tukar arah atau data dah basi, jangan guna setup ni.'
  ]:['Level entry/SL/TP belum lengkap. Belum boleh bagi target yang sah.'];
  return {...base,status,action,headline:'TF'+tf+' · '+side,reason,price,observedAt:quote?.market?.signalObservedAt||quote?.market?.receivedAt,forecast:{direction:s.forecast||'WAIT',score:num(s.marketPower),horizonMinutes:tf*10},hema:{own:s['hema'+tf]?.mode||'WAIT_DATA',higher:s['hema'+higher]?.mode||'WAIT_DATA',shape:s.hemaShape?.state||'TIDAK TERSEDIA'},levels:valid?levels:null,scenarios,checks,management:m.positionManagement?.action||'HOLD',rr:valid?Math.abs(levels.tp1-levels.entry)/Math.abs(levels.entry-levels.sl):null};
 }
 return {analyse};
});
