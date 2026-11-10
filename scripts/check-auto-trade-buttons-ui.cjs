'use strict';
const {chromium}=require('playwright'),fs=require('node:fs'),a=require('node:assert/strict'),V=require('../ib-demo-real-view'),{dataset}=require('../ib-demo-data');
(async()=>{
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']}),page=await browser.newPage({viewport:{width:1280,height:1000}}),errors=[],calls=[];
 let effective='STOPPED',diagnostics='failure',stopFails=true,acceptDialog=false;
 const initial=V.state({data:dataset()},Date.now()).settings;
 const state=()=>{const s=V.state({data:dataset()},Date.now());s.settings=structuredClone(initial);s.control.desiredState=effective;s.control.effectiveState=effective;s.control.canEnter=effective==='ON';return s;};
 page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>acceptDialog?d.accept():d.dismiss());
 await page.route('**/*',async r=>{const p=new URL(r.request().url()).pathname,method=r.request().method();
  if(p==='/auth/me')return r.fulfill({json:{ok:true,user:{id:'test-only',role:'client',status:'active'}}});
  if(p==='/api/auto-trade/state')return r.fulfill({json:state()});
  if(p==='/api/auto-trade/execution-diagnostics')return r.fulfill(diagnostics==='failure'?{status:503,json:{error:'Diagnostic test failure'}}:{json:{commands:[{type:'PLACE_SETUP',symbol:'XAUUSD',timeframe:'2',status:'FAILED',resultCode:'LEASE_EXPIRED',createdAt:Date.now()}]}});
  if(method==='POST'&&p.startsWith('/api/auto-trade/')){
   const body=r.request().postDataJSON();calls.push({p,body});
   if(p.endsWith('/on')){if(body.confirmation!=='AKTIFKAN DEMO')return r.fulfill({status:400,json:{error:'Pengesahan ON tidak sah.'}});effective='ON';}
   else if(p.endsWith('/stop')){if(stopFails)return r.fulfill({status:503,json:{error:'STOP ujian ditolak.'}});effective='STOPPED';}
   else if(p.endsWith('/emergency-close')){if(body.confirmation!=='TUTUP SEMUA'||body.password!=='TestOnly2026!')return r.fulfill({status:403,json:{error:'Pengesahan close ujian ditolak.'}});effective='EMERGENCY_CLOSING';}
   else throw Error('Unexpected mutation '+p);
   return r.fulfill({json:state()});
  }
  const file=p==='/auto-trade'?'auto-trade.html':p.slice(1);
  if(/^[\w.-]+\.(html|css|js)$/.test(file)&&fs.existsSync(file))return r.fulfill({body:fs.readFileSync(file),contentType:file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html'});
  return r.fulfill({json:{ok:true,markets:[],commands:[]}});
 });
 try{
  await page.goto('http://localhost/auto-trade');await page.getByText('Diagnostik belum tersedia. Status MT5 dan kawalan Auto Trade dikekalkan.',{exact:true}).waitFor({state:'attached'});
  a.equal(await page.locator('#masterStateText').innerText(),'STOPPED');a.equal(await page.locator('#turnOnButton').isEnabled(),true);
  const values=async()=>page.locator('#settingsForm input,#settingsForm select').evaluateAll(xs=>xs.map(x=>[x.id,x.value,x.type==='checkbox'?x.checked:null]));const before=await values();
  await page.locator('#turnOnButton').click();await page.locator('#onDialog .dialog-cancel').click();a.equal(calls.length,0);
  await page.locator('#turnOnButton').click();await page.locator('#onConfirmation').fill('WRONG');await page.locator('#confirmOnButton').click();await page.getByText('Pengesahan ON tidak sah.',{exact:true}).waitFor();a.equal(await page.locator('#confirmOnButton').isEnabled(),true);
  await page.locator('#onConfirmation').fill('AKTIFKAN DEMO');await page.locator('#confirmOnButton').click();await page.waitForFunction(()=>document.getElementById('masterStateText').textContent==='ON');a.equal(await page.locator('#turnOnButton').isDisabled(),true);
  await page.locator('#stopButton').click();a.equal(calls.filter(x=>x.p.endsWith('/stop')).length,0,'cancel never sends STOP');
  acceptDialog=true;await page.locator('#stopButton').click();await page.getByText('STOP ujian ditolak.',{exact:true}).waitFor();a.equal(await page.locator('#stopButton').isEnabled(),true);
  stopFails=false;await page.locator('#stopButton').click();await page.waitForFunction(()=>document.getElementById('masterStateText').textContent==='STOPPED');a.equal(await page.locator('#stopButton').isDisabled(),true);
  diagnostics='legacy';await page.locator('#executionDiagnostics').getByText(/LEASE_EXPIRED/).waitFor({state:'attached',timeout:10000});a.equal(await page.locator('#masterStateText').innerText(),'STOPPED');
  await page.locator('#emergencyButton').click();await page.locator('#emergencyDialog .dialog-cancel').click();a.equal(calls.filter(x=>x.p.endsWith('/emergency-close')).length,0);
  await page.locator('#emergencyButton').click();await page.locator('#emergencyPassword').fill('WrongTestOnly');await page.locator('#confirmEmergencyButton').click();await page.getByText('Pengesahan close ujian ditolak.',{exact:true}).waitFor();a.equal(await page.locator('#emergencyPassword').inputValue(),'');a.equal(await page.locator('#confirmEmergencyButton').isEnabled(),true);
  await page.locator('#emergencyPassword').fill('TestOnly2026!');await page.locator('#emergencyConfirmation').fill('TUTUP SEMUA');await page.locator('#confirmEmergencyButton').click();await page.waitForFunction(()=>document.getElementById('masterStateText').textContent==='EMERGENCY CLOSING');a.equal(await page.locator('#emergencyButton').isDisabled(),true);
  a.deepEqual(await values(),before,'ON/STOP/close and diagnostic refresh preserve every setting');a.deepEqual(errors,[]);
  console.log('Auto Trade buttons passed: cancel, rejection/retry, ON, STOP, mocked close, diagnostics failure/missing checks, all settings preserved. No live API or broker orders.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
