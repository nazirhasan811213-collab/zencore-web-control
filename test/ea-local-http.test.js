const test=require('node:test');
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const base='http://127.0.0.1:18873';
test('desktop login cookie can pair EA, origin and unauthenticated requests remain protected',async()=>{
 const child=spawn(process.execPath,['-r','./compat-v17.js','server-analysis.js'],{cwd:root,env:{...process.env,
   NODE_ENV:'test',SITE_MODE:'precision-entry',PORT:'18873',ZENCORE_AUTH_ENABLED:'true',ZENCORE_AUTH_MEMORY:'true',ZENCORE_INSECURE_COOKIE:'true',
   ZENCORE_AUTOTRADE_ENABLED:'true',ZENCORE_AUTOTRADE_EXECUTION_ENABLED:'true',ZENCORE_AUTOTRADE_MEMORY:'true',
   ZENCORE_HOSTED_MT5_ENABLED:'false',ZENCORE_GCP_HOSTED_WORKER_ENABLED:'false',
   ZENCORE_COMMAND_SIGNING_KEY:'ea-http-test-key-more-than-32-characters'},stdio:['ignore','pipe','pipe']});
 try{
  await new Promise((resolve,reject)=>{
   let log='';const timer=setTimeout(()=>reject(new Error('HTTP server start timeout')),15000);
   child.stdout.on('data',chunk=>{log+=chunk;if(log.includes('authentication ready') && log.includes('Auto Trade control plane ready')){clearTimeout(timer);resolve();}});
   child.once('exit',code=>{clearTimeout(timer);reject(new Error('HTTP server exit '+code));});
  });
  let response=await fetch(base+'/api/auto-trade/ea-connect',{method:'POST',headers:{Accept:'application/json',Origin:base}});
  assert.equal(response.status,401);
  response=await fetch(base+'/auth/register',{method:'POST',headers:{Accept:'application/json',Origin:base,'Content-Type':'application/json'},
   body:JSON.stringify({displayName:'EA HTTP Trader',email:'ea-http-test@example.com',phone:'0123456782',ibCode:'nazir',password:'TestOnly2026!',riskAccepted:true})});
  assert.equal(response.status,201);const cookie=response.headers.get('set-cookie').split(';')[0];
  response=await fetch(base+'/api/auto-trade/ea-connect',{method:'POST',headers:{Accept:'application/json',Cookie:cookie,Origin:'https://untrusted.example'}});
  assert.equal(response.status,403);
  response=await fetch(base+'/api/auto-trade/ea-connect',{method:'POST',headers:{Accept:'application/json',Cookie:cookie,Origin:base,'Content-Type':'application/json'},body:'{}'});
  assert.equal(response.status,201);assert.match(response.headers.get('content-type'),/json/);const paired=await response.json();assert.match(paired.podToken,/^zcpod_/);
  response=await fetch(base+'/api/auto-trade/state',{headers:{Accept:'application/json',Cookie:cookie}});
  assert.match(response.headers.get('content-type'),/json/, 'State URL: '+response.url+' status '+response.status+' body '+(await response.clone().text()).slice(0,250));
  const state=await response.json();assert.equal(state.pod.ownershipMode,'TRADER_OWNED_EA_LOCAL');
  assert.equal(state.connection.ready,false);assert.equal(JSON.stringify(state).includes(paired.podToken),false);
  response=await fetch(base+'/api/auto-trade/reset-link',{method:'POST',headers:{Accept:'application/json',Origin:base}});assert.equal(response.status,401);
  response=await fetch(base+'/api/auto-trade/reset-link',{method:'POST',headers:{Accept:'application/json',Cookie:cookie,Origin:'https://untrusted.example'}});assert.equal(response.status,403);
  response=await fetch(base+'/api/auto-trade/reset-link',{method:'POST',headers:{Accept:'application/json',Cookie:cookie,Origin:base},body:'{}'});assert.equal(response.status,200);
  response=await fetch(base+'/api/execution/link-status',{headers:{Authorization:'Bearer '+paired.podToken}});assert.equal(response.status,401);assert.equal((await response.json()).code,'INVALID_POD_TOKEN');

 }finally{child.kill();await new Promise(resolve=>{if(child.exitCode!==null)resolve();else child.once('exit',resolve);});}
});
