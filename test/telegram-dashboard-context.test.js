'use strict';
const {test}=require('node:test'),a=require('node:assert/strict');
const fs=require('node:fs');
const D=require('../telegram-dashboard-context'),{telegramMessage}=require('../analysis-telegram');
const advisor=()=>({proTip:'Wait for better alignment.',mtfSummary:'TF Sepakat TURUN. Fokus HANYA SELL/SHORT.',aiCoach:'[TREND]: TURUN (BEARISH). TF Besar SOKONG.\n[MOMENTUM]: Mula perlahan. RSI cantik.\n[HALANGAN]: Laluan CLEAR.\n[WHALES]: Quiet 💤\n[NASIHAT]: SETUP HIGH RISK JAGA SAIZ LAYER DAN LOT'});
for(const tf of ['2','15'])test('dashboard fields come from own TF '+tf+' and remain frozen',()=>{
 const m={timeframe:tf,signalObservedAt:123,strategyNormal:{sop:{advisor:advisor()}}},c=D.snapshot(m,tf);
 a.equal(c.timeframe,tf);a.equal(c.observedAt,123);a.match(c.summary,/TF Sepakat TURUN/);a.equal(c.barrier,'Laluan CLEAR.');a.equal(c.whales,'Quiet 💤');a.match(c.advice,/HIGH RISK/);
 m.strategyNormal.sop.advisor.proTip='new tick';a.equal(c.tip,'Wait for better alignment.');a.equal(D.snapshot(m,tf==='2'?'15':'2'),null);a.deepEqual(D.lines(c,tf==='2'?'15':'2'),[]);
 for(const name of ['TIP:','Rumusan AI Dashboard:','Trend:','Momentum:','Halangan:','Whales:','Nasihat:'])a.ok(D.lines(c,tf).join('\n').includes(name));
});
test('entry and re-entry include actual dashboard advice without changing authorization',()=>{
 for(const again of [false,true]){
  const e={kind:'ENTRY',symbol:'XAUUSD',timeframe:'2',side:'SELL',time:Date.now(),id:'DASH',telegramPlan:{entry:100,sl:104,tp1:98.5,tp2:97.5,tp3:96.5},telegramSop:{version:'SOLID_TF2_3GREEN_HEMA23_V2',tf:'2m',solid:true,green:5,cycleKind:again?'FOLLOWUP':'INITIAL',gates:Array.from({length:6},()=>({pass:true})),advisor:advisor()}};
  const text=telegramMessage(e);a.match(text,/AI COACH & INSIGHTS • TF2/);a.match(text,/Quiet 💤/);a.match(text,/TF Sepakat TURUN/);a.match(text,/JAGA SAIZ LAYER DAN LOT/);a.ok(text.length<4096);
 }
});
test('dashboard data is optional, bounded, unicode-safe and never fabricated',()=>{
 a.equal(D.snapshot({timeframe:'2'},'2'),null);a.deepEqual(D.lines(null,'2'),[]);
 const huge=Object.fromEntries(['proTip','mtfSummary','trend','momentum','advice','aiCoach'].map(k=>[k,'🚀'.repeat(5000)]));
 const text=D.lines(D.snapshot({timeframe:'15',dashboard:huge},'15'),'15').join('\n');a.ok(text.length<2400);a.doesNotMatch(text,/undefined|NaN/);
});
test('pullback stores the current warning dashboard rather than the entry dashboard',()=>{
 const prefix=fs.readFileSync(__dirname+'/telegram-turn-confirmation.test.js','utf8').split("for(const tf of")[0],{sequence}=new Function('require',prefix+';return {sequence};')(require),P=require('../telegram-progress');
 for(const tf of ['2','15']){let previous={activePlan:{side:'BUY',setupKey:'frozen',plan:{entry:100,sl:96,tp1:102,tp2:104,tp3:106},atrReference:2}},warning;const d=advisor();
  for(const b of sequence(tf,'BUY')){const next={symbol:'XAUUSD',timeframe:tf,time:b.observedAt},m={symbol:'XAUUSD',timeframe:tf,sourceBarTime:b.time,signalObservedAt:b.observedAt,confirmed:true,price:b.close,open:b.open,high:b.high,low:b.low,close:b.close,waveTrend1:b.wt1,waveTrend2:b.wt2,atr:b.atr,strategyNormal:{sop:{advisor:d}}};warning=P.progress(previous,next,m,[],b.observedAt).find(e=>e.kind==='PULLBACK')||warning;previous={...next,activePlan:previous.activePlan};}
  a.ok(warning);d.mtfSummary='later unrelated tick';const text=telegramMessage(warning);a.match(text,/TF Sepakat TURUN/);a.doesNotMatch(text,/later unrelated tick/);a.match(text,new RegExp('AI COACH & INSIGHTS • TF'+tf));
 }
});
test('fresh guides include own dashboard, stale guides do not pretend it is current',()=>{
 const prefix=fs.readFileSync(__dirname+'/telegram-trade-guide.test.js','utf8').split("test(")[0],{start,market,candles}=new Function('require',prefix+';return {start,market,candles};')(require),G=require('../telegram-trade-guide');
 for(const tf of ['2','15']){const m=market(tf);m.strategyNormal={sop:{advisor:advisor()}};
  const e=G.buildGuide(tf,m,candles(tf),start);a.match(e.guideCompactText,/AI COACH & INSIGHTS/);a.match(e.guideText,/Whales: Quiet/);a.ok(telegramMessage(e).length<4096);
  const old=G.buildGuide(tf,{...m,signalObservedAt:start-120000},candles(tf),start);a.doesNotMatch(old.guideCompactText,/TF Sepakat TURUN/);
 }
});
