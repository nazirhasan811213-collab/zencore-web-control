const test=require('node:test'),assert=require('node:assert/strict');
const {entrySopAllowed,telegramMessage}=require('../analysis-telegram');
const e={kind:'ENTRY',id:'TEST',symbol:'XAUUSD',side:'BUY',time:Date.now(),telegramQuality:{score:0},
 telegramPlan:{entry:100,sl:99,tp1:101,tp2:102,tp3:103},telegramMarket:{price:100.1},
 telegramSop:{version:'SOLID_TF2_3GREEN_HEMA23_V2',tf:'2m',solid:true,green:3,forecast:'NEUTRAL',power:56,
 hema2:{state:'STRONG'},hema3:{state:'STRONG'},gates:Array.from({length:6},()=>({pass:true}))}};
test('Telegram new SOP requires all confirmation gates and ignores old quality score',()=>{
 assert.equal(entrySopAllowed(e),true);
 for(const edit of [{tf:'3m'},{solid:false},{green:2},{gates:[{pass:true}]},{gates:e.telegramSop.gates.map((g,i)=>({pass:i!==5}))}])
  assert.equal(entrySopAllowed({...e,telegramSop:{...e.telegramSop,...edit}}),false);
 assert.equal(entrySopAllowed({...e,telegramSop:undefined}),false);
 const text=telegramMessage(e);assert.match(text,/SOLID ENTRY TF2/);assert.match(text,/Checklist: 3\/5/);
 assert.match(text,/NEUTRAL 56%/);assert.match(text,/HEMA TF3 confirmed: STRONG/);
 assert.doesNotMatch(text,/NORMAL 3M|A\+ PROFIT QUALITY|LOW QUALITY/);
});
test('Analysis records the same approved SOP and plan for Telegram without sending',async()=>{
 const {AnalysisAlerts}=require('../analysis-alert-service');
 const {normalEntrySop}=require('../normal-entry-sop');
 const h={fast:102,slow:101,previousFast:101,previousSlow:100};
 const x=normalEntrySop({timeframe:'2',normal3Side:'BUY',normal3Solid:true,normal3Entry:100,normal3Close:100.1,normal3Atr:1,
  normal3Sop1:true,normal3Sop2:true,normal3Sop3:true,normal3Forecast:'NEUTRAL',normal3MarketPower:56,
  hemaConfirmation:{tf2:h,tf3:{...h,confirmed:true}}});
 const alerts=new AnalysisAlerts({fetchFn:()=>{throw Error('No external sends in test');}});await alerts.init();
 const now=Date.now();
 await alerts.record({symbol:'XAUUSD',receivedAt:now,sourceBarTime:now-120000,price:100.1,timeframe:'2',feedMode:'BAR_CLOSE',
  strategyNormal:{state:'READY',side:'BUY',tf:'2m',solid:true,entrySopVersion:x.version,
   sop:{sopGreen:x.green,forecast:x.forecast,marketPower:x.power,hema2:x.hema2,hema3:x.hema3,gates:x.gates},plan:e.telegramPlan}});
 assert.equal(alerts.events.length,1);assert.equal(entrySopAllowed(alerts.events[0]),true);
 assert.deepEqual(alerts.events[0].telegramPlan,e.telegramPlan);
 await alerts.record({symbol:'EURUSD',receivedAt:now,price:100.1,timeframe:'2',strategyNormal:{state:'READY',side:'BUY',tf:'2m',solid:true,
  entrySopVersion:x.version,sop:{gates:x.gates.map(g=>({...g,pass:false}))},plan:e.telegramPlan}});
 assert.equal(alerts.events.length,1);
});
