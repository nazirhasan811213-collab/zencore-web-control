'use strict';
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs');
const {cockpit}=require('../trading-cockpit-model');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.ZENCORE_QA_CHROMIUM||undefined}),page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));let missing=false,missingGold=false;
 function payload(){const now=Date.now();const gold=[2,15].map(tf=>({symbol:'XAUUSD',timeframe:String(tf),receivedAt:now,signalObservedAt:now,price:4100,open:4099,high:4101,low:4098,close:4100,hema20:4100,hema40:4099,ema9:4100,ema20:4099,ema50:4098,waveTrend1:10,waveTrend2:5,rsi:missing?undefined:58,chopIndex:55,relativeVolume:1.2,atr:2,strategyNormal:{tf:tf+'m',state:'WAIT',solid:true,side:'BUY',plan:{entry:4100,sl:4096,tp1:4101.5,tp2:4102.5,tp3:4103.5},sop:{atrReference:2,mtfScore:1,forecast:'CHOPPY',marketPower:65,advisor:{trend:'Sideways',momentum:'Mula perlahan',proTip:'Tunggu arah jelas.'}}}}));const bitcoin=gold.map(m=>({...m,symbol:'BTCUSD',price:m.timeframe==='2'?63711.98:63720, strategyNormal:{...m.strategyNormal,side:'SELL',plan:{entry:m.timeframe==='2'?63759.36:63900,sl:64050,tp1:63620,tp2:63500,tp3:63400}}}));return cockpit([...(missingGold?[]:gold),...bitcoin],now);}
 await page.route('**/*',route=>{const path=new URL(route.request().url()).pathname;
  if(path==='/app'){const html=fs.readFileSync('home.html','utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'');return route.fulfill({body:html+'<script>window.EventSource=undefined;</script><script src="/dashboard-live-core.js"></script><script src="/trading-cockpit.js"></script>',contentType:'text/html'});}
  if(path==='/api/trading-cockpit')return route.fulfill({json:payload()});
  if(path==='/auth/me')return route.fulfill({json:{user:{displayName:'UI Test'}}});
  if(path.startsWith('/api/')||path==='/ready')return route.fulfill({json:{ok:true}});
  if(/^\/[a-z0-9-]+\.(js|css)$/i.test(path)&&fs.existsSync('.'+path))return route.fulfill({body:fs.readFileSync('.'+path),contentType:path.endsWith('.js')?'application/javascript':'text/css'});
  return route.fulfill({body:''});
 });
 await page.goto('http://localhost/app');
 const gold=page.locator('[data-pair="XAUUSD"]'),btc=page.locator('[data-pair="BTCUSD"]');
 await page.waitForFunction(()=>/Kekuatan setup \d+%/.test(document.querySelector('[data-pair="XAUUSD"] [data-field="strength"]').textContent));
 assert.equal(await gold.locator('[data-field="price"]').innerText(),'4,100.00');
 assert.equal(await btc.locator('[data-field="price"]').innerText(),'63,711.98');
 assert.equal(await btc.locator('[data-field="entry"]').innerText(),'63,759.36');
 await btc.getByRole('combobox').selectOption('15');
 assert.equal(await btc.locator('[data-field="entry"]').innerText(),'63,900.00');
 assert.equal(await gold.getByRole('combobox').inputValue(),'2');
 assert.equal(await btc.locator('[data-field="analysis"]').getAttribute('href'),'/analysis?pair=BTCUSD&tf=15');
 const summaryRows=page.locator('#marketGrid details');
 assert.equal(await summaryRows.count(),4);
 assert.equal(await page.locator('#marketGrid details[open]').count(),0);
 const firstRow=summaryRows.first();
 await firstRow.locator('summary').click();
 assert.match(await firstRow.innerText(),/Sideways/);
 assert.match(await firstRow.innerText(),/Mula perlahan/);
 assert.match(await firstRow.innerText(),/Tunggu arah jelas/);
 await page.getByRole('button',{name:'TF15',exact:true}).click();
 assert.equal(await page.locator('#marketGrid details:visible').count(),2);
 await page.getByRole('button',{name:'Semua TF',exact:true}).click();
 assert.equal(await page.locator('#marketGrid details:visible').count(),4);
 missing=true;
 await page.waitForFunction(()=>/Input Pine belum lengkap: rsi/.test(document.querySelector('[data-pair="XAUUSD"] [data-field="strength"]').textContent));
 assert.equal(await firstRow.getAttribute('open'),'');
 await firstRow.locator('summary').click();
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
  const [first,second]=await Promise.all([summaryRows.nth(0).boundingBox(),summaryRows.nth(1).boundingBox()]);
  assert.ok(second.y>=first.y+first.height);
  assert.ok(first.height<=52);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 }
 if(process.env.ZENCORE_DASHBOARD_PREVIEW){await page.setViewportSize({width:390,height:844});await page.screenshot({path:process.env.ZENCORE_DASHBOARD_PREVIEW});}
 assert.deepEqual(errors,[]);
 console.log('Dashboard pair isolation, TF selection, missing feed recovery and 320/390/1440px layouts passed');await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
