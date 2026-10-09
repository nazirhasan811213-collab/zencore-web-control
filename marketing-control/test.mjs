import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test('Founder approval gates and no publisher',async()=>{
 const tmp=await mkdtemp(path.join(os.tmpdir(),'zc-marketing-'));
 const port=20000+Math.floor(Math.random()*20000);
 const child=spawn(process.execPath,['server.mjs'],{cwd:path.dirname(new URL(import.meta.url).pathname),env:{...process.env,MARKETING_PORT:String(port),MARKETING_STORE:path.join(tmp,'store.json'),MARKETING_FOUNDER_KEY:'founder-test-secret',MARKETING_AGENT_KEY:'agent-test-secret'},stdio:'ignore'});
 const call=async(route,token,method='GET',payload)=>fetch('http://127.0.0.1:'+port+route,{method,headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:payload?JSON.stringify(payload):undefined});
 try{
  let alive=false;for(let i=0;i<80;i++){try{const x=await call('/health','agent-test-secret');if(x.ok){alive=true;break;}}catch{}await new Promise(r=>setTimeout(r,50));}
  assert.equal(alive,true,'server started');
  const draft=await call('/api/marketing/drafts','agent-test-secret','POST',{title:'Launch',caption:'ZenCore coming soon',channel:'facebook'});
  assert.equal(draft.status,201);const {item}=await draft.json();
  assert.equal((await call('/api/marketing/items/'+item.id+'/approve','agent-test-secret','POST')).status,403);
  assert.equal((await call('/api/marketing/items/'+item.id+'/submit','agent-test-secret','POST')).status,200);
  assert.equal((await call('/api/marketing/items/'+item.id+'/approve','founder-test-secret','POST')).status,200);
  assert.equal((await call('/api/marketing/items/'+item.id+'/publish','founder-test-secret','POST')).status,423);
  const settings=await (await call('/api/marketing/settings','founder-test-secret')).json();
  assert.equal(settings.publishingEnabled,false);
  assert.equal(settings.requiresFounderApproval,true);
 } finally {child.kill();await rm(tmp,{recursive:true,force:true});}
});
