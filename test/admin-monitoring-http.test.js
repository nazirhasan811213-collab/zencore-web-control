'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{spawn}=require('node:child_process'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
test('monitoring HTTP routes enforce admin role and serve the working admin snapshot',{timeout:20000},async()=>{
 const root=path.resolve(__dirname,'..'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'zc-monitor-')),preload=path.join(dir,'seed.cjs'),base='http://127.0.0.1:18791';
 fs.writeFileSync(preload,`const {MemoryAuthStore}=require(${JSON.stringify(path.join(root,'auth-store'))}); const {hashPassword}=require(${JSON.stringify(path.join(root,'auth-core'))}); const original=MemoryAuthStore.prototype.init;MemoryAuthStore.prototype.init=async function(){await original.call(this);for(const role of ['admin','client']){const u=await this.upsertPublicViewer({displayName:role,email:role+'@monitor.test',passwordHash:await hashPassword('MonitorTest2026!')});await this.setUserRole(u.id,role);}};`);
 const child=spawn(process.execPath,['-r',preload,'-r','./compat-v17.js','server-analysis.js'],{cwd:root,env:{...process.env,DATABASE_URL:'',PORT:'18791',NODE_ENV:'test',SITE_MODE:'precision-entry',ZENCORE_AUTH_ENABLED:'true',ZENCORE_AUTH_MEMORY:'true',ZENCORE_INSECURE_COOKIE:'true',ZENCORE_AUTOTRADE_ENABLED:'true',ZENCORE_AUTOTRADE_MEMORY:'true',ZENCORE_HOSTED_MT5_ENABLED:'false',ZENCORE_GCP_HOSTED_WORKER_ENABLED:'false',ZENCORE_PUBLIC_VIEWER_ENABLED:'false',ZENCORE_TELEGRAM_BOT_TOKEN:'',ZENCORE_COMMAND_SIGNING_KEY:'monitor-test-signing-key-at-least-32-bytes'},stdio:['ignore','pipe','pipe']});
 try{
  await new Promise((resolve,reject)=>{let output='';const timer=setTimeout(()=>reject(new Error('Test server did not start')),12000);child.stdout.on('data',d=>{output+=d;if(output.includes('Auto Trade control plane ready')){clearTimeout(timer);resolve();}});child.once('exit',()=>{clearTimeout(timer);reject(new Error('Test server exited'));});});
  const anon=await fetch(base+'/api/admin/monitoring');assert.equal(anon.status,401);
  const page=await fetch(base+'/admin/monitoring',{redirect:'manual'});assert.equal(page.status,302);
  for(const role of ['client','admin']){
   const login=await fetch(base+'/auth/login',{method:'POST',headers:{'Content-Type':'application/json',Origin:base},body:JSON.stringify({email:role+'@monitor.test',password:'MonitorTest2026!'})});assert.equal(login.status,200);const cookie=login.headers.get('set-cookie').split(';')[0];
   const api=await fetch(base+'/api/admin/monitoring',{headers:{Cookie:cookie}});assert.equal(api.status,role==='admin'?200:403);
   if(role==='admin'){assert.match(api.headers.get('cache-control'),/no-store/);const body=await api.json();assert.equal(body.ok,true);assert.ok(body.components.some(c=>c.id==='feed2'));assert.ok(body.components.some(c=>c.id==='feed15'));assert.equal(body.accounts.length,1);const view=await fetch(base+'/admin/monitoring',{headers:{Cookie:cookie}});assert.equal(view.status,200);assert.match(await view.text(),/admin-monitoring.js/);}
  }
  assert.equal((await fetch(base+'/admin-monitoring.js')).status,200);assert.equal((await fetch(base+'/admin-monitoring.css')).status,200);
 }finally{await new Promise(resolve=>{child.once('exit',resolve);child.kill('SIGTERM');setTimeout(()=>{child.kill('SIGKILL');resolve();},1000).unref();});fs.rmSync(dir,{recursive:true,force:true});}
});
