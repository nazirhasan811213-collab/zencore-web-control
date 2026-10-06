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
    const distinctSetup=entry.setupKey&&position?.setupKey&&entry.setupKey!==position.setupKey;
    // Adopt a key for an already-announced legacy position without announcing it again.
    if(position&&!position.setupKey&&entry.setupKey&&anchor===position.anchor)position.setupKey=entry.setupKey;
    const freshReentry=/^(NORMAL|HIGH)_REENTRY$/.test(entry.entryType)&&Number.isFinite(entry.sourceBarTime)&&entry.sourceBarTime>0;
    if(eventExists && (distinctSetup || freshReentry || !position || position.side!==entry.side || (position.closed && (position.idle || anchor!==position.anchor)))){
      position={side:entry.side,anchor,setupKey:entry.setupKey||null,closed:false,idle:false};newEntry=true;
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
const {entryQuality}=require('./analysis-execution-contract');
function messageQuality(m){return entryQuality(m);}
const SOP_VERSION='SOLID_TF2_3GREEN_HEMA23_V2';
function entrySopAllowed(e){
  const s=e.telegramSop;
  if(String(s?.version||'').includes('_SEQ_ATR40_')&&
    (s.gates?.length!==7||s.pullback?.pass!==true||!s.gates.some(g=>g.key==='pullback'&&g.pass===true)))return false;
  if(String(s?.version||'').startsWith('NORMAL_20261001_') &&
    (!['2','15'].includes(String(e.timeframe)) || s.tf!==String(e.timeframe)+'m' ||
    (e.telegramMarket?.timeframe!=null && String(e.telegramMarket.timeframe)!==String(e.timeframe))))return false;
  if(['NORMAL_20261001_TF2_V2','NORMAL_20261001_TF2_SEQ_V3','NORMAL_20261001_TF2_SEQ_ATR40_V4'].includes(s?.version)&&s.tf==='2m'||['NORMAL_20261001_TF15_V2','NORMAL_20261001_TF15_SEQ_ATR40_V4'].includes(s?.version)&&s.tf==='15m')
    return ['XAUUSD'].includes(e.symbol)&&s.solid===true&&s.green>=4&&
      Array.isArray(s.gates)&&[6,7].includes(s.gates.length)&&s.gates.every(g=>g.pass===true)&&s['hema'+s.tf.replace('m','')]?.mode===e.side&&
      s['hema'+(s.tf==='15m'?'30':'3')]?.mode===e.side&&numeric(e.telegramQuality?.score)>=50;
  const valid=s?.version===SOP_VERSION&&s.tf==='2m'||s?.version==='SOLID_TF15_3GREEN_HEMA1545_2L_V1'&&s.tf==='15m';
  return valid&&['XAUUSD'].includes(e.symbol)&&s.solid===true&&s.green>=3&&Array.isArray(s.gates)&&s.gates.length===6&&s.gates.every(g=>g.pass===true);
}
function qualityGrade(score){return score>=90?'A+':score>=80?'A':score>=70?'B+':score>=60?'B':score>=50?'C+':'C';}

// Current bridge supplies confirmed candle OPEN time in milliseconds.
// Entry transport expires 30 seconds after both reception and candle close.
function entryFresh(e,now=Date.now()){
  const q=e.telegramMarket;
  if(q?.feedMode==='INTRABAR')return Number.isFinite(q.signalObservedAt)&&now-q.signalObservedAt>=-5000&&now-q.signalObservedAt<=30000&&now-e.time>=-5000&&now-e.time<=30000;
  const duration=Number(q?.timeframe)*60000;
  if(!q || q.feedMode!=='BAR-CLOSE' || !Number.isFinite(duration) || duration<=0 ||
     !Number.isFinite(q.sourceBarTime) || q.sourceBarTime<=0 || numeric(q.price)===null)return false;
  const close=q.sourceBarTime+duration;
  return now-e.time>=-5000 && now-e.time<=30000 && now-close>=-5000 && now-close<=30000;
}

function telegramMessage(e){
  const time=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Kuala_Lumpur',day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(new Date(e.time));
  const footer=`Masa: ${time} MYT\nRujukan: ZC-${e.id}\nAlert Analysis • bukan pengesahan transaksi MT5`;
  if(e.kind!=='ENTRY')return `ZENCORE | PENGURUSAN POSISI TF${e.timeframe||'2'}\n\n${e.message}\n\n${footer}`;
  const p=e.telegramPlan, q=e.telegramQuality;
  if(/^NORMAL_20261001_TF(2_V2|15_V2|2_SEQ_V3|2_SEQ_ATR40_V4|15_SEQ_ATR40_V4)$/.test(e.telegramSop?.version||'')){
    const s=e.telegramSop,tf=s.tf.replace('m','');
    if(!entrySopAllowed(e)||!p)return `ZENCORE | ENTRY TIDAK DISAHKAN\n\n${footer}`;
    return `ZENCORE | SOLID ENTRY TF${tf} • ${tf==='15'?'INTRA':'SCALPING'}\n${e.symbol} • ${e.side}\nSOP 1/10/2026\n\n`+
      `SOLID: ${s.version.includes('_SEQ_')?'SETUP DIPEGANG':'PASS'}\nHarga lepas entry: PASS\nChecklist: ${s.green}/5 hijau\nForecast: ${s.forecast} ${s.power}%\n${s.pullback?`Pullback: ${s.pullback.required?'40% • PASS':'Candle biasa'}\n`:''}HEMA TF${tf}: ${s['hema'+tf]?.mode||'WAIT_DATA'}\nHEMA TF${tf==='15'?'30':'3'}: ${s['hema'+(tf==='15'?'30':'3')]?.mode||'WAIT_DATA'}\nGred: ${q.grade} (${q.score}/100)\n\n`+
      `Entry SOP: ${price(p.entry)}\nStop Loss: ${price(p.sl)}\nTP1: ${price(p.tp1)}\nTP2: ${price(p.tp2)}\nTP3: ${price(p.tp3)}\n\n${footer}`;
  }
  if([SOP_VERSION,'SOLID_TF15_3GREEN_HEMA1545_2L_V1'].includes(e.telegramSop?.version)){
    const tf15=e.telegramSop.tf==='15m',tf=tf15?'15':'2',higher=tf15?'45':'3';
    const s=e.telegramSop;
    if(!entrySopAllowed(e)||!p)return `ZENCORE | ENTRY TIDAK DISAHKAN\n\n${footer}`;
    return `ZENCORE | SOLID ENTRY TF${tf} • ${tf15?'INTRA':'SCALPING'}\n${e.symbol} • ${e.side}\n\n`+
      `SOLID: PASS\nChecklist: ${s.green}/5 hijau\nForecast 10 candle: ${s.forecast} ${s.power}%\n${s.pullback?`Pullback: ${s.pullback.required?'40% • PASS':'Candle biasa'}\n`:''}HEMA TF${tf}: ${(tf15?s.hema15:s.hema2)?.state||'WAIT'}\nHEMA TF${higher} confirmed: ${(tf15?s.hema45:s.hema3)?.state||'WAIT'}\n\n`+
      `Entry SOP: ${price(p.entry)}\nStop Loss: ${price(p.sl)}\nTP1: ${price(p.tp1)}\nTP2: ${price(p.tp2)}\nTP3: ${price(p.tp3)}\n\n`+
      `Harga feed: ${price(e.telegramMarket?.price)}\nFeed: ${e.telegramMarket?.feedMode==='INTRABAR'?'REALTIME • candle belum tutup':'candle '+tf+'M ditutup'}\nSOP confirmation lengkap; bukan jaminan profit.\n\n${footer}`;
  }
  if(!p||!q)return `ZENCORE | SIGNAL ENTRY\n\n${e.message}\n\nA+ PROFIT QUALITY\nQuality: Belum tersedia\n\n${footer}`;
  return `ZENCORE | SIGNAL ENTRY TF${e.timeframe}\n${e.symbol} • ${e.side} • ${e.timeframe==='15'?'INTRA':'SCALPING'}\n\n`+
    `Entry SOP: ${price(p.entry)}\nStop Loss: ${price(p.sl)}\nTP1: ${price(p.tp1)}\nTP2: ${price(p.tp2)}\nTP3: ${price(p.tp3)}\n\n`+
    `Harga feed ketika signal: ${price(e.telegramMarket?.price)}\nFeed: candle ${e.telegramMarket?.timeframe||'3'}M ditutup\n\n`+
    `A+ PROFIT QUALITY\nGred: ${qualityGrade(q.score)} • Quality: ${q.score}/100\nStatus: ${q.high?'POTENSI TINGGI':'VALID SOP • LOW QUALITY'}\n\n`+
    `Ulasan: ${q.high?'SOP READY dan quality tinggi. Semak harga entry, SL dan saiz risiko sebelum execute.':'Signal SOP sah, tetapi quality belum 80/100. Untuk precision mode, pertimbang skip setup ini.'}\n\nQuality menilai setup semasa; bukan jaminan profit.\n\n${footer}`;
}
module.exports={prepareTelegram,messageQuality,telegramMessage,qualityGrade,entryFresh,entrySopAllowed};
