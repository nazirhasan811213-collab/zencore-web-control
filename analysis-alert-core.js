'use strict';
const { createEntryDecision, createManagementDecision } = require('./analysis-execution-contract');
const ENTRY_COOLDOWN = 15 * 60 * 1000;
const SETUP_DEDUP = 30 * 60 * 1000;
function qualityEntry(m, entry) {
  const n=m.strategyNormal||{}, s=n.sop||{};
  if (!entry || m.feedMode!=='BAR-CLOSE' || m.sidewaysGuard!==false ||
      n.solid!==true || s.feedReady!==true || s.sopGreen!==5 ||
      s.pricePastEntry!==true || s.forecastPass!==true || s.m5Pass!==true) return false;
  const sign=entry.side==='BUY'?1:-1, risk=sign*(entry.entry-entry.sl);
  return Object.values({entry:entry.entry,sl:entry.sl,tp1:entry.tp1,tp2:entry.tp2,tp3:entry.tp3}).every(p=>p>0) &&
    risk>0 && sign*(entry.tp1-entry.entry)>=risk*0.999999 &&
    sign*(entry.tp2-entry.tp1)>0 && sign*(entry.tp3-entry.tp2)>0;
}
function signals(m, now = Date.now()) {
  const time = Number(m.receivedAt);
  if (!time || time > now + 30000 || now - time > 180000) return null;
  const entry = createEntryDecision(m)?.snapshot;
  const close = createManagementDecision(m)?.snapshot.actions.find(a => a.type === 'CLOSE_PERCENT');
  const items = [];
  if (qualityEntry(m,entry) && !close) items.push({kind:'ENTRY', signature:`${entry.side}|${entry.entry}`, side:entry.side,
    message:`${entry.symbol} • ${entry.side}\nNormal Scalping · 3 minit\n\nENTRY  ${entry.entry}\nSTOP LOSS  ${entry.sl}\n\nTP1  ${entry.tp1}\nTP2  ${entry.tp2}\nTP3  ${entry.tp3}\n\nSaringan: SOP 5/5 · candle disahkan\nSolid entry · forecast & HEMA 5m lulus\nKualiti setup, bukan peratus kemenangan.`});
  if (close) items.push({kind:'CLOSE', signature:close.reason, percent:close.percent,
    message:`${m.symbol} • ${close.percent === 50 ? 'TUTUP 50% POSISI' : close.reason === 'EXIT_REMAINING' ? 'TUTUP BAKI POSISI' : 'TUTUP SEMUA POSISI'}\n\n${String(m.positionManagement.reason || close.reason).slice(0,180)}\n\nUrus posisi sedia ada mengikut Analysis.`});
  return {symbol:m.symbol,time,policyVersion:2,tradeActive:m.tradeActive,entry:items.find(x=>x.kind==='ENTRY')?.signature||'',close:items.find(x=>x.kind==='CLOSE')?.signature||'',items};
}
function transitions(previous, next) {
  if (!next || (previous && next.time <= previous.time)) return [];
  // Persist the ledger on next, including WAIT frames. Never key an entry by
  // changing ATR/SL or receivedAt. Seed old deployments without replaying entry.
  const oldKey=previous?.entry?.split('|').slice(0,2).join('|');
  next.recentEntries={...previous?.recentEntries};
  next.lastEntry=previous?.lastEntry || (oldKey?{key:oldKey,side:oldKey.split('|')[0],time:previous.time}:null);
  if(oldKey && previous?.policyVersion!==2)next.recentEntries[oldKey]=previous.time;
  for(const [key,time] of Object.entries(next.recentEntries))if(next.time-time>=SETUP_DEDUP)delete next.recentEntries[key];
  next.closeStages={...previous?.closeStages};
  // A new source position can exist even when its entry failed our quality filter.
  // Preserve close alerts for that position too; never quality-filter an exit.
  if(previous?.tradeActive===false && next.tradeActive===true)next.closeStages={};
  if(typeof next.tradeActive!=='boolean')next.tradeActive=previous?.tradeActive;
  if(previous?.close && previous.policyVersion!==2)next.closeStages[previous.close==='CLOSE_SEPARUH'?'partial':'final']=true;
  const events=[];
  for(const {signature,...item} of next.items){
    if(item.kind==='ENTRY'){
      if(previous?.entry===signature || next.recentEntries[signature] || (next.lastEntry?.side===item.side && next.time-next.lastEntry.time<ENTRY_COOLDOWN))continue;
      next.recentEntries[signature]=next.time;
      next.lastEntry={key:signature,side:item.side,time:next.time};
      next.closeStages={};
    }else{
      // Partial and final exits are each delivered once per observed entry cycle.
      const stage=item.percent===50?'partial':'final';
      if(next.closeStages[stage] || next.closeStages.final)continue;
      next.closeStages[stage]=true;
    }
    events.push({...item,symbol:next.symbol,time:next.time,policyVersion:2});
  }
  return events;
}
function telegramMessage(e) {
  const time=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Kuala_Lumpur',day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(e.time));
  return `ZENCORE • ${e.kind==='ENTRY'?'SIGNAL ENTRY':'PENGURUSAN POSISI'}\n\n${e.message}\n\nMasa: ${time} MYT\nRujukan: ZC-${e.id}\nSignal Analysis; bukan pengesahan transaksi MT5.`;
}
const defaults = () => ({popup:true,sound:true,telegramEnabled:false,telegramId:'',verified:false});
module.exports = {signals,transitions,defaults,telegramMessage};
