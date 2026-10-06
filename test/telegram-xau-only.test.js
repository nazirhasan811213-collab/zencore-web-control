const test=require('node:test');
const assert=require('node:assert/strict');
const {AnalysisAlerts}=require('../analysis-alert-service');

test('Telegram skips queued currency alerts and delivers XAUUSD closes separately for TF2 and TF15',async()=>{
 const events=[
  {symbol:'GBPUSD',kind:'ENTRY',timeframe:'2'},
  {symbol:'GBPJPY',kind:'CLOSE',timeframe:'15'},
  {symbol:'XAUUSD',kind:'CLOSE',timeframe:'2'},
  {symbol:'XAUUSD',kind:'CLOSE',timeframe:'15'}
 ].map((e,i)=>({...e,id:i+1,time:Date.now(),message:e.symbol+' close'}));
 const statuses=[],sent=[];
 const pool={query:async(sql,args)=>{
  if(sql.startsWith("UPDATE zencore_telegram_deliveries SET status='sending'"))return {rows:events.map(e=>({id:e.id,event_id:e.id,user_id:'owner'}))};
  if(sql.startsWith('SELECT status,role'))return {rows:[{status:'active',role:'client'}]};
  if(sql.startsWith('SELECT data FROM zencore_analysis_alerts'))return {rows:[{data:events.find(e=>e.id===args[0])}]};
  if(sql.startsWith('INSERT INTO zencore_telegram_signal_claims'))return {rows:[{notification_key:args[0]}]};
  if(sql.startsWith('INSERT INTO zencore_telegram_chat_claims'))return {rows:[{event_id:args[0]}]};
  if(sql.startsWith('UPDATE zencore_telegram_deliveries SET status=$2')){statuses.push(args);return {rows:[]};}
  throw new Error('Unexpected query');
 }};
 const alerts=new AnalysisAlerts({pool});
 alerts.get=async()=>({telegramEnabled:true,verified:true,telegramId:'test-chat'});
 alerts.telegram=async(chat,message)=>sent.push(message);
 await alerts.deliver();
 assert.deepEqual(statuses,[[1,'skipped'],[2,'skipped'],[3,'sent'],[4,'sent']]);
 assert.equal(sent.length,2);
 assert.match(sent[0],/XAUUSD/);assert.match(sent[0],/TF2\b/);
 assert.match(sent[1],/XAUUSD/);assert.match(sent[1],/TF15\b/);
 assert.ok(sent.every(message=>!message.includes('GBP')));
});
