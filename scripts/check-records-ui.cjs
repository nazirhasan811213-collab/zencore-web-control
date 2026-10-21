'use strict';
const {chromium}=require('playwright'),fs=require('fs'),a=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']}),page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[],requests=[];let fail=false;
 const now=Date.now(),source='PERSISTED_ANALYSIS_EVENTS_NOT_BROKER_PL';
 const base={symbol:'XAUUSD',mode:'NORMAL',side:'BUY',entry:100,sl:98,tp1:102,tp2:104,tp3:106,openedAt:now-60000,hitTp1:true,hitTp2:false,hitTp3:false,score:85,source};
 const payload={ok:true,lastSync:now,records:[{...base,id:'A',timeframe:'2',state:'OPEN',outcome:'OPEN'},{...base,id:'B',timeframe:'15',state:'CLOSED',outcome:'CLOSE_SIGNAL',resolvedAt:now,hitTp1:false}],totals:[{timeframe:'2',sample:1,open:1,resolved:0,tp1:1},{timeframe:'15',sample:1,open:0,resolved:1,tp1:0}]};
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(r.url()));
 await page.route('**/*',route=>{const p=new URL(route.request().url()).pathname;
  if(p==='/api/signal-records')return route.fulfill(fail?{status:503,json:{error:'Database unavailable'}}:{json:payload});
  if(p==='/api/signal-outcomes')return route.fulfill({json:{records:[],totals:[]}});
  if(p==='/auth/me')return route.fulfill({json:{user:{role:'client',email:'qa@example.test'}}});
  const file=p==='/results'?'results.html':p.slice(1);
  if(/^[\w.-]+\.(html|js|css)$/.test(file)&&fs.existsSync(file))return route.fulfill({body:fs.readFileSync(file),contentType:file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html; charset=utf-8'});
  return route.fulfill({body:''});
 });
 try{
  await page.goto('http://localhost/results');await page.getByText('REKOD DATABASE',{exact:true}).waitFor();
  a.equal(await page.locator('#summarySample').innerText(),'2');a.equal(await page.locator('#summaryWins').innerText(),'1');a.equal(await page.locator('#summaryWinRate').innerText(),'50.0%');
  a.equal(await page.locator('#historyTableBody tr').count(),2);a.match(await page.locator('#historyTableBody').innerText(),/TF15/);a.match(await page.locator('#historyTableBody').innerText(),/CLOSE SIGNAL/);
  await page.locator('[data-filter="tp1"]').click();a.equal(await page.locator('#historyTableBody tr').count(),1);
  await page.locator('[data-filter="closed"]').click();a.equal(await page.locator('#historyTableBody tr').count(),1);
  const download=page.waitForEvent('download');await page.locator('#exportButton').click();const file=await download;a.match(fs.readFileSync(await file.path(),'utf8'),/Timeframe/);
  await page.screenshot({path:'records-desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:'records-mobile.png',fullPage:true});a.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  fail=true;await page.locator('#refreshButton').click();await page.getByText('CUBA SEMULA',{exact:true}).waitFor();a.equal(await page.locator('#summarySample').innerText(),'2');
  fail=false;await page.reload();await page.getByText('REKOD DATABASE',{exact:true}).waitFor();a.equal(await page.locator('#summarySample').innerText(),'2');
  a.ok(!requests.some(u=>u.includes('/api/validation')));a.deepEqual(errors,[]);console.log('Durable records UI passed: TFs, summary, filters, CSV, mobile, reload and failure preservation.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
