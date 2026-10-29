'use strict';
const VERSION='TF2_ENTRY_SAFETY_V1';
// Sequential closed-candle replay. Never reads a future candle.
function create(){return {bars:[],count:0,last:0,zone:null,candidate:0,legs:{BUY:{origin:null,extreme:null,big:false,pulled:false},SELL:{origin:null,extreme:null,big:false,pulled:false}},event:null};}
function step(previous,bar){
 const s=JSON.parse(JSON.stringify(previous||create()));
 if(!bar||bar.confirmed!==true||!['time','open','high','low','close'].every(k=>Number.isFinite(bar[k]))||bar.time<=s.last||bar.low>Math.min(bar.open,bar.close)||bar.high<Math.max(bar.open,bar.close))return s;
 s.last=bar.time;s.count++;s.event=null;const emit=code=>{s.event=code;};
 const direction=Math.sign(bar.close-bar.open),before=s.bars.at(-1);
 s.bars.push({...bar});s.bars=s.bars.slice(-6);
 if(s.zone){
  const outside=bar.close>s.zone.high?1:bar.close<s.zone.low?-1:0;
  if(s.candidate){
   if(outside===s.candidate&&(outside===1?bar.low>s.zone.high:bar.high<s.zone.low)){
    s.zone=null;s.candidate=0;s.bars=[{...bar}];emit('CHOP_RELEASE');
   }else{s.candidate=0;emit('BREAKOUT_FAILED');}
  }else if(outside){s.candidate=outside;emit('BREAKOUT_WAIT');}
 }else if(s.bars.length===6){
  let last=0,flips=0;for(const b of s.bars){const d=Math.sign(b.close-b.open);if(d){if(last&&last!==d)flips++;last=d;}}
  const highAtr=Number.isFinite(bar.atr)&&bar.atr>4.5&&flips>=2;
  if(flips>=3||highAtr){s.zone={low:Math.min(...s.bars.map(b=>b.low)),high:Math.max(...s.bars.map(b=>b.high)),at:bar.time,reason:highAtr?'HIGH_ATR_REVERSALS':'REVERSALS',atrAtTrigger:Number.isFinite(bar.atr)?bar.atr:null,flips};s.candidate=0;emit('CHOP_BLOCK');}
 }
 for(const side of ['BUY','SELL']){
  const d=side==='BUY'?1:-1,l=s.legs[side];
  if(l.origin===null&&direction===d){l.origin=bar.open;l.extreme=d===1?bar.high:bar.low;}
  if(l.origin===null)continue;
  const oldExtreme=l.extreme;
  l.extreme=d===1?Math.max(l.extreme,bar.high):Math.min(l.extreme,bar.low);
  const distance=d*(l.extreme-l.origin),pullback=d*(l.extreme-bar.close);
  if(l.big&&l.pulled&&d*(l.extreme-oldExtreme)>0)l.pulled=false;
  if(!l.big&&distance>6){l.big=true;l.pulled=false;emit('BIG_BLOCK');}
  else if(l.big&&!l.pulled&&pullback>=distance*.4){l.pulled=true;emit('PULLBACK_READY');}
  else if(l.big&&l.pulled&&before&&direction===d&&(d===1?bar.close>before.high:bar.close<before.low)){
   l.big=false;l.pulled=false;l.origin=null;l.extreme=null;emit('BIG_RELEASE');
  }else if(!l.big&&direction&&direction!==d){l.origin=null;l.extreme=null;}
 }

 return s;
}
function evidence(s){const bigSides=['BUY','SELL'].filter(k=>s.legs[k].big);return {version:VERSION,barTime:s.last,ready:s.count>=6,chopBlocked:!!s.zone,zone:s.zone,breakoutSide:s.candidate,bigBlocked:bigSides.length>0,bigSides,legs:s.legs,event:s.event};}
function allowed(e,side,time){return !!e&&e.version===VERSION&&e.ready===true&&e.barTime===time&&e.chopBlocked===false&&typeof e.bigBlocked==='boolean'&&Array.isArray(e.bigSides)&&e.bigSides.every(x=>['BUY','SELL'].includes(x))&&e.bigBlocked===(e.bigSides.length>0)&&!e.bigSides.includes(side);}

const price=n=>Number.isFinite(n)?n.toFixed(2):'—';
function message(e){
 const titles={CHOP_BLOCK:'⛔ SEKAT ENTRY — MARKET LIBAS',BREAKOUT_WAIT:'⏳ HARGA KELUAR ZON — TUNGGU PENGESAHAN',BREAKOUT_FAILED:'⛔ BREAKOUT GAGAL — SEKATAN KEKAL',CHOP_RELEASE:'✅ PENGESAHAN KELUAR ZON LULUS',BIG_BLOCK:'⚠️ PERGERAKAN LEBIH USD6 — JANGAN KEJAR',PULLBACK_READY:'⏳ PULLBACK 40% DICAPAI — TUNGGU MOMENTUM',BIG_RELEASE:'✅ PULLBACK DAN MOMENTUM DISAHKAN'};
 if(!titles[e?.event])return null;
 const lines=[titles[e.event],'XAUUSD · TF2 · Candle sudah tutup'];
 if(e.zone?.reason==='HIGH_ATR_REVERSALS')lines.push('ATR8 '+price(e.zone.atrAtTrigger)+' >4.50 + '+e.zone.flips+' pertukaran arah.');
 if(e.zone)lines.push('Zon libas: '+price(e.zone.low)+' – '+price(e.zone.high));
 if(e.bigBlocked)lines.push('Sekat kejar '+e.bigSides.join(' / ')+'. Tunggu pullback 40% dan momentum kembali.');
 if(e.chopBlocked)lines.push('BUY / SELL disekat. Tunggu breakout dan satu candle penuh di luar zon.');
 lines.push('Panduan ZenCore — '+(e.chopBlocked?'Jangan entry ketika harga masih berulang-alik.':e.bigBlocked?'Jangan kejar harga. Ini bukan signal entry.':'Sekatan ini selesai. Entry masih perlu signal baharu dan SOP lengkap.'));
 return lines.join('\n');
}
function signal(m,now=Date.now()){
 const e=m?.setupMeta?.entrySafety;if(m?.symbol!=='XAUUSD'||String(m.timeframe)!=='2'||m.feedChannel!=='EXECUTION'||m.confirmed!==true||e?.version!==VERSION||e.barTime!==(m.sourceBarTime??m.time)||!require('./tf2-bar-close').confirmed(m)||now-m.signalObservedAt>60000||now-m.signalObservedAt< -5000)return null;
 const text=message(e);return text?{kind:'GUIDE',symbol:'XAUUSD',timeframe:'2',time:m.signalObservedAt,guideText:text,guideValidUntil:m.signalObservedAt+60000,notificationKey:[VERSION,e.barTime,e.event].join('|')}:null;
}
module.exports={VERSION,create,step,evidence,allowed,message,signal};
