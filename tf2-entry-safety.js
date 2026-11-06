'use strict';
const VERSION='TF2_ATR_REVERSALS_V2';
const price=n=>Number.isFinite(n)?n.toFixed(2):'—';
function create(){return {bars:[],last:0,ready:false,blocked:false,atr:null,flips:0,reason:null,event:null};}
function step(previous,bar){
 const s=JSON.parse(JSON.stringify(previous||create()));
 if(!bar||bar.confirmed!==true||!['time','open','high','low','close'].every(k=>Number.isFinite(bar[k]))||bar.time<=s.last||bar.low>Math.min(bar.open,bar.close)||bar.high<Math.max(bar.open,bar.close))return s;
 const wasBlocked=s.blocked,oldReason=s.reason;
 s.last=bar.time;s.bars.push({...bar});s.bars=s.bars.slice(-6);s.event=null;
 s.atr=Number.isFinite(bar.atr)&&bar.atr>0?bar.atr:null;s.ready=s.bars.length===6&&s.atr!==null;
 let last=0;s.flips=0;for(const b of s.bars){const d=Math.sign(b.close-b.open);if(d){if(last&&last!==d)s.flips++;last=d;}}
 s.blocked=s.ready&&s.flips>=2&&(s.atr>4.5||s.atr<1.5);
 s.reason=s.blocked?(s.atr>4.5?'HIGH_ATR_REVERSALS':'LOW_ATR_REVERSALS'):null;
 if(s.blocked&&(!wasBlocked||oldReason!==s.reason))s.event='CHOP_BLOCK';
 else if(wasBlocked&&!s.blocked&&s.ready)s.event='CHOP_RELEASE';
 return s;
}
function evidence(s){return {version:VERSION,barTime:s.last,ready:s.ready,chopBlocked:s.blocked,atr:s.atr,flips:s.flips,reason:s.reason,event:s.event};}
function allowed(e,side,time){
 if(!e||e.version!==VERSION||e.ready!==true||e.barTime!==time||!Number.isFinite(e.atr)||e.atr<=0||!Number.isInteger(e.flips)||e.flips<0||e.flips>5)return false;
 const blocked=e.flips>=2&&(e.atr>4.5||e.atr<1.5);
 return e.chopBlocked===false&&!blocked;
}
function message(e){
 if(!['CHOP_BLOCK','CHOP_RELEASE'].includes(e?.event))return null;
 return [e.event==='CHOP_BLOCK'?'⛔ TF2 — SEKAT ENTRY':'✅ TF2 — SEKATAN DILEPASKAN','XAUUSD · Candle sudah tutup',
 'ATR8: '+price(e.atr)+' · Pertukaran arah: '+e.flips+'/6 candle',
 e.event==='CHOP_BLOCK'?(e.atr>4.5?'ATR tinggi + candle bertukar arah. Market sangat volatile, mudah libas. Entry disekat.':'ATR rendah + candle bertukar arah. Market terlalu perlahan dan berulang-alik, mudah libas. Entry disekat.'):'Syarat sekatan tidak lagi dipenuhi.',
 'Panduan ZenCore — '+(e.event==='CHOP_BLOCK'?'Tunggu. Jangan buka BUY / SELL atau re-entry.':'Entry kembali ikut SOP asal dan signal baharu yang sah. Ini bukan arahan entry.')].join('\n');
}
function signal(m,now=Date.now()){
 const e=m?.setupMeta?.entrySafety;if(m?.symbol!=='XAUUSD'||String(m.timeframe)!=='2'||m.feedChannel!=='EXECUTION'||m.confirmed!==true||e?.version!==VERSION||e.barTime!==(m.sourceBarTime??m.time)||!require('./tf2-bar-close').confirmed(m)||now-m.signalObservedAt>60000||now-m.signalObservedAt< -5000)return null;
 const text=message(e);return text?{kind:'GUIDE',symbol:'XAUUSD',timeframe:'2',time:m.signalObservedAt,guideText:text,guideValidUntil:m.signalObservedAt+60000,notificationKey:[VERSION,e.barTime,e.event].join('|')}:null;
}
module.exports={VERSION,create,step,evidence,allowed,message,signal};
