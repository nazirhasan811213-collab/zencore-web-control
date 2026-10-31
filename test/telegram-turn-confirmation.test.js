'use strict';
const {test}=require('node:test'),a=require('node:assert/strict'),Turn=require('../telegram-turn-confirmation'),{progress,allowed}=require('../telegram-progress'),{telegramMessage}=require('../analysis-telegram'),{notificationKey}=require('../telegram-notification-key');
function bar(tf,time,o,h,l,c,w1,w2,atr=2){return {time,timeframe:tf,closedAt:time+Number(tf)*60000,observedAt:time+Number(tf)*60000,confirmed:true,open:o,high:h,low:l,close:c,wt1:w1,wt2:w2,atr};}
function mirror(b){return {...b,open:200-b.open,high:200-b.low,low:200-b.high,close:200-b.close,wt1:-b.wt1,wt2:-b.wt2};}
function sequence(tf,side){const period=Number(tf)*60000,now=Date.now(),rows=[bar(tf,now-3*period,100,104.5,99.8,104,5,1),bar(tf,now-2*period,104,105.5,103.5,105,6,1),bar(tf,now-period,105,105.2,102.5,103,3,1)];return side==='BUY'?rows:rows.map(mirror);}
for(const tf of ['2','15'])for(const side of ['BUY','SELL'])test('confirmed turn '+tf+' '+side+' requires price reversal plus momentum and deduplicates after restart',()=>{
 const rows=sequence(tf,side),sign=side==='BUY'?1:-1,plan={entry:100,sl:100-sign*4,tp1:100+sign*2,tp2:100+sign*4,tp3:100+sign*6};let previous={activePlan:{side,setupKey:'setup',plan,atrReference:20}},warnings=[];
 for(const b of rows){const at=b.observedAt,m={symbol:'XAUUSD',timeframe:tf,sourceBarTime:b.time,signalObservedAt:at,confirmed:true,price:b.close,open:b.open,high:b.high,low:b.low,close:b.close,waveTrend1:b.wt1,waveTrend2:b.wt2,atr:b.atr};const next={symbol:'XAUUSD',timeframe:tf,time:at};const result=progress(previous,next,m,[],at);warnings.push(...result.filter(e=>e.kind==='PULLBACK'));previous={...next,activePlan:previous.activePlan};}
 a.equal(warnings.length,1);const e=warnings[0];a.ok(e.reversalEvidence.priceBreak);a.ok(allowed(e,e.time));a.equal(e.atrReference,2,'uses current closed ATR, not frozen entry ATR20');a.match(telegramMessage(e),/HARGA MULA PULLBACK/);a.match(telegramMessage(e),/Lindungi profit/);a.doesNotMatch(telegramMessage(e),/0.25 ATR/);
 const before=rows.at(-1),b={...before,time:before.time+Number(tf)*60000,closedAt:before.closedAt+Number(tf)*60000,observedAt:before.observedAt+Number(tf)*60000,open:before.close,close:before.close-sign*.2,low:Math.min(before.close,before.close-sign*.2)-.1,high:Math.max(before.close,before.close-sign*.2)+.1};
 const next={symbol:'XAUUSD',timeframe:tf,time:b.observedAt};previous=JSON.parse(JSON.stringify(previous));a.equal(progress(previous,next,{sourceBarTime:b.time,signalObservedAt:b.observedAt,confirmed:true,price:b.close,open:b.open,high:b.high,low:b.low,close:b.close,waveTrend1:b.wt1,waveTrend2:b.wt2,atr:2},[],b.observedAt).filter(e=>e.kind==='PULLBACK').length,0);
 const legacy={...e,reversalEvidence:undefined,telegramProgressVersion:1};a.equal(allowed(legacy,e.time),false);a.notEqual(notificationKey(e),notificationKey(legacy));a.equal(notificationKey(e),notificationKey({...e,time:e.time+1,observedAt:e.observedAt+1}));
});
test('retracement alone, wrong momentum, doji, wick-only, gapped bars and intrabar cannot confirm',()=>{
 const rows=sequence('2','BUY'),best=105,good=rows.at(-1);a.ok(Turn.confirm('BUY',best,rows));
 a.equal(Turn.confirm('BUY',best,[...rows.slice(0,-1),{...good,wt1:8}]),null,'WT still strengthens');
 a.equal(Turn.confirm('BUY',best,[...rows.slice(0,-1),{...good,open:103.01,high:106,low:102}]),null,'doji-sized body');
 a.equal(Turn.confirm('BUY',best,[...rows.slice(0,-1),{...good,open:105,close:105.1,high:106,low:101}]),null,'wick does not replace adverse close');
 a.equal(Turn.confirm('BUY',best,[rows[0],{...good,time:good.time+120000,closedAt:good.closedAt+120000,observedAt:good.observedAt+120000}]),null,'missing source bar');
 a.equal(Turn.point({sourceBarTime:good.time,signalObservedAt:good.observedAt,confirmed:false,open:good.open,high:good.high,low:good.low,close:good.close,price:good.close,waveTrend1:good.wt1,waveTrend2:good.wt2,atr:2},'2'),null);
});
test('two adverse closes can confirm without breaking previous candle wick',()=>{
 const now=Date.now(),p=120000,rows=[bar('2',now-3*p,100,105,99,104,6,1),bar('2',now-2*p,104,105,101,103,5,1),bar('2',now-p,103,104,100,102,3,1)];const e=Turn.confirm('BUY',104,rows);a.ok(e);a.equal(e.priceBreak,false);a.equal(e.twoCloses,true);
});
test('delivery revalidates reversal facts; forged evidence and stale messages are rejected',()=>{
 const rows=sequence('2','BUY'),at=rows.at(-1).observedAt,ev=Turn.confirm('BUY',105,rows),e={telegramProgressVersion:2,kind:'PULLBACK',symbol:'XAUUSD',timeframe:'2',side:'BUY',setupKey:'setup',telegramPlan:{entry:100,sl:96,tp1:102,tp2:104,tp3:106},time:at,observedAt:at,currentPrice:103,bestPrice:105,pullbackStage:2,reversalEvidence:ev};a.ok(allowed(e,at));a.equal(allowed(e,at+60001),false);a.equal(allowed({...e,reversalEvidence:{...ev,bars:ev.bars.map(b=>({...b,wt1:99}))}},at),false);a.equal(allowed({...e,currentPrice:104},at),false);a.equal(allowed({...e,reversalEvidence:{...ev,priceBreak:!ev.priceBreak}},at),false);
});
