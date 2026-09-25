'use strict';

// Notification state only. Never changes Analysis decisions or popup events.
function prepareTelegram(previous, next, events) {
  const entry=next.items.find(e=>e.kind==='ENTRY');
  const close=next.items.find(e=>e.kind==='CLOSE');
  const anchor=entry?.signature.split('|').slice(0,2).join('|');
  const oldAnchor=previous?.entry?.split('|').slice(0,2).join('|');
  let position=previous?.telegramPosition || (oldAnchor?{side:oldAnchor.split('|')[0],anchor:oldAnchor,closed:false}:null);
  position=position?{...position}:null;
  let newEntry=false;
  if(entry && !close){
    const eventExists=events.some(e=>e.kind==='ENTRY');
    if(eventExists && (!position || position.side!==entry.side || (position.closed && (position.idle || anchor!==position.anchor)))){
      position={side:entry.side,anchor,closed:false,idle:false};newEntry=true;
    }
  }
  if(position && close?.percent===100)position.closed=true;
  if(position?.closed && !entry)position.idle=true;
  next.telegramPosition=position;
  return events.map(e=>({...e,telegramVersion:1,telegramDuplicate:e.kind==='ENTRY'&&!newEntry}));
}

const numeric=v=>v===null||v===undefined||v===''?null:Number.isFinite(Number(v))?Number(v):null;
const price=v=>numeric(v)===null?'—':new Intl.NumberFormat('en-US',{minimumFractionDigits:2,maximumFractionDigits:8}).format(Number(v));

// Mirrors the existing displayed qualityLayer in precision-entry.js. This is
// a message label only: both high and ordinary READY entries are delivered.
function messageQuality(m){
  const numeric=v=>Number.isFinite(+v)?+v:null; // Same conversion as the displayed quality layer.
  const n=m.strategyNormal||{}, s=n.sop||{}, p=n.plan||{};
  const side=String(n.side||'WAIT').toUpperCase(), forecast=String(s.forecast||'WAIT').toUpperCase();
  const power=numeric(s.marketPower), green=numeric(s.sopGreen)||0;
  const conf=numeric(m.predictionConfidence)||0, stability=numeric(m.stability)||0;
  const stars=numeric(m.confluence)||0, probability=numeric(m.setupProbability)||0;
  const gates=(Array.isArray(s.gates)?s.gates:[]).filter(g=>g.pass).length;
  const entry=numeric(p.entry), sl=numeric(p.sl), tp=numeric(p.tp3);
  const risk=entry!==null&&sl!==null?Math.abs(entry-sl):0;
  const rr=entry!==null&&tp!==null&&risk>0?Math.abs(tp-entry)/risk:numeric(m.rr);
  const directional=((side==='BUY'&&forecast==='BULLISH')||(side==='SELL'&&forecast==='BEARISH'))&&power!==null&&power>=65;
  const neutral=forecast==='NEUTRAL'&&power!==null&&((side==='BUY'&&power>50)||(side==='SELL'&&power<50));
  const score=(gates===5?25:0)+(green>=5?15:green>=4?10:0)+(directional?15:neutral?6:0)+
    (m.sidewaysGuard?0:10)+(conf>=80?10:conf>=70?6:0)+(stability>=75?10:stability>=65?5:0)+
    (stars>=4?5:stars>=3?3:0)+(probability>=70?5:probability>=60?3:0)+(rr!==null&&rr>=2?5:0);
  return {score,high:String(n.state||'').toUpperCase()==='READY'&&score>=80&&!m.sidewaysGuard};
}

function winRecord(summary){
  const wins=numeric(summary?.wins), resolved=numeric(summary?.resolved);
  if(wins===null||resolved===null||!Number.isInteger(wins)||!Number.isInteger(resolved)||resolved<=0||wins<0||wins>resolved)
    return 'Win rate rekod: Belum tersedia';
  return `Win rate rekod: ${(wins/resolved*100).toFixed(1)}% (${wins}/${resolved} validasi selesai)\nRekod simulasi Normal bagi pair ini${resolved<20?' · sampel awal':''}; bukan peluang menang signal ini.`;
}

function telegramMessage(e, summary){
  const time=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Kuala_Lumpur',day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(e.time));
  const footer=`Masa: ${time} MYT\nRujukan: ZC-${e.id}\nAlert Analysis • bukan pengesahan transaksi MT5`;
  if(e.kind!=='ENTRY')return `ZENCORE | PENGURUSAN POSISI\n\n${e.message}\n\n${footer}`;
  const p=e.telegramPlan, q=e.telegramQuality;
  if(!p||!q)return `ZENCORE | SIGNAL ENTRY\n\n${e.message}\n\nWin rate rekod: Belum tersedia\n\n${footer}`;
  return `ZENCORE | SIGNAL ENTRY\n${e.symbol} • ${e.side} • NORMAL 3M\n\n`+
    `Entry: ${price(p.entry)}\nStop Loss: ${price(p.sl)}\nTP1: ${price(p.tp1)}\nTP2: ${price(p.tp2)}\nTP3: ${price(p.tp3)}\n\n`+
    `Penilaian: ${q.high?'POTENSI TINGGI':'BIASA'}\nSkor kualiti Analysis: ${q.score}/100\n${winRecord(summary)}\n\n`+
    `Ulasan: ${q.high?'SOP sah dan kualiti Analysis tinggi.':'SOP entry sah; kualiti Analysis pada tahap biasa.'}\n\n${footer}`;
}
module.exports={prepareTelegram,messageQuality,telegramMessage,winRecord};
