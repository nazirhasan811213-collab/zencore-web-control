const test=require('node:test');
const assert=require('node:assert/strict');
const {signals,transitions}=require('../analysis-alert-core');
const {AnalysisAlerts}=require('../analysis-alert-service');
const market=(time=Date.now())=>({symbol:'XAUUSD',receivedAt:time,strategyNormal:{state:'READY',side:'BUY',plan:{entry:2000,sl:1990,tp1:2010,tp2:2020,tp3:2030}},positionManagement:{action:'HOLD'}});
test('fresh entry and close transitions suppress repeated frames, permit next setup and reject stale data',()=>{
 const m=market();const a=signals(m);assert.equal(transitions(null,a)[0].kind,'ENTRY');
 const b=signals({...m,receivedAt:m.receivedAt+1});assert.deepEqual(transitions(a,b),[]);
 const wait=signals({...m,receivedAt:m.receivedAt+2,strategyNormal:{state:'WAIT'}});
 assert.equal(transitions(wait,signals({...m,receivedAt:m.receivedAt+3})).length,1);
 assert.equal(signals({...m,receivedAt:Date.now()-180001}),null);
 assert.deepEqual(transitions(b,a),[]);
 for(const [action,percent] of [['CLOSE_50_NOW',50],['EXIT_REMAINING',100],['EXIT_ALL',100],['EXIT_SL',100]]){
  const n=signals({...m,receivedAt:m.receivedAt+4,positionManagement:{action}});assert.equal(transitions(b,n)[0].percent,percent);
 }
});
test('alert service delivers fresh events once and scopes preferences by user',async()=>{
 const s=new AnalysisAlerts();await s.init();const m=market();await s.ingest(m);await s.ingest({...m,receivedAt:m.receivedAt+1});
 assert.equal((await s.feed('0')).events.length,1);assert.equal((await s.feed(null)).events.length,0);
 await s.save('alice',{popup:false,sound:false,telegramEnabled:false,telegramId:''});assert.equal((await s.get('bob')).popup,true);
 await assert.rejects(()=>s.save('bob',{popup:true,sound:true,telegramEnabled:true,telegramId:'123456'}),/Sahkan/);
 clearInterval(s.cleanupTimer);
});
test('Telegram requires proof of ID ownership, throttles codes, isolates users and invalidates changed IDs',async()=>{
 let sent;const s=new AnalysisAlerts({token:'test-only-token',fetchFn:async(_url,opts)=>{sent=JSON.parse(opts.body);return {ok:true,json:async()=>({ok:true})};}});await s.init();
 const prefs={popup:true,sound:true,telegramEnabled:false,telegramId:'123456789'};
 await s.save('alice',prefs);await s.requestCode('alice');const code=sent.text.match(/\b\d{6}\b/)[0];assert.equal(sent.chat_id,prefs.telegramId);
 await assert.rejects(()=>s.requestCode('alice'),/60/);await assert.rejects(()=>s.verify('bob',code),/Kod/);
 await s.verify('alice',code);await s.save('alice',{...prefs,telegramEnabled:true});assert.equal((await s.get('alice')).telegramEnabled,true);
 await assert.rejects(()=>s.save('alice',{...prefs,telegramId:'987654321',telegramEnabled:true}),/Sahkan/);
 await s.save('alice',{...prefs,telegramId:'987654321'});assert.equal((await s.get('alice')).verified,false);
 assert.equal(s.publicPrefs(await s.get('alice')).code,undefined);clearInterval(s.cleanupTimer);
});
test('Telegram failures are sanitised and never expose bot token',async()=>{
 const s=new AnalysisAlerts({token:'private-token',fetchFn:async()=>{throw Error('private-token');}});
 await assert.rejects(()=>s.telegram('12345','hello'),e=>!e.message.includes('private-token'));
});
