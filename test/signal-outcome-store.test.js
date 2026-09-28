const test=require('node:test'),assert=require('node:assert/strict');
const {SignalOutcomeStore,cleanClosed}=require('../signal-outcome-store');
const {PAIRS}=require('../analysis-v33');
const timestamp=Date.now()-60000;
const row={id:'XAUUSD|NORMAL|BUY|100|123',symbol:'XAUUSD',mode:'NORMAL',side:'BUY',state:'CLOSED',
  openedAt:timestamp-900000,resolvedAt:timestamp,entry:100,sl:98,tp1:102,score:85,outcome:'TP1'};
test('only resolved Normal records from the matching pair enter durable history',()=>{
 assert.equal(cleanClosed(row,'XAUUSD').source,'V17_VALIDATION');
 assert.equal(cleanClosed({...row,state:'OPEN'},'XAUUSD'),null);
 assert.equal(cleanClosed(row,'EURUSD'),null);
 assert.equal(cleanClosed({...row,mode:'FAST'},'XAUUSD'),null);
 assert.equal(cleanClosed({...row,resolvedAt:Date.now()+120000},'XAUUSD'),null);
});
test('collector upserts by stable signal id and reads saved history',async()=>{
 const calls=[],stored=new Map(),pool={query:async(sql,args)=>{
  calls.push(sql);if(sql.includes('INSERT INTO')){stored.set(args[0],args[5]);return {rows:[]};}
  if(sql.includes('SELECT data FROM'))return {rows:[...stored.values()].map(data=>({data}))};
  return {rows:[]};}};
 const collector=new SignalOutcomeStore({pool,log:{warn:()=>{}},fetchSummary:async symbol=>({ok:true,symbol,mode:'NORMAL',summary:{recent:symbol==='XAUUSD'?[row]:[]}})});
 await collector.init();await collector.sync();await collector.sync();
 assert.equal(stored.size,1);assert.equal((await collector.read('XAUUSD')).records[0].outcome,'TP1');
 assert.equal(calls.filter(s=>s.includes('INSERT INTO')).length,2);
 assert.equal(PAIRS.length,11);
});
