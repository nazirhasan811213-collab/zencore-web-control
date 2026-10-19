'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{spawn}=require('node:child_process'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
test('monitoring HTTP routes enforce admin role and serve the working admin snapshot',{timeout:20000},async()=>{
 const root=path.resolve(__dirname,'..'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'zc-monitor-')),preload=path.join(dir,'seed.cjs'),base='http://127.0.0.1:18791';
 fs.writeFileSync(preload,`const {MemoryAuthStore}=require(${JSON.stringify(path.join(root,'auth-store'))}); const {hashPassword}=require(${JSON.stringify(path.join(root,'auth-core'))}); const original=MemoryAuthStore.prototype.init;MemoryAuthStore.prototype.init=async function(){await original.call(this);for(const role of ['admin','client']){const u=await this.upsertPublicViewer({displayName:role,email:role+'@monitor.test',passwordHash:await hashPassword('MonitorTest2026!')});await this.setUserRole(u.id,role);}};`);
 const webhookSecret='http-test-webhook-secret-at-least-32-characters';
 const child=spawn(process.execPath,['-r',preload,'-r','./compat-v17.js','server-analysis.js'],{cwd:root,env:{...process.env,DATABASE_URL:'',PORT:'18791',NODE_ENV:'test',SITE_MODE:'precision-entry',ZENCORE_AUTH_ENABLED:'true',ZENCORE_AUTH_MEMORY:'true',ZENCORE_INSECURE_COOKIE:'true',ZENCORE_AUTOTRADE_ENABLED:'true',ZENCORE_AUTOTRADE_MEMORY:'true',ZENCORE_HOSTED_MT5_ENABLED:'false',ZENCORE_GCP_HOSTED_WORKER_ENABLED:'false',ZENCORE_PUBLIC_VIEWER_ENABLED:'false',ZENCORE_TELEGRAM_BOT_TOKEN:'',ZENCORE_WEBHOOK_SECRET:webhookSecret,ZENCORE_COMMAND_SIGNING_KEY:'monitor-test-signing-key-at-least-32-bytes'},stdio:['ignore','pipe','pipe']});
 try{
  await new Promise((resolve,reject)=>{let output='';const timer=setTimeout(()=>reject(new Error('Test server did not start')),12000);child.stdout.on('data',d=>{output+=d;if(output.includes('Auto Trade control plane ready')){clearTimeout(timer);resolve();}});child.once('exit',()=>{clearTimeout(timer);reject(new Error('Test server exited'));});});
  const postWebhook=body=>fetch(base+'/webhook',{method:'POST',headers:{'Content-Type':'application/json'},body});
  assert.equal((await postWebhook(JSON.stringify({emittedAt:Date.now(),markets:[]}))).status,401);
  assert.equal((await postWebhook(JSON.stringify({authToken:webhookSecret,emittedAt:Date.now()-31000,markets:[]}))).status,409);
  assert.equal((await postWebhook('x'.repeat(160001))).status,413);
  const accepted=await postWebhook(JSON.stringify({authToken:webhookSecret,emittedAt:Date.now(),timeframe:'2',markets:[]}));
  assert.equal(accepted.status,200);assert.equal((await accepted.text()).includes(webhookSecret),false);
  let ready;
  for(let i=0;i<25;i++){ready=await fetch(base+'/ready');if(ready.status===200)break;await new Promise(r=>setTimeout(r,100));}
  assert.equal(ready.status,200);const readiness=await ready.json();assert.equal(readiness.database,'READY');assert.equal(readiness.dispatcher,'READY');assert.equal(readiness.webhook,'AUTHENTICATED');
  assert.equal((await fetch(base+'/api/admin/user-trade-monitor')).status,401);
  assert.equal((await fetch(base+'/admin/user-trade-monitor',{redirect:'manual'})).status,302);
  const anon=await fetch(base+'/api/admin/monitoring');assert.equal(anon.status,401);
  const page=await fetch(base+'/admin/monitoring',{redirect:'manual'});assert.equal(page.status,302);
  for(const role of ['client','admin']){
   const login=await fetch(base+'/auth/login',{method:'POST',headers:{'Content-Type':'application/json',Origin:base},body:JSON.stringify({email:role+'@monitor.test',password:'MonitorTest2026!'})});assert.equal(login.status,200);const cookie=login.headers.get('set-cookie').split(';')[0];
   const api=await fetch(base+'/api/admin/monitoring',{headers:{Cookie:cookie}});assert.equal(api.status,role==='admin'?200:403);
   const tradeMonitor=await fetch(base+'/api/admin/user-trade-monitor',{headers:{Cookie:cookie}});assert.equal(tradeMonitor.status,role==='admin'?200:403);
   if(role==='admin'){
    for(const query of ['after=bad','before=0','after=2000&before=1000'])assert.equal((await fetch(base+'/api/admin/activity?'+query,{headers:{Cookie:cookie}})).status,400);
    const historical=await fetch(base+'/api/admin/activity?after=1&before=2',{headers:{Cookie:cookie}});assert.equal(historical.status,200);assert.deepEqual((await historical.json()).events,[]);
    const list=await tradeMonitor.json();assert.equal(list.rows.length,1);assert.equal(list.rows[0].brokerStatus,'MISSING');assert.equal(list.rows[0].mt5ServerName,null);const view=await fetch(base+'/admin/user-trade-monitor',{headers:{Cookie:cookie}});assert.equal(view.status,200);assert.match(await view.text(),/admin-user-trade.js/);const update=(origin)=>fetch(base+'/api/admin/user-trade-monitor',{method:'POST',headers:{Cookie:cookie,Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({inactiveDays:30,referenceServers:['AdminBroker-Live']})});assert.equal((await update('https://untrusted.test')).status,403);assert.equal((await update(base)).status,200);}
   const notifications=await fetch(base+'/api/admin/monitoring/notifications',{headers:{Cookie:cookie}});assert.equal(notifications.status,role==='admin'?200:403);
   if(role==='admin'){const prefs=await notifications.json();assert.equal(prefs.enabled,false);const post=enabled=>fetch(base+'/api/admin/monitoring/notifications',{method:'POST',headers:{Cookie:cookie,Origin:base,'Content-Type':'application/json'},body:JSON.stringify({enabled})});assert.equal((await post(true)).status,400);assert.equal((await post(false)).status,200);const denied=await fetch(base+'/api/admin/monitoring/notifications',{method:'POST',headers:{Cookie:cookie,Origin:'https://untrusted.test','Content-Type':'application/json'},body:'{"enabled":false}'});assert.equal(denied.status,403);}
   if(role==='admin'){assert.match(api.headers.get('cache-control'),/no-store/);const body=await api.json();assert.equal(body.ok,true);assert.ok(body.components.some(c=>c.id==='feed2'));assert.ok(body.components.some(c=>c.id==='feed15'));assert.equal(body.accounts.length,1);const view=await fetch(base+'/admin/monitoring',{headers:{Cookie:cookie}});assert.equal(view.status,200);assert.match(await view.text(),/admin-monitoring.js/);}
  }
  for(const [file,mime] of [['admin-user-trade.js','javascript'],['admin-user-trade.css','text/css']]){const asset=await fetch(base+'/'+file);assert.equal(asset.status,200);assert.match(asset.headers.get('content-type'),new RegExp(mime));}
  assert.equal((await fetch(base+'/admin-monitoring.js')).status,200);assert.equal((await fetch(base+'/admin-monitoring.css')).status,200);
 }finally{await new Promise(resolve=>{child.once('exit',resolve);child.kill('SIGTERM');setTimeout(()=>{child.kill('SIGKILL');resolve();},1000).unref();});fs.rmSync(dir,{recursive:true,force:true});}
});

