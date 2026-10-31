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
    const freshReentry=!entry.setupKey&&/^(NORMAL|HIGH)_REENTRY$/.test(entry.entryType)&&Number.isFinite(entry.sourceBarTime)&&entry.sourceBarTime>0;
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
const price=v=>numeric(v)===null?'—':new Intl.NumberFormat('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}).format(Number(v));

// Mirrors the existing displayed qualityLayer in precision-entry.js. This is
// a message label only: both high and ordinary READY entries are delivered.
const {entryQuality}=require('./analysis-execution-contract');
function messageQuality(m){return entryQuality(m);}
const SOP_VERSION='SOLID_TF2_3GREEN_HEMA23_V2';
function entrySopAllowed(e){
 if(e.timeframe==='2'&&e.telegramSop?.entryCandle&&!require('./tf2-ribbon-scalping').candlePass(e.telegramSop.entryCandle,e.side,e.telegramMarket?.sourceBarTime))return false;
 if(e.timeframe==='2'&&e.telegramSop?.entrySafety&&!require('./tf2-entry-safety').allowed(e.telegramSop.entrySafety,e.side,e.telegramMarket?.sourceBarTime))return false;
 if(e.timeframe==='2'&&e.telegramSop?.decisionTimingVersion==='TF2_BAR_CLOSE_V1'&&!require('./tf2-bar-close').confirmed({...e.telegramMarket,strategyNormal:{sop:e.telegramSop}}))return false;
 if(require('./setup-lifecycle').supported(e.telegramSop?.lifecycleVersion)&&e.telegramSop?.cycleKind==='FOLLOWUP'&&!require('./setup-lifecycle').reentry(e.side,e.telegramSop,e.telegramSop.reentryContext?.parentQualifiedAt,e.telegramSop.signalObservedAt))return false;
  if(/^(1|true|yes|on)$/i.test(process.env.ZENCORE_ENTRY_SIGNALS_PAUSED||''))return false;
  const s=e.telegramSop;
 if(s?.entryPolicyVersion==='PINE_SOLID_PRICE_WT_HEMA_V6'&&(!require('./setup-lifecycle').supported(s.lifecycleVersion)||s.lifecycleVersion!=='CLOSED_PAUSE_RESUME_V2'||!['INITIAL','FOLLOWUP'].includes(s.cycleKind)||s.currentBar?.confirmed!==true||(e.timeframe==='2'&&(!s.entryCandle||!s.entrySafety))))return false;
  if(['NORMAL_20261001_TF2_SOLID80_SCALP_CAP_V14','NORMAL_20261001_TF2_SOLID_HOLD_V15','NORMAL_20261001_TF2_SOLID_HOLD_V16'].includes(s?.version)&&!require('./analysis-execution-contract').tf2ScalpPlanPass(e.side,e.telegramPlan,['NORMAL_20261001_TF2_SOLID_HOLD_V15','NORMAL_20261001_TF2_SOLID_HOLD_V16'].includes(s.version)?s.riskAtrReference:s.atrReference))return false;
  if(s?.version==='NORMAL_20261001_TF15_RIBBON_V1')return e.timeframe==='15'&&s.tf==='15m'&&e.symbol==='XAUUSD'&&s.solid===true&&s.solidHoldActive===true&&s.solidClosedAt==null&&require('./tf15-intraday').confirmations(e.side,{...s,sopGreen:s.green,marketPower:s.power}).pass&&['PINE_3TRIGGERS_3OF4_CHOP50_V3','PINE_3TRIGGERS_3OF4_FORECAST45_V4','PINE_SOLID_3OF4_FORECAST45_V5','PINE_SOLID_PRICE_WT_HEMA_V6'].includes(s.entryPolicyVersion)&&require('./tf15-intraday').planPass(e.side,e.telegramPlan,s);
  if(s?.version==='NORMAL_20261001_TF2_RIBBON_V1')return e.timeframe==='2'&&s.tf==='2m'&&e.symbol==='XAUUSD'&&s.solid===true&&s.solidHoldActive===true&&s.solidClosedAt==null&&require('./tf2-ribbon-scalping').confirmations(e.side,{...s,sopGreen:s.green,marketPower:s.power}).pass&&['PINE_3TRIGGERS_3OF4_CHOP50_V3','PINE_3TRIGGERS_3OF4_FORECAST45_V4','PINE_SOLID_3OF4_FORECAST45_V5','PINE_SOLID_PRICE_WT_HEMA_V6'].includes(s.entryPolicyVersion)&&require('./tf2-ribbon-scalping').planPass(e.side,e.telegramPlan,s);
  if(s?.version==='NORMAL_20261001_TF3_RIBBON_V1')return e.timeframe==='3'&&s.tf==='3m'&&e.symbol==='XAUUSD'&&s.solid===true&&s.solidHoldActive===true&&s.solidClosedAt==null&&require('./tf3-scalping').confirmations(e.side,{...s,sopGreen:s.green,marketPower:s.power}).pass&&s.entryPolicyVersion==='PINE_3TRIGGERS_3OF4_CHOP50_V3'&&require('./tf3-scalping').planPass(e.side,e.telegramPlan,s);
  if(['NORMAL_20261001_TF2_SOLID_80PCT_LIVE_V13','NORMAL_20261001_TF2_SOLID80_SCALP_CAP_V14','NORMAL_20261001_TF2_SOLID_HOLD_V15','NORMAL_20261001_TF2_SOLID_HOLD_V16'].includes(s?.version))return e.timeframe==='2'&&s.tf==='2m'&&e.symbol==='XAUUSD'&&require('./analysis-execution-contract').solid80Tf2Confirmations(e.side,{...s,sopGreen:s.green,marketPower:s.power},['NORMAL_20261001_TF2_SOLID_HOLD_V15','NORMAL_20261001_TF2_SOLID_HOLD_V16'].includes(s.version),s.version==='NORMAL_20261001_TF2_SOLID_HOLD_V16'?5:6);
  if(['NORMAL_20261001_TF2_CURRENT_SOLID_HEMAPRICE_V7','NORMAL_20261001_TF2_SEP24_HEMA5_V8'].includes(s?.version))return e.timeframe==='2'&&s.tf==='2m'&&e.symbol==='XAUUSD'&&
    require('./analysis-execution-contract').currentSolidTf2Confirmations({side:e.side,solid:s.solid,green:s.green,forecast:s.forecast,power:s.power,
      minimumGreen:s.version.includes('SEP24')?4:3,price:s.version.includes('SEP24')?s.hema2?.price:e.telegramMarket?.price,fast:s.hema2?.fast,slow:s.hema2?.slow,gates:s.gates})&&numeric(e.telegramQuality?.score)>=50&&s.eaEntryCompatible!==false;

  const revised=['NORMAL_20261001_TF2_TP1_HEMAGAP_V5','NORMAL_20261001_TF2_SEQ_TP1_HEMAGAP_V5','NORMAL_20261001_TF2_SEQ_ATR40_TP1_HEMAGAP_V5'].includes(s?.version);
  if(revised){
    if(s.version.includes('_SEQ_ATR40_')&&(!(s.tf==='2m'?[6,7]:[7]).includes(s.gates?.length)||s.pullback?.pass!==true||!s.gates.some(g=>g.key==='pullback'&&g.pass===true)))return false;
    if(e.telegramMarket?.timeframe!=null&&String(e.telegramMarket.timeframe)!=='2')return false;
    const power=numeric(s.power),forecast=String(s.forecast||'').toUpperCase();
    if(power===null||power<0||power>100||!(e.side==='BUY'?(forecast==='NEUTRAL'&&power>50||forecast==='BULLISH'&&power>40):e.side==='SELL'&&(forecast==='NEUTRAL'&&power<50||forecast==='BEARISH'&&power>40)))return false;
    if(e.timeframe!=='2'||s.tf!=='2m'||e.symbol!=='XAUUSD'||s.solid!==true||s.green<3||numeric(e.telegramQuality?.score)<50||
      !Array.isArray(s.gates)||![5,6,7].includes(s.gates.length)||!s.gates.every(g=>g.pass===true))return false;
    const atr=numeric(s.atrReference??s.hema2?.atrReference);
    if(atr===null||atr<=0)return false;
    for(const key of ['hema2']){
      const r=s[key]||{},fast=numeric(r.fast),slow=numeric(r.slow);
      if(fast===null||slow===null||Math.abs(fast-slow)<=atr*.10||(e.side==='BUY'?fast<=slow:e.side==='SELL'?fast>=slow:true))return false;
    }
    return s.eaEntryCompatible!==false;
  }

  if(String(s?.version||'').includes('_SEQ_ATR40_')&&
    (!(s.tf==='2m'?[6,7]:[7]).includes(s.gates?.length)||s.pullback?.pass!==true||!s.gates.some(g=>g.key==='pullback'&&g.pass===true)))return false;
  if(String(s?.version||'').startsWith('NORMAL_20261001_') &&
    (!['2','15'].includes(String(e.timeframe)) || s.tf!==String(e.timeframe)+'m' ||
    (e.telegramMarket?.timeframe!=null && String(e.telegramMarket.timeframe)!==String(e.timeframe))))return false;
  if(['NORMAL_20261001_TF2_V2','NORMAL_20261001_TF2_SEQ_V3','NORMAL_20261001_TF2_SEQ_ATR40_V4'].includes(s?.version)&&s.tf==='2m'||['NORMAL_20261001_TF15_V2','NORMAL_20261001_TF15_SEQ_ATR40_V4'].includes(s?.version)&&s.tf==='15m')
    return ['XAUUSD'].includes(e.symbol)&&s.solid===true&&s.green>=4&&
      Array.isArray(s.gates)&&(s.tf==='2m'?[5,6,7]:[6,7]).includes(s.gates.length)&&s.gates.every(g=>g.pass===true)&&s['hema'+s.tf.replace('m','')]?.mode===e.side&&
      (s.tf==='2m'||s.hema30?.mode===e.side)&&numeric(e.telegramQuality?.score)>=50;
  const valid=s?.version===SOP_VERSION&&s.tf==='2m'||s?.version==='SOLID_TF15_3GREEN_HEMA1545_2L_V1'&&s.tf==='15m';
  return valid&&['XAUUSD'].includes(e.symbol)&&s.solid===true&&s.green>=3&&Array.isArray(s.gates)&&s.gates.length===6&&s.gates.every(g=>g.pass===true);
}
function qualityGrade(score){return score>=90?'A+':score>=80?'A':score>=70?'B+':score>=60?'B':score>=50?'C+':'C';}

// Current bridge supplies confirmed candle OPEN time in milliseconds.
// Entry transport expires 30 seconds after both reception and candle close.
function entryFresh(e,now=Date.now()){
  const q=e.telegramMarket;
  if(['PINE_3TRIGGERS_3OF4_CHOP50_V3','PINE_3TRIGGERS_3OF4_FORECAST45_V4','PINE_SOLID_3OF4_FORECAST45_V5','PINE_SOLID_PRICE_WT_HEMA_V6'].includes(e.telegramSop?.entryPolicyVersion)){
    const origin=q?.entryAuthorizedAt??q?.signalObservedAt;
    return Number.isFinite(origin)&&now-origin>=-5000&&now-origin<=60000&&now-e.time>=-5000&&now-e.time<=(e.timeframe==='2'||e.telegramSop?.entryPolicyVersion==='PINE_SOLID_PRICE_WT_HEMA_V6'?60000:30000);
  }
  if(q?.feedMode==='INTRABAR')return Number.isFinite(q.signalObservedAt)&&now-q.signalObservedAt>=-5000&&now-q.signalObservedAt<=30000&&now-e.time>=-5000&&now-e.time<=30000;
  const duration=Number(q?.timeframe)*60000;
  if(!q || q.feedMode!=='BAR-CLOSE' || !Number.isFinite(duration) || duration<=0 ||
     !Number.isFinite(q.sourceBarTime) || q.sourceBarTime<=0 || numeric(q.price)===null)return false;
  const close=q.sourceBarTime+duration;
  return now-e.time>=-5000 && now-e.time<=30000 && now-close>=-5000 && now-close<=30000;
}

// One bounded plain-text context from the persisted entry snapshot, never a later market read.
function analysisContext(s={}){
 const d=s.advisor||{},text=(v,n=220)=>typeof v==='string'&&v.trim()?v.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g,'').slice(0,n).replace(/[\uD800-\uDBFF]$/,''):'Tiada data';
 return `ANALYSIS SEMASA\nTrend: ${text(d.trend)}\nMomentum: ${text(d.momentum)}\nMTF sync: ${text(d.mtfOverall)} • skor ${s.mtfScore}\nForecast: ${s.forecast} • ${s.power} (skor)\nChecklist: ${s.green}/5\n\nRUMUSAN AI\n${text(d.mtfSummary,420)}\n\nAI COACH / RESULT\n${text(d.aiCoach,850)}\n\nCOACH TIPS\n${text(d.proTip,300)}\n\nNASIHAT\n${text(d.advice,300)}`;
}

