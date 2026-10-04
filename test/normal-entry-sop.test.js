const test=require('node:test'),assert=require('node:assert/strict');
const {normalEntrySop}=require('../normal-entry-sop');
const ribbon={fast:102,slow:101,previousFast:101,previousSlow:100};
const base={timeframe:'2',chopIndex:40,normal3Side:'BUY',normal3Entry:100,normal3Close:101,normal3Atr:2,
 normal3Solid:true,normal3Forecast:'NEUTRAL',normal3MarketPower:56,
 hemaConfirmation:{tf2:ribbon,tf3:{...ribbon,confirmed:true}}};
test('any three checklist flags qualify with SOLID forecast and both HEMA confirmations',()=>{
 for(let mask=0;mask<32;mask++){
  const d={...base};let count=0;
  for(let i=1;i<=5;i++){d['normal3Sop'+i]=!!(mask&(1<<(i-1)));count+=d['normal3Sop'+i]?1:0;}
  assert.equal(normalEntrySop(d).standardReady,count>=3,'mask '+mask);
 }
});
test('reentry remains disabled; no independent TF5 gate',()=>{
 const d={...base,normal3Sop1:true,normal3Sop2:true,normal3Sop4:true,normal5Position:'BELOW',normal3ReentrySignal:'HIGH'};
 assert.equal(normalEntrySop(d).standardReady,true);assert.equal(normalEntrySop(d).reentryReady,false);
});
