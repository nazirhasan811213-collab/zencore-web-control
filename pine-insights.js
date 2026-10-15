(() => {
 'use strict';
 const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
 const tone=text=>/BEAR|SELL|TURUN|Downtrend/i.test(text||'')?'bear':/BULL|BUY|NAIK|Uptrend/i.test(text||'')?'bull':'neutral';
 function card({tf,advisor,live=false,observedAt,expanded=false}) {
  const box=el('section',undefined,'pine-insights');box.dataset.tf=String(tf);box.setAttribute('aria-label','Rumusan Pine TF'+tf);
  const header=el('div',undefined,'pine-heading'),title=el('div');title.append(el('span','PINE / MARKET INTELLIGENCE','pine-kicker'),el('h3','TF'+tf+' · '+(tf===3?'Scalping':'Intra')));
  header.append(title,el('span',live?'● LIVE':'○ '+(advisor?'DATA TERAKHIR':'TUNGGU DATA'),'pine-status '+(live?'fresh':'old')));box.append(header);
  const summary=el('div',undefined,'pine-summary '+tone(advisor?.mtfSummary));summary.append(el('small','RUMUSAN MULTI TF'),el('p',advisor?.mtfSummary||'Rumusan TF'+tf+' belum masuk.'));box.append(summary);
  const grid=el('div',undefined,'pine-grid');
  for(const [key,label]of [['trend','TREND MARKET'],['momentum','MOMENTUM'],['proTip','COACH TIPS'],['advice','NASIHAT']]){const tile=el('div',undefined,'pine-tile '+tone(advisor?.[key]));tile.append(el('small',label),el('p',advisor?.[key]||'Tunggu data TF'+tf));grid.append(tile);}box.append(grid);
  const details=el('details',undefined,'pine-coach');details.dataset.section='pine-coach-'+tf;details.open=expanded;details.append(el('summary','Buka bacaan penuh AI Coach'));
  const coach=el('div',undefined,'pine-coach-body');const chunks=String(advisor?.aiCoach||'Bacaan AI Coach TF'+tf+' belum diterima.').split(/\s*•\s*/).filter(Boolean);
  for(const chunk of chunks){const match=chunk.match(/^\[([^\]]+)\]:?\s*([\s\S]*)$/);const row=el('div',undefined,'pine-coach-row');if(match)row.append(el('small',match[1]),el('p',match[2]));else row.append(el('p',chunk));coach.append(row);}details.append(coach);box.append(details);
  const time=Number(observedAt);box.append(el('p',Number.isFinite(time)&&time>0?'Data TF'+tf+' · '+new Date(time).toLocaleTimeString('ms-MY',{timeZone:'Asia/Kuala_Lumpur'})+' MYT'+(live?'':' · Semak data fresh sebelum entry'):'Menunggu feed TF'+tf+' sendiri','pine-footnote'));
  return box;
 }
 window.ZenCorePineInsights={card};
})();