function riskText(value){return String(value||'').replace(/(?:🛑\s*)?JAGA MODAL[.\s—-]*JANGAN TRADE!?/gi,'SETUP HIGH RISK JAGA SAIZ LAYER DAN LOT').replace(/(?:❌\s*)?SETUP KURANG PADU[.!]?/gi,'SETUP HIGH RISK JAGA SAIZ LAYER DAN LOT');}
function pineContext(s={},tf){
 const d=s.advisor||{},clean=v=>riskText(v).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g,'').trim();
 const short=(v,n=100)=>clean(v).slice(0,n)||'Tiada data';
 const lines=['📊 ANALYSIS SEMASA',`Trend: ${short(d.trend)}`,`Movement: ${short(d.momentum)}`,`HEMA Trend: ${s['hema'+tf]?.mode||'WAIT_DATA'}`,`Checklist Pine: ${s.green}/5`,`Forecast 10 candle: ${short(s.forecast,30)} ${s.power}%`,`MTF ${tf==='15'?'15/30/45':tf==='2'?'3/5/10':'5/10/15'}: ${s.mtfScore}`];
 // Keep dashboard facts once; Coach often repeats trend, momentum and advice.
 const seen=new Set(),key=v=>clean(v).replace(/[^\p{L}\p{N}]/gu,'').toLowerCase();
 function add(label,value,max=240){const text=clean(value);if(!text)return;const k=key(text);if(!k||seen.has(k))return;seen.add(k);lines.push(`${label}: ${text.slice(0,max)}`);}
 lines.push('','🧠 RUMUSAN & COACH');
 add('Rumusan AI',d.mtfSummary);
 const coach=clean(d.aiCoach);for(const tag of ['HALANGAN','WHALES']){const m=coach.match(new RegExp('\\['+tag+'\\]:\\s*([^\\n]+)'));if(m)add(tag==='HALANGAN'?'Halangan':'Whales',m[1],160);}
 add('Nasihat',d.advice,180);add('Coach tips',d.proTip,180);
 return lines.join('\n');
}
function entryAnalysis(e,s){
 const buy=e.side==='BUY',parts=[];
 if(s.solid===true)parts.push(`SOLID ${e.side} aktif`);
 const gates=Array.isArray(s.gates)?s.gates:[];
 const pass=key=>gates.some(g=>g.key===key&&g.pass===true);
 if(pass('entry'))parts.push(`harga ${buy?'di atas':'di bawah'} entry SOLID`);
 if(pass('hema'))parts.push(`HEMA ${buy?'hijau':'merah'}`);
 if(pass('wt'))parts.push(`momentum menyokong ${e.side}`);
 if(pass('forecast'))parts.push(`unjuran menyokong ${e.side}`);
 if(pass('mtf'))parts.push(`TF lain menyokong ${e.side}`);
 const lines=[`Sebab entry: ${parts.length?parts.join('; '):'Syarat SOP entry telah lulus'}.`];
 const waiting=gates.filter(g=>g.pass===false).map(g=>({entry:'harga belum lepas entry SOLID',wt:'momentum belum searah',forecast:'unjuran belum menyokong',sop:'checklist belum cukup',mtf:'TF lain belum searah'})[g.key]).filter(Boolean);
 if(waiting.length)lines.push(`Perhatian: ${waiting.join('; ')}.`);
 return lines;
}
function currentPineMessage(e,p,s={},time){
 const tf=e.timeframe||'2',reentry=s.cycleKind==='FOLLOWUP'||/REENTRY/.test(e.entryType||''),buy=e.side==='BUY';
 const reason=entryAnalysis(e,s).map(x=>x.replace(/^Sebab entry: /,'').replace(/; (HEMA|momentum)/,';\n$1')).join('\n');
 const risk=Math.abs(p.entry-p.sl),reward=Math.abs(p.tp1-p.entry);
 const summary=`Setup ${e.side} lulus pengesahan semasa. TP1 berjarak ${price(reward)} USD; risiko ke SL ${price(risk)} USD.`;
 const tips=reentry?`Guna pelan baharu selepas semua posisi TF${tf} disahkan tutup. Jangan tambah layer di luar tetapan.`:'Ikut lot/layer dan SL yang ditetapkan. Jangan tambah posisi untuk cover rugi.';
 return [
  `${buy?'🟢':'🔴'} ZENCORE | ${reentry?'RE-ENTRY':'ENTRY'} TF${tf} • ${tf==='15'?'INTRA':'SCALP'}`,
  `${e.symbol} • ${e.side}`,'',
  `Entry: ${price(p.entry)}`,`SL: ${price(p.sl)}`,`TP1: ${price(p.tp1)}`,`TP2: ${price(p.tp2)}`,`TP3: ${price(p.tp3)}`,'',
  'Sebab entry:',reason,
  ...(s.entryCandle?[`Candle entry: ${buy?'BULLISH':'BEARISH'}`]:[]),'',
  'Rumusan AI ZenCore:',summary,
  'Coach Tips:',tips,'',
  'Signal sahaja • semak order MT5.',`🕒 ${time} MYT • ZC-${e.id}`
 ].join('\n');
}

