const test=require('node:test');
const assert=require('node:assert/strict');
const {normalEntrySop,hemaStrength}=require('../normal-entry-sop');
const Contract=require('../analysis-execution-contract');
const base={timeframe:'2',chopIndex:40,normal3Side:'BUY',normal3Solid:true,normal3Entry:100,normal3Close:101,normal3Atr:2,
 normal3Sop1:true,normal3Sop2:true,normal3Sop3:true,normal3Sop4:true,normal3Sop5:false,
 normal3PricePastEntry:true,normal3Forecast:'BULLISH',normal3MarketPower:51,
 hemaConfirmation:{version:'HEMA23_LIVE_V1',tf2:{fast:102,slow:101,previousFast:101,previousSlow:100},tf3:{confirmed:true,fast:102,slow:101,previousFast:101,previousSlow:100}}};
test('user forecast thresholds and direction are strict',()=>{
 for(const [side,forecast,power,expected] of [
  ['BUY','BULLISH',50,false],['BUY','BULLISH',50.01,true],['BUY','NEUTRAL',50,false],['BUY','NEUTRAL',50.01,true],
  ['BUY','BEARISH',80,false],['SELL','BEARISH',50,false],['SELL','BEARISH',50.01,true],
  ['SELL','NEUTRAL',50,false],['SELL','NEUTRAL',49.99,true],['SELL','BULLISH',80,false]
 ])assert.equal(normalEntrySop({...base,normal3Side:side,normal3Forecast:forecast,normal3MarketPower:power,hemaConfirmation:side==='BUY'?base.hemaConfirmation:{version:'HEMA23_LIVE_V1',tf2:{fast:98,slow:99,previousFast:99,previousSlow:100},tf3:{confirmed:true,fast:98,slow:99,previousFast:99,previousSlow:100}}}).standardReady,expected);
});
test('four flags required; TF2 and SOLID required; independent TF5 gate removed',()=>{
 assert.equal(normalEntrySop(base).standardReady,true);
 assert.equal(normalEntrySop({...base,normal3Sop3:false}).standardReady,false);
 assert.equal(normalEntrySop({...base,normal3Solid:false}).standardReady,false);
 for(const timeframe of ['1','3',undefined])assert.equal(normalEntrySop({...base,timeframe}).standardReady,false);
 assert.equal(normalEntrySop({...base,normal5Position:'BELOW',normal3PriceCrossEntry:false}).standardReady,true);
 assert.equal(normalEntrySop(base).reentryReady,false);
});
test('contract follows explicit SOP with current quality and HEMA metadata but rejects failed gates and bad plans',()=>{
 const x=normalEntrySop(base);
 const m={symbol:'XAUUSD',timeframe:'2',receivedAt:Date.now(),price:101,predictionConfidence:85,stability:80,confluence:4,setupProbability:75,strategyNormal:{state:'READY',side:'BUY',tf:'2m',solid:true,
  entrySopVersion:x.version,sop:{gates:x.gates,sopGreen:x.green,forecast:x.forecast,marketPower:x.power,hema2:x.hema2,hema3:x.hema3},plan:{entry:100,sl:98,tp1:102,tp2:104,tp3:106}}};
 assert.equal(Contract.entryQuality(m).grade,'A');
 assert.equal(Contract.createEntryDecision(m).snapshot.analysisSopVersion,x.version);
 assert.equal(Contract.createEntryDecision({...m,strategyNormal:{...m.strategyNormal,solid:false}}),null);
 assert.equal(Contract.createEntryDecision({...m,strategyNormal:{...m.strategyNormal,sop:{gates:x.gates.map(g=>({...g,pass:false}))}}}),null);
 assert.equal(Contract.createEntryDecision({...m,price:102}),null);
});
test('HEMA mode rejects missing/equal/opposite ribbons and accepts intrabar direction',()=>{
 assert.equal(normalEntrySop({...base,hemaConfirmation:undefined}).standardReady,false);
 for(const bad of [{fast:100,slow:100},{fast:99,slow:100},{}])assert.equal(normalEntrySop({...base,hemaConfirmation:{...base.hemaConfirmation,tf3:bad}}).standardReady,false);
 assert.equal(normalEntrySop({...base,hemaConfirmation:{...base.hemaConfirmation,tf3:{fast:102,slow:101,confirmed:false}}}).standardReady,true);
 assert.equal(hemaStrength(base.hemaConfirmation.tf3,'BUY',true).state,'STRONG');
});
test('compact feed preserves HEMA object without experimental scalp metadata',()=>{
 const fs=require('node:fs'),vm=require('node:vm');
 const source=fs.readFileSync(require.resolve('../server-v17.js'),'utf8');
 const start=source.indexOf('function expandCompactMarket('),end=source.indexOf('function storeSnapshot(',start);
 const ctx={};vm.runInNewContext(source.slice(start,end),ctx);
 const row=Array(66).fill(null);row[0]='XAUUSD';row[65]={version:'HEMA23_V1',...base.hemaConfirmation};
 const parsed=ctx.expandCompactMarket(row,{timeframe:'2',schemaVersion:'32.3-EXIT-STEPLOCK'});
 assert.equal(parsed.hemaConfirmation,row[65]);assert.equal(parsed.scalp012,undefined);

});
