'use strict';
// Bounded copies from the event's own Pine snapshot. Never fetch a newer TF.
const clean=(v,max)=>typeof v==='string'?Array.from(v.replace(/[\x00-\x08\x0b-\x1f\x7f]/g,' ').replace(/\s+/g,' ').trim()).slice(0,max).join(''):'';
function snapshot(m,tf){
 tf=String(tf);if(!['2','15'].includes(tf)||String(m?.timeframe??tf)!==tf)return null;
 const d=m?.strategyNormal?.sop?.advisor||m?.dashboard||{},coach=typeof d.aiCoach==='string'?d.aiCoach:'';
 const tag=name=>coach.match(new RegExp('\\['+name+'\\]\\s*:\\s*([^\\n]+)','i'))?.[1];
 const data={coach:/\[(?:TREND|MOMENTUM|HALANGAN|WHALES|NASIHAT)\]/i.test(coach)?'':clean(coach,220),timeframe:tf,observedAt:m?.signalObservedAt||null,tip:clean(d.proTip,120),summary:clean(d.mtfSummary,180),trend:clean(tag('TREND')||d.trend,110),momentum:clean(tag('MOMENTUM')||d.momentum,110),barrier:clean(tag('HALANGAN'),100),whales:clean(tag('WHALES'),90),advice:clean(tag('NASIHAT')||d.advice,150)};
 return ['coach','tip','summary','trend','momentum','barrier','whales','advice'].some(k=>data[k])?data:null;
}
function lines(ctx,tf){
 if(!ctx||ctx.timeframe!==String(tf))return [];
 const rows=[['TIP',ctx.tip,120],['Rumusan AI Dashboard',ctx.summary,180],['Trend',ctx.trend,110],['Momentum',ctx.momentum,110],['Halangan',ctx.barrier,100],['Whales',ctx.whales,90],['Nasihat',ctx.advice,150],['Coach',ctx.coach,220]].filter(([,v])=>typeof v==='string'&&v.trim());
 return rows.length?['','📊 AI COACH & INSIGHTS • TF'+tf,...rows.map(([k,v,n])=>k+': '+clean(v,n))]:[];
}
module.exports={snapshot,lines};