function closeMessage(e,time){
 const tf=e.timeframe||'2',half=e.percent===50,raw=String(e.message||'').split('\n');
 const reason=(raw[0]?.includes(e.symbol)&&raw[0]?.includes('TF')?raw.slice(1):raw).join(' ').replace(/[\x00-\x1f]/g,' ').trim().slice(0,90);
 return [`🛑 ZENCORE | ${half?'CLOSE SEPARUH (50%)':'CLOSE ALL'} TF${tf}`,e.symbol,
  half?`Tutup 50% posisi TF${tf}.`:`Tutup semua baki posisi TF${tf}.`,
  ...(reason?[`Sebab: ${reason==='Native chart close signal'?'Signal exit carta.':reason}`]:[]),
  'Panduan ZenCore — Semak close di MT5 sebelum entry baharu.',
  'Arahan sahaja • belum pengesahan close MT5.',`🕒 ${time} MYT • ZC-${e.id}`].join('\n');
}

function telegramMessageBody(e){
  if(e.kind==='GUIDE')return e.guideCompactText||e.guideText;
  const time=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Kuala_Lumpur',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(new Date(e.time));
  const footer=`Masa: ${time} MYT\nRujukan: ZC-${e.id}\nAlert Analysis • bukan pengesahan transaksi MT5`;
  if(['TP_HIT','PULLBACK'].includes(e.kind)){
    if(!require('./telegram-progress').allowed(e))return `ZENCORE | PERGERAKAN TIDAK DISAHKAN\n${footer}`;
    const p=e.telegramPlan;
    if(e.kind==='TP_HIT')return [`✅ ZENCORE | TP${e.targetNumber} DILEPASI`,`${e.symbol} • TF${e.timeframe} • ${e.side}`,
     `TP${e.targetNumber}: ${price(p['tp'+e.targetNumber])} | Harga: ${price(e.currentPrice)}`,
     'Panduan ZenCore — Jaga profit ikut SOP.',`🕒 ${time} MYT • ZC-${e.id}`].join('\n');
    const buy=e.side==='BUY',proof=e.reversalEvidence;
    const cause=proof.priceBreak?`Candle tutup ${buy?'di bawah low':'di atas high'} candle sebelumnya.`:`Dua candle berturut-turut tutup ${buy?'menurun':'menaik'}.`;
    const momentum=proof.momentumAgainst?`WT sudah melawan posisi ${e.side}.`:`Kekuatan WT ${e.side} berkurang.`;
    const profitable=buy?e.currentPrice>p.entry:e.currentPrice<p.entry;
    return ['⚠️ ZENCORE | HARGA MULA PULLBACK',`${e.symbol} • TF${e.timeframe}`,`Posisi ${e.side}`,'',
     `Harga Sekarang: ${price(e.currentPrice)}`,`Harga Entry: ${price(p.entry)}`,'',
     buy?'Harga mula turun. → Momentum BUY melemah.':'Harga mula naik. → Momentum SELL melemah.',
     'Kenapa Pullback:',cause+' '+momentum,'',
     'Rumusan AI ZenCore:',(profitable?'Profit mula susut.':'Posisi sedang tertekan.')+' Candle tutup menunjukkan tekanan melawan posisi; belum sah trend bertukar.',
     'Coach Tips:',profitable?'Lindungi profit ikut SOP. Jangan tambah layer atau longgarkan SL.':'Ikut SL dan signal exit. Jangan tambah layer untuk cover rugi.',
     `🕒 ${time} MYT • ZC-${e.id}`].join('\n');
  }
  if(e.kind!=='ENTRY')return closeMessage(e,time);
  const p=e.telegramPlan, q=e.telegramQuality;
  if(['NORMAL_20261001_TF2_RIBBON_V1','NORMAL_20261001_TF3_RIBBON_V1','NORMAL_20261001_TF15_RIBBON_V1'].includes(e.telegramSop?.version)){
    const s=e.telegramSop;if(!entrySopAllowed(e)||!p)return `ZENCORE | ENTRY TIDAK DISAHKAN\n\n${footer}`;
    return currentPineMessage(e,p,s,time);
  }

  if(['NORMAL_20261001_TF2_SOLID_80PCT_LIVE_V13','NORMAL_20261001_TF2_SOLID80_SCALP_CAP_V14','NORMAL_20261001_TF2_SOLID_HOLD_V15','NORMAL_20261001_TF2_SOLID_HOLD_V16'].includes(e.telegramSop?.version)){
    const s=e.telegramSop;if(!entrySopAllowed(e)||!p)return `ZENCORE | ENTRY TIDAK DISAHKAN\n\n${footer}`;
    const passed=s.gates.filter(g=>g.pass).length;
    return `ZENCORE | SOLID ENTRY TF2 • ${['NORMAL_20261001_TF2_SOLID_HOLD_V15','NORMAL_20261001_TF2_SOLID_HOLD_V16'].includes(s.version)?'SOLID HOLD · SOP LENGKAP':'SOP 80%'}\n${e.symbol} • ${e.side}\nPengesahan: ${passed}/6 (${(passed/6*100).toFixed(2)}%)\nHEMA40: SEARAH\nMTF score: ${s.mtfScore}\nKelengkapan SOP bukan win rate.\n\nEntry: ${price(p.entry)}\nSL: ${price(p.sl)}\nTP1: ${price(p.tp1)}\nTP2: ${price(p.tp2)}\nTP3: ${price(p.tp3)}\n\n${analysisContext(s)}\n\n${footer}`;
  }
  if(['NORMAL_20261001_TF2_CURRENT_SOLID_HEMAPRICE_V7','NORMAL_20261001_TF2_SEP24_HEMA5_V8'].includes(e.telegramSop?.version)){
    const s=e.telegramSop;
    if(!entrySopAllowed(e)||!p)return `ZENCORE | ENTRY TIDAK DISAHKAN\n\n${footer}`;
    return `ZENCORE | SOLID ENTRY TF2 • SCALPING\n${e.symbol} • ${e.side}\n${s.version.includes('SEP24')?'SOP 24/9 → TF2 V8':'SOP TF2 V7'} • SOLID semasa\n\nSOLID: AKTIF\nHarga lepas entry: PASS\nChecklist: ${s.green}/5 hijau\nForecast: ${s.forecast} ${s.power}%\nHarga TF${s.version.includes('SEP24')?5:2} vs HEMA20/40: ${s.hema2.state}\nGred: ${q.grade} (${q.score}/100)\n\nEntry rujukan harga live: ${price(p.entry)}\nStop Loss: ${price(p.sl)}\nTP1: ${price(p.tp1)}\nTP2: ${price(p.tp2)}\nTP3: ${price(p.tp3)}\n\n${footer}`;
  }

  if(/^NORMAL_20261001_TF(2_V2|15_V2|2_SEQ_V3|2_SEQ_ATR40_V4|15_SEQ_ATR40_V4)$/.test(e.telegramSop?.version||'')||['NORMAL_20261001_TF2_TP1_HEMAGAP_V5','NORMAL_20261001_TF2_SEQ_TP1_HEMAGAP_V5','NORMAL_20261001_TF2_SEQ_ATR40_TP1_HEMAGAP_V5'].includes(e.telegramSop?.version)){
    const s=e.telegramSop,tf=s.tf.replace('m','');
    if(!entrySopAllowed(e)||!p)return `ZENCORE | ENTRY TIDAK DISAHKAN\n\n${footer}`;
    return `ZENCORE | SOLID ENTRY TF${tf} • ${tf==='15'?'INTRA':'SCALPING'}\n${e.symbol} • ${e.side}\n${s.version.includes('HEMAGAP')?'SOP TF2 • HEMA2 sahaja • 13/10/2026':'SOP 1/10/2026'}\n\n`+
      `SOLID: ${s.version.includes('_SEQ_')?'SETUP DIPEGANG':'PASS'}\nHarga lepas entry: PASS\nChecklist: ${s.green}/5 hijau\nForecast: ${s.forecast} ${s.power}%\n${s.pullback?`Pullback: ${s.pullback.required?'40% • PASS':'Candle biasa'}\n`:''}HEMA TF${tf}: ${s['hema'+tf]?.mode||'WAIT_DATA'}\n${tf==='15'?`HEMA TF30: ${s.hema30?.mode||'WAIT_DATA'}\n`:''}${s.version.includes('HEMAGAP')?'Ribbon HEMA: melepasi had minimum\n':''}Gred: ${q.grade} (${q.score}/100)\n\n`+
      `${s.entryAnchor==='LIVE_SIGNAL_PRICE_V1'?'Entry rujukan harga live':'Entry SOP'}: ${price(p.entry)}\nStop Loss: ${price(p.sl)}\nTP1: ${price(p.tp1)}\nTP2: ${price(p.tp2)}\nTP3: ${price(p.tp3)}\n\n${footer}`;
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
// Plain-text separators render consistently in Telegram without parse-mode markup.
function telegramMessage(e){
  let message=telegramMessageBody(e);
  if(e.kind==='ENTRY'&&e.telegramPlan&&!message.includes('ENTRY TIDAK DISAHKAN')){
   const time=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Kuala_Lumpur',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(new Date(e.time));
   message=currentPineMessage(e,e.telegramPlan,e.telegramSop||{},time);
  }
  const [title,...body]=message.split('\n');
  const border='━━━━━━━━━━━━━━━━━━';
  return [border,title,'──────────────────',...body,border].join('\n');
}
module.exports={prepareTelegram,messageQuality,telegramMessage,qualityGrade,entryFresh,entrySopAllowed};

