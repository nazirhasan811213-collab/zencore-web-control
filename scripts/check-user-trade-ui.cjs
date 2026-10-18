const {chromium}=require('playwright'),fs=require('fs'),a=require('node:assert/strict');
const M=require('../admin-user-trade-service');
(async()=>{
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']}),page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 const at=Date.now(),DAY=86400000;let fail=false,settings=M.defaults(),posted=null,reads=0;
 const connected=(online,lastTradeAt,on)=>({lastSeenAt:at-(online?1000:DAY),connection:{online},transport:'EA_LOCAL',tradeMode:'REAL',serverMask:'****Live',accountMask:'****1234',control:{desiredState:on?'ON':'STOPPED',effectiveState:on?'ON':'STOPPED'},tradingActivity:{lastTradeAt,openPositions:0,executedSetups7d:online?3:0,executedSetups30d:4}});
 const make=(id,name,server,login,trade,on)=>M.row({id,displayName:name,email:id+'@example.test',ibName:'IB contoh',lastLoginAt:login,status:'active'},connected(on,trade,on),{podId:id,accountFingerprint:id,lastActivationAt:on?at-DAY:at-20*DAY,brokerRecord:server?{podId:id,accountFingerprint:id,mt5ServerName:server,reportedAt:at-DAY}:null},settings,at);
 const payload=()=>({ok:true,observedAt:at,servedAt:at,pollIntervalMs:30000,settings,summary:{total:4,otherServer:1,missingServer:1,loginInactive:1,tradeInactive:1,neverActivated:1,unknown:1},rows:[make('1','Client aktif','InterStellarFinancial-Server',at-DAY,at-3600000,true),make('2','Client semakan','OtherBroker-Live',at-30*DAY,at-14*DAY,false),make('3','Nama <img src=x onerror=window.xss=1>',null,at-DAY,null,false),{userId:'4',displayName:'Data tidak tersedia',email:'unknown@example.test',dataAvailable:false,flags:{}}],servers:[{mt5ServerName:'InterStellarFinancial-Server',status:'REFERENCE',users:1,real:1,demo:0,online:1},{mt5ServerName:'OtherBroker-Live',status:'OTHER',users:1,real:1,demo:0,online:0}]});
 await page.route('**/*',async route=>{
  const p=new URL(route.request().url()).pathname;
  if(p==='/api/admin/user-trade-monitor'){
   if(route.request().method()==='POST'){posted=route.request().postDataJSON();settings=posted;return route.fulfill({json:{ok:true,settings}});}
   reads++;if(fail)return route.fulfill({status:503,json:{ok:false}});return route.fulfill({json:payload()});
  }
  const file=p==='/admin/user-trade-monitor'?'admin-user-trade.html':p.slice(1);
  if(['admin-user-trade.html','admin-user-trade.js','admin-user-trade.css','management.css','workspace-shell.js'].includes(file))return route.fulfill({body:fs.readFileSync(file),contentType:file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html; charset=utf-8'});
  return route.fulfill({body:''});
 });
 try{
  await page.goto('http://localhost/admin/user-trade-monitor');await page.locator('#users tr').nth(3).waitFor();
  a.equal(await page.locator('#users tr').count(),4);a.equal(await page.locator('#users img').count(),0);a.equal(await page.evaluate(()=>window.xss),undefined);
  a.match(await page.locator('#users').innerText(),/OtherBroker-Live/);a.match(await page.locator('#users').innerText(),/Nama penuh belum diterima/);
  await page.locator('#activityFilter').selectOption('other_server');a.equal(await page.locator('#users tr').count(),1);a.match(await page.locator('#users').innerText(),/Client semakan/);
  await page.locator('#activityFilter').selectOption('unknown');a.equal(await page.locator('#users tr').count(),1);a.match(await page.locator('#users').innerText(),/belum dapat disahkan/);
  await page.locator('#activityFilter').selectOption('all');await page.locator('#search').fill('OtherBroker');a.equal(await page.locator('#users tr').count(),1);await page.locator('#search').fill('');
  await page.screenshot({path:'user-trade-desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:'user-trade-mobile.png',fullPage:true});a.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.locator('#config summary').click();await page.locator('#referenceServers').fill('AdminBroker-Server');await page.locator('#inactiveDays').fill('30');await page.locator('#save').click();await page.waitForFunction(()=>document.getElementById('saved').textContent.includes('disimpan.'));
  a.deepEqual(posted,{inactiveDays:30,referenceServers:['AdminBroker-Server']});
  fail=true;await page.locator('#refresh').click();await page.waitForFunction(()=>document.getElementById('notice').classList.contains('error'));a.equal(await page.locator('#users tr').count(),4);a.match(await page.locator('#notice').innerText(),/Paparan terakhir dikekalkan/);
  a.deepEqual(errors,[]);console.log('User trade UI passed: filters, no XSS, mobile, settings and failure state. GET snapshots:',reads);
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
