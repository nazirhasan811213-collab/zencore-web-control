'use strict';
const {test}=require('node:test'),a=require('node:assert/strict'),http=require('node:http'),crypto=require('node:crypto');
const {createDemoHandler}=require('../ib-demo-server'),{dataset}=require('../ib-demo-data');
test('IB demo dataset is synthetic, consistent and includes both TFs and risk notices',()=>{
 const d=dataset();a.equal(d.demo,true);a.equal(d.clients.length,12);a.equal(d.trades.length,40);
 for(const u of d.clients){a.match(u.email,/@example\.invalid$/);a.equal(u.balance,u.capital+d.trades.filter(t=>t.clientId===u.id).reduce((s,t)=>s+t.profit,0));}
 for(const tf of ['TF2','TF15'])for(const type of ['ENTRY','RE-ENTRY','TP','PANDUAN'])a.ok(d.signals.some(s=>s.tf===tf&&s.type===type));
 for(const s of d.signals){a.match(s.text,/DEMO • SIGNAL DUMMY/);a.match(s.text,/Tiada order MT5/);a.ok(s.text.length<4096);}
 a.ok(d.trades.some(t=>t.profit<0));a.ok(d.clients.some(u=>u.status==='expired'));
 const tf15=d.signals.find(s=>s.tf==='TF15'&&s.type==='TP');a.match(tf15.text,/4116\.00/);
});
test('demo login, sessions and controls are isolated from live routes and from other demo sessions',async()=>{
 let now=Date.now();const credentials={email:'test@example.invalid',salt:'test-salt',hash:crypto.scryptSync('test-password','test-salt',64).toString('hex')};
 const handler=createDemoHandler({secure:false,credentials,now:()=>now}),server=http.createServer(async(req,res)=>{if(!await handler(req,res,new URL(req.url,'http://localhost').pathname)){res.writeHead(418);res.end('live-route-not-handled');}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 const request=(path,body,cookie,origin=base)=>fetch(base+path,{headers:{...(cookie?{Cookie:cookie}:{}),...(body!==undefined?{Origin:origin,'Content-Type':'application/json'}:{})},...(body!==undefined?{method:'POST',body:JSON.stringify(body)}:{})});
 try{
  a.equal((await request('/demo/ib/data')).status,401);a.equal((await request('/demo/ib/login',{email:credentials.email,password:'wrong'})).status,401);
  a.equal((await request('/demo/ib/login',{email:credentials.email,password:'test-password'},null,'https://evil.invalid')).status,403);
  const login=async()=>{const r=await request('/demo/ib/login',{email:credentials.email,password:'test-password'});a.equal(r.status,200);a.match(r.headers.get('set-cookie'),/Path=\/demo; HttpOnly; SameSite=Strict/);return r.headers.get('set-cookie').split(';')[0];};
  const one=await login(),two=await login();a.notEqual(one,two);
  const read=async c=>(await request('/demo/ib/data',undefined,c)).json();
  a.equal((await request('/api/ib/overview',undefined,one)).status,418,'demo cannot authenticate or implement live APIs');
  a.equal((await request('/demo/ib/client',{id:'DEMO-1001',status:'disabled'},one)).status,200);
  a.equal((await read(one)).clients[0].status,'disabled');a.equal((await read(two)).clients[0].status,'active');
  a.equal((await request('/demo/ib/client',{id:'DEMO-1010',status:'active'},one)).status,403,'IB cannot renew expired users');
  a.equal((await request('/demo/ib/settings',{tf:'TF2',lot:.02,layers:3,enabled:false},one)).status,200);a.equal((await read(one)).settings.TF2.lot,.02);a.equal((await read(two)).settings.TF2.lot,.01);a.equal((await read(one)).settings.TF15.lot,.01);
  a.equal((await request('/demo/ib/settings',{tf:'TF2',lot:-1,layers:3,enabled:false},one)).status,400);
  a.equal((await request('/demo/ib/message',{userIds:['real-user'],message:'reject'},one)).status,400);
  const m=await (await request('/demo/ib/message',{userIds:['DEMO-1001'],message:'<script>example</script>'},one)).json();a.equal(m.message.status,'SIMULATED_ONLY');a.match(m.message.text,/TIDAK DIHANTAR KE TELEGRAM/);a.equal((await read(two)).messages.length,0);
  a.equal((await request('/demo/ib/send-real-order',{},one)).status,404);
  await request('/demo/ib/reset',{},one);a.equal((await read(one)).messages.length,0);a.equal((await read(one)).clients[0].status,'active');a.equal((await read(one)).settings.TF2.lot,.01);
  await request('/demo/ib/logout',{},one);a.equal((await request('/demo/ib/data',undefined,one)).status,401);
  now+=8*60*60*1000+1;a.equal((await request('/demo/ib/data',undefined,two)).status,401);
  a.equal((await request('/demo/ib/app.js')).status,200);a.equal((await request('/demo/ib-not-a-demo')).status,418);
 }finally{await new Promise(r=>server.close(r));}
});
test('presentation reuses production assets and only serves an explicit safe API model',async()=>{
 const V=require('../ib-demo-real-view'),fs=require('node:fs'),s={data:dataset(),messages:[]},now=Date.now();
 a.equal(V.page('/demo/ib/view/analysis'),'precision-entry.html');a.equal(V.page('/demo/ib/view/ib'),'ib.html');a.equal(V.page('/demo/ib/view/admin'),null);
 a.equal(V.asset('analysis-dual.css'),fs.readFileSync(require.resolve('../analysis-dual.css'),'utf8'));a.equal(V.asset('server-analysis.js'),null);a.equal(V.asset('../auth-store.js'),null);
 a.match(V.html('precision-entry.html'),/\/demo\/ib\/assets\/indicator-chart.js/);a.match(V.asset('detail.js'),/ZenCoreDemoLocation.pathname/);
 const v=await V.api(s,'/api/analysis/timeframes?symbol=XAUUSD','GET',{},now);a.equal(v.views.length,2);for(const x of v.views){a.ok(x.market.close>x.market.strategyNormal.plan.entry);a.ok(x.market.close>x.market.open);a.ok(x.market.hema20>x.market.hema40);}a.equal(V.state(s,now).positions[0].currentPrice,v.views[0].market.price);a.equal((await V.api(s,'/api/analysis/chart?tf=2','GET',{},now)).candles.length,90);
 const records=await V.api(s,'/api/signal-records','GET',{},now);a.equal(require('../results-core').fromStoredRecords(records).summary.sample,40);a.equal((await V.api(s,'/api/signal-outcomes','GET',{},now)).records.length,40);
 const cs=await V.api(s,'/api/ib/overview','GET',{},now);a.equal(cs.clients.length,12);a.equal((await V.api(s,'/api/ib/connections','GET',{},now)).accounts.length,12);
 await a.rejects(V.api(s,'/api/admin/clients','GET',{},now),{status:403});await a.rejects(V.api(s,'/api/auto-trade/hosted-account','POST',{password:'not-stored'},now),{status:403});a.equal(JSON.stringify(s).includes('not-stored'),false);
 await V.api(s,'/api/auto-trade/stop','POST',{},now);a.equal((await V.api(s,'/api/auto-trade/state','GET',{},now)).control.effectiveState,'STOPPED');
 const signals=await V.api(s,'/api/demo/signals','GET',{},now);a.ok(signals.signals.every(x=>!/dummy/i.test(x.text)));a.equal(signals.signals.length,18);
});
