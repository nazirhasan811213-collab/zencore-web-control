'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{spawn}=require('node:child_process');
const routes=require('../signal-desk-routes');
test('Native bridge fetches only same-origin GET data in paired mode and validates parent messages',async()=>{
 const vm=require('node:vm'),handlers={},requests=[],packets=[],parent={},status={style:{},setAttribute(){}};
 let mode='inactive',tf='2',interval;
 const desk={getView:()=>mode,getTimeframe:()=>tf,setTimeframe:value=>{tf=value;},acceptHostPacket:packet=>packets.push(packet)};
 const context={window:{ZenCoreFusionDesk:desk,addEventListener:(name,fn)=>handlers[name]=fn},parent,location:{origin:'https://errante.test',search:''},URLSearchParams,document:{hidden:false,createElement:()=>status,querySelector:selector=>selector.startsWith('meta')?{content:'errante'}:{after(){}},addEventListener:(name,fn)=>handlers[name]=fn},AbortController,Date,setTimeout,clearTimeout,setInterval:fn=>{interval=fn;},fetch:async(url,opts)=>{requests.push({url,opts});return {ok:true,json:async()=>url.includes('/chart')?{ok:true,symbol:'XAUUSD',timeframe:tf,source:'PINE_FEED',candles:[]}:{ok:true,symbol:'XAUUSD',views:[{timeframe:Number(tf),market:{symbol:'XAUUSD',timeframe:tf,close:100,receivedAt:1000,signalObservedAt:999,account:{private:'excluded'}}}]}};}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../signal-desk-native/native-host.js'),'utf8'),context);
 assert.equal(requests.length,0,'inactive reports do not fetch data');
 handlers.message({origin:'https://wrong.test',source:parent,data:{type:'zencore-desk-timeframe',tf:'15'}});assert.equal(tf,'2');
 handlers.message({origin:context.location.origin,source:{},data:{type:'zencore-desk-timeframe',tf:'15'}});assert.equal(tf,'2');
 mode='paired';await interval();assert.equal(requests.length,2);assert.equal(packets.length,1);assert.equal(packets[0].pine.account,undefined);assert.equal(packets[0].pine.signalObservedAt,999);assert.equal(packets[0].pine.confirmed,undefined);
 for(const request of requests){assert.equal(request.opts.method,undefined);assert.equal(request.opts.credentials,'same-origin');assert.match(request.url,/^\/api\/analysis\/(timeframes|chart)\?/);}
 handlers.message({origin:context.location.origin,source:parent,data:{type:'zencore-desk-timeframe',tf:'15'}});await new Promise(resolve=>setImmediate(resolve));assert.equal(tf,'15');assert.equal(packets.at(-1).pine.timeframe,'15');
});
test('Signal Desk is limited to authenticated Errante; bundle integrity matches shared source',()=>{
 assert.equal(routes.enabled({ZENCORE_AUTH_ENABLED:'true',ZENCORE_PRODUCT_NAME:'ZenCore Errante'}),true);
 for(const env of [{},{ZENCORE_AUTH_ENABLED:'true'},{ZENCORE_PRODUCT_NAME:'ZenCore Errante'},{ZENCORE_AUTH_ENABLED:'false',ZENCORE_PRODUCT_NAME:'ZenCore Errante'}])assert.equal(routes.enabled(env),false);
 const manifest=require('../signal-desk/bundle-manifest.json');assert.equal(Object.keys(manifest.files).length,9);
 for(const [file,hash]of Object.entries(manifest.files))assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname,'../signal-desk',file))).digest('hex'),hash);
 const F=require('../signal-desk/fusion');
 const now=Date.now(),time=now-240000,packet={mode:'ZENCORE_READONLY',pine:{symbol:'XAUUSD',timeframe:'2',signalObservedAt:now,receivedAt:now,close:100},history:{symbol:'XAUUSD',timeframe:'2',candles:[{time,open:100,high:101,low:99,close:100}]}};
 assert.equal(F.normalize(packet).mode,'MANUAL');
 const verified=F.normalize(packet,{originVerified:true});assert.equal(verified.mode,'ZENCORE_READONLY');
 assert.equal(F.analyze(verified).orderExecution,false);assert.equal(F.analyze(verified).liveSignal,false);
});
test('Desk routes fail closed before serving any file and reject write/traversal paths',async()=>{
 let auth=0,assets=0;const res={writeHead(){},end(){}};
 const handler=routes.createHandler({active:true,requireSession:async()=>{auth++;return null;},sendAsset:()=>assets++,sendJson(){}});
 assert.equal(await handler({method:'GET'},res,'/signal-desk/app.js'),true);assert.equal(auth,1);assert.equal(assets,0);
 let code;const active=routes.createHandler({active:true,requireSession:async()=>({user:{}}),sendAsset:()=>assets++,sendJson:(_res,status)=>code=status});
 await active({method:'POST'},res,'/signal-desk/');assert.equal(code,405);
 for(const route of ['/signal-desk/../server-analysis.js','/signal-desk/%2e%2e/server-analysis.js','/signal-desk/bundle-manifest.json','/signal-desk/native-host.js/extra']){await active({method:'GET'},res,route);assert.equal(code,404);}
 assert.equal(assets,0);
});
test('HTTP integration requires login for document and every asset, allows only same-origin embedding', {timeout:25000},async()=>{
 const base='http://127.0.0.1:18889';
 const child=spawn(process.execPath,['-r','./compat-v17.js','-r','./test/helpers/seed-admin.cjs','server-analysis.js'],{cwd:path.resolve(__dirname,'..'),env:{...process.env,NODE_ENV:'test',PORT:'18889',SITE_MODE:'precision-entry',ZENCORE_PRODUCT_NAME:'ZenCore Errante',ZENCORE_AUTH_ENABLED:'true',ZENCORE_AUTH_MEMORY:'true',ZENCORE_INSECURE_COOKIE:'true',ZENCORE_AUTOTRADE_ENABLED:'false'},stdio:['ignore','pipe','pipe']});
 try{
  await new Promise((resolve,reject)=>{let log='';const timer=setTimeout(()=>reject(Error('Test server not ready')),12000);const read=b=>{log+=b;if(log.includes('authentication ready')&&log.includes('gateway running')){clearTimeout(timer);resolve();}};child.stdout.on('data',read);child.stderr.on('data',read);child.once('exit',()=>{clearTimeout(timer);reject(Error('Test server exited before ready'));});});
  for(const route of ['/signal-desk/','/signal-desk/app.js','/signal-desk/native-host.js','/signal-desk/native-mount.css']){const r=await fetch(base+route,{redirect:'manual'});assert.equal(r.status,302);assert.equal(r.headers.get('location'),'/login');}
  const bridgeLogin=await fetch(base+'/signal-desk/?bridge=1&view=live',{redirect:'manual'});assert.equal(bridgeLogin.status,302);assert.equal(bridgeLogin.headers.get('location'),'/login?desk=1');
  const login=await fetch(base+'/auth/login',{method:'POST',headers:{'Content-Type':'application/json',Origin:base,Accept:'application/json'},body:JSON.stringify({email:'test-admin@example.com',password:'AdminFixture2026!'})});assert.equal(login.status,200);
  const headers={Cookie:login.headers.get('set-cookie').split(';')[0]};
  const returnToBridge=await fetch(base+'/login?desk=1&next=https://untrusted.test',{headers,redirect:'manual'});assert.equal(returnToBridge.status,302);assert.equal(returnToBridge.headers.get('location'),'/signal-desk/?bridge=1&view=live');
  const defaultLanding=await fetch(base+'/login',{headers,redirect:'manual'});assert.equal(defaultLanding.headers.get('location'),'/app');
  let r=await fetch(base+'/analysis',{headers});assert.equal(r.status,200);assert.match(await r.text(),/signal-desk\/native-mount.js/);
  r=await fetch(base+'/signal-desk/?embed=1',{headers});assert.equal(r.status,200);assert.equal(r.headers.get('x-frame-options'),'SAMEORIGIN');assert.match(r.headers.get('content-security-policy'),/frame-ancestors 'self'/);const html=await r.text();assert.match(html,/name="zencore-desk-host"/);assert.match(html,/data-view="live" aria-pressed="true"/);assert.match(html,/id="fusion-panel" hidden/);
  for(const asset of ['styles.css','app.js','evidence.js','fusion.js','fusion-ui.js','native-host.js','native-mount.js','native-mount.css']){r=await fetch(base+'/signal-desk/'+asset,{headers});assert.equal(r.status,200,asset);}
  r=await fetch(base+'/signal-desk/no-file.js',{headers});assert.equal(r.status,404);
  r=await fetch(base+'/signal-desk/',{method:'POST',headers});assert.equal(r.status,405);
 }finally{child.kill('SIGTERM');await new Promise(resolve=>{if(child.exitCode!==null)return resolve();const timer=setTimeout(()=>child.kill('SIGKILL'),2500);child.once('exit',()=>{clearTimeout(timer);resolve();});});}
});
