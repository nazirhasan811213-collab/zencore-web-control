'use strict';
const {chromium}=require('playwright'),fs=require('node:fs'),a=require('node:assert/strict'),V=require('../ib-demo-real-view'),{dataset}=require('../ib-demo-data'),Core=require('../auto-trade-core');
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),args:['--no-sandbox']}),page=await browser.newPage({viewport:{width:1280,height:1000}}),errors=[];let saved={enabled:true,tp1:1.5,tp2:2.5,tp3:3.5,sl:4},posted=null;
 page.on('pageerror',e=>errors.push(e.message));
 const state=()=>{const s=V.state({data:dataset()},Date.now());s.settings.manualExit=saved;s.control.desiredState='STOPPED';s.pod.manualExitVersion='MANUAL_TF2_EXIT_V3';return s;};
 await page.route('**/*',async r=>{const p=new URL(r.request().url()).pathname;
  if(p==='/auth/me')return r.fulfill({json:{ok:true,user:{id:'test',role:'client',status:'active'}}});
  if(p==='/api/auto-trade/state')return r.fulfill({json:state()});
  if(p==='/api/auto-trade/manual-exit'){posted=r.request().postDataJSON();const validation=Core.validateSettings({manualExit:posted});a.equal(Object.keys(validation.errors).some(k=>k.startsWith('manualExit.')),false);saved=validation.value.manualExit;return r.fulfill({json:state()});}
  if(p==='/api/auto-trade/settings'){posted=r.request().postDataJSON();const validation=Core.validateSettings(posted);a.equal(validation.ok,true,JSON.stringify(validation.errors));saved=validation.value.manualExit;return r.fulfill({json:state()});}
  const file=p==='/auto-trade'?'auto-trade.html':p.slice(1);
  if(/^[\w.-]+\.(html|css|js)$/.test(file)&&fs.existsSync(file))return r.fulfill({body:fs.readFileSync(file),contentType:file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html'});
  return r.fulfill({json:{ok:true,markets:[],commands:[]}});
 });
 try{
  await page.goto('http://localhost/auto-trade');await page.waitForFunction(()=>document.getElementById('manualSl')?.value==='4');
  for(const [id,value] of Object.entries({manualTp1:'1.5',manualTp2:'2.5',manualTp3:'3.5',manualSl:'4'})){a.equal(await page.locator('#'+id).inputValue(),value);a.equal(await page.locator('#'+id).getAttribute('readonly'),null);}
  await page.locator('#manualTp1').fill('');await page.locator('#manualTp2').fill('');await page.locator('#manualTp3').fill('');await page.locator('#manualSl').fill('5');await page.locator('#riskAcknowledged').check();await page.locator('#saveSettingsButton').click();
  await page.waitForFunction(()=>document.getElementById('manualTp1').value==='2');a.equal(posted.manualExit.tp1,'');a.deepEqual([saved.tp1,saved.tp2,saved.tp3,saved.sl],[2,4,6,5]);
  await page.reload();await page.waitForFunction(()=>document.getElementById('manualSl').value==='5');
  await page.locator('#manualSl').fill('');await page.locator('#saveSettingsButton').click();await page.waitForFunction(()=>document.getElementById('manualSl').value==='3');a.equal(saved.version,'MANUAL_TF2_EXIT_V2');
  await page.locator('#manualTp1').fill('7');await page.locator('#saveSettingsButton').click();await page.getByText('TP manual mesti mengikut turutan TP1 < TP2 < TP3.',{exact:true}).waitFor();a.equal(saved.tp1,2);
  await page.locator('#manualTp1').fill('1.5');await page.locator('#manualTp2').fill('2.5');await page.locator('#manualTp3').fill('3.5');await page.locator('#manualSl').fill('4');await page.locator('#saveManualExitButton').click();await page.waitForFunction(()=>document.getElementById('manualExitSaveStatus').textContent.includes('tersimpan'));a.equal(saved.sl,4);a.equal(posted.sl,'4');a.equal(posted.modeSettings,undefined);
  await page.locator('#manualExitEnabled').uncheck();await page.waitForFunction(()=>!document.getElementById('manualExitEnabled').disabled);a.equal(saved.enabled,false);
  await page.locator('#manualExitEnabled').check();await page.waitForFunction(()=>!document.getElementById('manualExitEnabled').disabled);a.equal(saved.enabled,true);
  a.deepEqual(errors,[]);console.log('Manual exit UI: editable, saved custom hydration, blank defaults, reload persistence, invalid ordering blocked. No broker orders.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
