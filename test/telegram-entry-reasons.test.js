const test=require('node:test'),assert=require('node:assert/strict');
const {telegramMessage}=require('../analysis-telegram');
// Legacy validated envelope lets presentation exercise individual gate evidence
// independently of modern authorization (which remains covered by SOP tests).
const event=side=>({kind:'ENTRY',id:'REASONS',symbol:'XAUUSD',side,time:Date.now(),timeframe:'2',
 telegramPlan:{entry:4100,sl:4096,tp1:4101.5,tp2:4102.5,tp3:4103.5},
 telegramQuality:{score:60},telegramSop:{version:'SOLID_TF2_3GREEN_HEMA23_V2',tf:'2m',solid:true,green:5,
 gates:['entry','wt','sop','forecast','x','y'].map(key=>({key,pass:true}))}});
test('entry reasons describe actual passed evidence for BUY and SELL before the price plan',()=>{
 for(const side of ['BUY','SELL']){
  const text=telegramMessage(event(side));
  assert.match(text,new RegExp(`SOLID ${side} aktif`));
  assert.match(text,new RegExp(`harga di ${side==='BUY'?'atas':'bawah'} entry SOLID`));
  assert.match(text,new RegExp(`momentum menyokong ${side}`));
  assert.ok(text.indexOf('Sebab entry:')<text.indexOf('Entry: 4,100.00'));
  assert.ok(text.length<850);
 }
});
