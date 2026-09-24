'use strict';
const { createEntryDecision, createManagementDecision } = require('./analysis-execution-contract');
function signals(m, now = Date.now()) {
  const time = Number(m.receivedAt);
  if (!time || time > now + 30000 || now - time > 180000) return null;
  const entry = createEntryDecision(m)?.snapshot;
  const close = createManagementDecision(m)?.snapshot.actions.find(a => a.type === 'CLOSE_PERCENT');
  const items = [];
  if (entry) items.push({kind:'ENTRY', signature:`${entry.side}|${entry.entry}|${entry.sl}`, side:entry.side,
    message:`${m.symbol} • ENTRY ${entry.side}\nEntry: ${entry.entry} | SL: ${entry.sl}\nTP1: ${entry.tp1} | TP2: ${entry.tp2} | TP3: ${entry.tp3}`});
  if (close) items.push({kind:'CLOSE', signature:close.reason, percent:close.percent,
    message:`${m.symbol} • ${close.percent === 50 ? 'CLOSE 50%' : close.reason === 'EXIT_REMAINING' ? 'CLOSE BAKI' : 'CLOSE SEMUA'}\n${String(m.positionManagement.reason || close.reason).slice(0,180)}`});
  return {symbol:m.symbol,time,entry:items.find(x=>x.kind==='ENTRY')?.signature||'',close:items.find(x=>x.kind==='CLOSE')?.signature||'',items};
}
function transitions(previous, next) {
  if (!next || (previous && next.time <= previous.time)) return [];
  return next.items.filter(x=> !previous || previous[x.kind.toLowerCase()] !== x.signature)
    .map(({signature,...x})=>({...x,symbol:next.symbol,time:next.time}));
}
const defaults = () => ({popup:true,sound:true,telegramEnabled:false,telegramId:'',verified:false});
module.exports = {signals,transitions,defaults};
