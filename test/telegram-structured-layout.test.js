'use strict';
const {test}=require('node:test'),a=require('node:assert/strict'),fs=require('node:fs');
const {telegramMessage}=require('../analysis-telegram');
for(const tf of ['2','15'])for(const side of ['BUY','SELL'])for(const again of [false,true])test(`structured ${again?'re-entry':'entry'} TF${tf} ${side}: prices first, bounded evidence and analysis`,()=>{
 const sign=side==='BUY'?1:-1,e={kind:'ENTRY',symbol:'XAUUSD',timeframe:tf,side,time:Date.now(),id:'LAYOUT',telegramPlan:{entry:4100,sl:4100-sign*4,tp1:4100+sign*1.5,tp2:4100+sign*2.5,tp3:4100+sign*3.5},telegramSop:{version:tf==='2'?'SOLID_TF2_3GREEN_HEMA23_V2':'SOLID_TF15_3GREEN_HEMA1545_2L_V1',tf:tf+'m',solid:true,green:5,cycleKind:again?'FOLLOWUP':'INITIAL',gates:['entry','hema','wt','sop','x','y'].map(key=>({key,pass:true}))}};
 const text=telegramMessage(e);a.match(text,new RegExp(`ZENCORE \\| ${again?'RE-ENTRY':'ENTRY'} TF${tf}`));
 const markers=['Entry:','SL:','TP1:','TP2:','TP3:','Sebab entry:','Rumusan AI ZenCore:','Coach Tips:','Signal sahaja'];for(let i=1;i<markers.length;i++)a.ok(text.indexOf(markers[i])>text.indexOf(markers[i-1]),markers[i]);
 for(const name of ['Entry','SL','TP1','TP2','TP3'])a.match(text,new RegExp('\\n'+name+': [0-9,.]+\\n'));
 a.match(text,new RegExp(`HEMA ${side==='BUY'?'hijau':'merah'}`));a.ok(text.length<1400);a.doesNotMatch(text,/ORDER EXECUTED|Win rate|undefined|NaN|screenshot/i);
});
test('pullback states the actual closed-price and momentum trigger before safe management advice',()=>{
 const prefix=fs.readFileSync(__dirname+'/telegram-turn-confirmation.test.js','utf8').split("for(const tf of")[0],{sequence}=new Function('require',prefix+';return {sequence};')(require);
 const P=require('../telegram-progress');for(const tf of ['2','15'])for(const side of ['BUY','SELL']){
  let previous={activePlan:{side,setupKey:'test',plan:{entry:100,sl:side==='BUY'?96:104,tp1:side==='BUY'?102:98,tp2:side==='BUY'?104:96,tp3:side==='BUY'?106:94},atrReference:2}},event;
  for(const b of sequence(tf,side)){const next={symbol:'XAUUSD',timeframe:tf,time:b.observedAt};const events=P.progress(previous,next,{symbol:'XAUUSD',timeframe:tf,sourceBarTime:b.time,signalObservedAt:b.observedAt,confirmed:true,price:b.close,open:b.open,high:b.high,low:b.low,close:b.close,waveTrend1:b.wt1,waveTrend2:b.wt2,atr:b.atr},[],b.observedAt);event=events.find(e=>e.kind==='PULLBACK')||event;previous={...next,activePlan:previous.activePlan};}
  a.ok(event);const text=telegramMessage(event);a.match(text,/HARGA MULA PULLBACK/);a.match(text,/Harga Sekarang:/);a.match(text,/Harga Entry:/);a.match(text,/Kenapa Pullback:/);a.match(text,/Rumusan AI ZenCore:/);a.match(text,/Coach Tips:/);a.match(text,/belum sah trend bertukar/);a.match(text,side==='BUY'?/di bawah low/:/di atas high/);a.ok(text.length<1400);
 }
});
test('TF15 candle label reports actual OHLC body rather than assuming the entry direction',()=>{
 const e={kind:'ENTRY',symbol:'XAUUSD',timeframe:'15',side:'SELL',time:Date.now(),id:'BODY',telegramPlan:{entry:100,sl:104,tp1:96,tp2:92,tp3:88},telegramSop:{version:'SOLID_TF15_3GREEN_HEMA1545_2L_V1',tf:'15m',solid:true,green:5,currentBar:{open:99,close:100},gates:Array.from({length:6},()=>({pass:true}))}};
 a.match(telegramMessage(e),/Candle entry: BULLISH/);a.doesNotMatch(telegramMessage(e),/Candle entry: BEARISH/);
});
