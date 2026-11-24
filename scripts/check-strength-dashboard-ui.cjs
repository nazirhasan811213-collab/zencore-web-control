'use strict';
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs');
const {cockpit}=require('../trading-cockpit-model');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.ZENCORE_QA_CHROMIUM||undefined}),page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));let missing=false,missingGold=false;
 const manualOrders=[],closeRequests=[];
 const fakeCloseId="22222222-2222-4222-8222-222222222222";
 const fakeOrderId='11111111-1111-4111-8111-111111111111';
 function payload(){const now=Date.now();const gold=[1,15].map(tf=>({symbol:'XAUUSD',timeframe:String(tf),receivedAt:now,signalObservedAt:now,price:4100,open:4099,high:4101,low:4098,close:4100,hema20:4100,hema40:4099,ema9:4100,ema20:4099,ema50:4098,waveTrend1:10,waveTrend2:5,rsi:missing?undefined:58,chopIndex:55,relativeVolume:1.2,atr:2,strategyNormal:{tf:tf+'m',state:'WAIT',solid:true,side:'BUY',plan:{entry:4100,sl:4096,tp1:4101.5,tp2:4102.5,tp3:4103.5},sop:{atrReference:2,mtfScore:1,forecast:'CHOPPY',marketPower:65,advisor:{trend:'Sideways',momentum:'Mula perlahan',proTip:'Tunggu arah jelas.',mtfSummary:'TF1 dan TF15 masih bercampur.',aiCoach:'[NASIHAT]: Tunggu candle tutup.'}}}}));const bitcoin=gold.map(m=>({...m,symbol:'BTCUSD',price:m.timeframe==='1'?63711.98:63720, strategyNormal:{...m.strategyNormal,side:'SELL',plan:{entry:m.timeframe==='1'?63759.36:63900,sl:64050,tp1:63620,tp2:63500,tp3:63400}}}));return cockpit([...(missingGold?[]:gold),...bitcoin],now);}
 await page.route('**/*',route=>{const path=new URL(route.request().url()).pathname;
  if(path==='/app'){const html=fs.readFileSync('home.html','utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'');return route.fulfill({body:html+'<script>window.EventSource=undefined;</script><script src="/dashboard-live-core.js"></script><script src="/trading-cockpit.js"></script>',contentType:'text/html'});}
  if(path==='/api/trading-cockpit')return route.fulfill({json:payload()});
  if(path==='/api/auto-trade/state'){
   const now=Date.now();
   return route.fulfill({json:{manualOrderReady:true,manualCloseAllBinding:'bound-account',generatedAt:now,pod:{accountMask:'****5839',lastSeenAt:now},
    positions:[],connection:{connected:true,online:true}}});
  }
  if(path==='/api/auto-trade/manual-close-all'){
   assert.equal(route.request().method(),'POST');
   closeRequests.push(route.request().postDataJSON());
   return route.fulfill({status:202,json:{ok:true,commandId:fakeCloseId}});
  }
  if(path==='/api/auto-trade/manual-order'){
   if(route.request().method()==='POST'){
    manualOrders.push(route.request().postDataJSON());
    return route.fulfill({status:202,json:{ok:true,commandId:fakeOrderId}});
   }
   const closing=new URL(route.request().url()).searchParams.get('id')===fakeCloseId;
   return route.fulfill({json:{ok:true,status:'EXECUTED',code:closing?'CLOSED_ALL':'MANUAL_ORDER_FILLED'}});
  }

  if(path==='/auth/me')return route.fulfill({json:{user:{displayName:'UI Test'}}});
  if(path.startsWith('/api/')||path==='/ready')return route.fulfill({json:{ok:true}});
  if(/^\/[a-z0-9-]+\.(js|css)$/i.test(path)&&fs.existsSync('.'+path))return route.fulfill({body:fs.readFileSync('.'+path),contentType:path.endsWith('.js')?'application/javascript':'text/css'});
  return route.fulfill({body:''});
 });
 await page.goto('http://localhost/app');
 const buy=page.getByRole('button',{name:'BUY',exact:true});
 const confirm=page.getByRole('dialog',{name:'Sahkan order MT5'});
 await buy.click();
 await confirm.waitFor({state:'visible'});
 assert.match(await confirm.innerText(),/BUY XAUUSD · 0.01 lot · MT5 \*{4}5839/);
 await confirm.getByRole('button',{name:'BATAL',exact:true}).click();
 assert.equal(manualOrders.length,0);
 await buy.click();
 await confirm.getByRole('button',{name:'HANTAR BUY',exact:true}).click();
 await page.getByText('MT5 sahkan order dilaksanakan.',{exact:true}).waitFor({state:'visible'});
 assert.equal(manualOrders.length,1);
 const {requestId,...order}=manualOrders[0];
 assert.match(requestId,/^[a-f0-9-]{36}$/);
 assert.deepEqual(order,{side:'BUY',symbol:'XAUUSD',lot:.01,accountMask:'****5839'});
 const closeAll=page.getByRole('button',{name:'CLOSE ALL',exact:true});
 const closeConfirm=page.getByRole('dialog',{name:'Sahkan CLOSE ALL'});
 await page.locator('#quickLot').fill('');
 await closeAll.click();
 assert.match(await closeConfirm.innerText(),/MT5 \*{4}5839.*posisi manual dan Auto Trade/);
 await closeConfirm.getByRole('button',{name:'BATAL',exact:true}).click();
 assert.equal(closeRequests.length,0);
 await closeAll.click();
 await closeConfirm.getByRole('button',{name:'TUTUP SEMUA POSISI',exact:true}).click();
 await page.getByText('MT5 sahkan semua posisi ditutup.',{exact:true}).waitFor({state:'visible'});
 assert.equal(closeRequests.length,1);
 const {requestId:closeRequestId,...closePayload}=closeRequests[0];
 assert.match(closeRequestId,/^[a-f0-9-]{36}$/);
 assert.deepEqual(closePayload,{confirmation:'CLOSE_ALL',binding:'bound-account'});


 const gold=page.locator('[data-pair="XAUUSD"]'),btc=page.locator('[data-pair="BTCUSD"]');
 await page.waitForFunction(()=>/^\d+%$/.test(document.querySelector('[data-pair="XAUUSD"] [data-field="strengthScore"]').textContent));
 assert.ok(await gold.locator('[data-field="strengthScore"]').evaluate(node=>parseFloat(getComputedStyle(node).fontSize)>=32));
 assert.equal(await gold.locator('[data-field="price"]').innerText(),'4,100.00');
 assert.equal(await btc.locator('[data-field="price"]').innerText(),'63,711.98');
 assert.equal(await btc.locator('[data-field="entry"]').innerText(),'63,759.36');
 await btc.getByRole('combobox').selectOption('15');
 assert.equal(await btc.locator('[data-field="entry"]').innerText(),'63,900.00');
 assert.equal(await gold.getByRole('combobox').inputValue(),'1');
 assert.equal(await btc.locator('[data-field="strengthTf"]').innerText(),'TF15');
 assert.equal(await btc.locator('[data-field="analysis"]').getAttribute('href'),'/analysis?pair=BTCUSD&tf=15');
 assert.equal(await page.getByRole('heading',{name:'Ringkasan market',exact:true}).count(),0);
 assert.equal(await page.locator('#dashboardAutoSettingsFrame').count(),1);
 await page.locator('#chartPair').selectOption('BTCUSD');
 await page.getByRole('button',{name:'TF15 Intra',exact:true}).click();
 assert.match(await page.locator('#liveTfSummary').innerText(),/BTCUSD · TF15/);
 missing=true;
 await page.waitForFunction(()=>/Input Pine belum lengkap: rsi/.test(document.querySelector('[data-pair="XAUUSD"] [data-field="strength"]').textContent));
 assert.equal(await gold.locator('[data-field="strengthScore"]').innerText(),'—');
 missingGold=true;
 await page.waitForFunction(()=>document.querySelector('[data-pair="XAUUSD"] [data-field="quoteStatus"]').textContent==='DATA LAMA');
 assert.equal(await gold.locator('[data-field="entry"]').innerText(),'—');
 assert.equal(await btc.locator('[data-field="quoteStatus"]').innerText(),'FEED LIVE');
 missing=false;missingGold=false;
 await page.waitForFunction(()=>document.querySelector('[data-pair="XAUUSD"] [data-field="quoteStatus"]').textContent==='FEED LIVE');
 const desktopGold=await gold.boundingBox(),desktopBtc=await btc.boundingBox();
 assert.equal(desktopGold.y,desktopBtc.y);assert.ok(desktopBtc.x>desktopGold.x);
 for(const width of [390,320]){
  await page.setViewportSize({width,height:844});
  const mobileGold=await gold.boundingBox(),mobileBtc=await btc.boundingBox();
  assert.ok(mobileBtc.y>=mobileGold.y+mobileGold.height);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 }
 if(process.env.ZENCORE_DASHBOARD_PREVIEW){await page.setViewportSize({width:390,height:844});await page.screenshot({path:process.env.ZENCORE_DASHBOARD_PREVIEW});}
 assert.deepEqual(errors,[]);
 console.log('Dashboard pair isolation, TF selection, missing feed recovery and 320/390/1440px layouts passed');await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
