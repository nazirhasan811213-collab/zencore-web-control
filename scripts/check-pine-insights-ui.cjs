const {chromium}=require('playwright');
const fs=require('fs'),assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']}),page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 const advisor=tf=>({mtfSummary:tf===2?'TF Sepakat NAIK. Fokus BUY.':'TF Sepakat TURUN. Fokus SELL.',trend:tf===2?'Uptrend':'Downtrend',momentum:tf===2?'Bullish':'Bearish',proTip:'Entry pada harga zon.',advice:'Check resistance dulu.',aiCoach:'• [TREND]: '+(tf===2?'NAIK':'TURUN')+'. • [MOMENTUM]: Masih kuat. • [HALANGAN]: Dekat resistance.'});
 let missing=false;
 const payload=()=>({ok:true,symbol:'XAUUSD',views:[2,15].map(tf=>({timeframe:tf,status:missing&&tf===15?'WAITING':'LIVE',market:missing&&tf===15?null:{receivedAt:Date.now(),signalObservedAt:Date.now(),price:4100,strategyNormal:{state:'WAIT',side:tf===2?'BUY':'SELL',sop:{advisor:advisor(tf),chartSignal:tf===2?{present:true,current:true,side:'BUY',triggeredAt:Date.now()}:null}}}}))});
 await page.route('**/*',route=>{const path=new URL(route.request().url()).pathname;
  if(path==='/api/trading-cockpit')return route.fulfill({json:{ok:true,pairs:[{symbol:'XAUUSD',views:payload().views}]}});
  if(path==='/app')return route.fulfill({body:'<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/pine-insights.css"><button id="copilotRobot">AI</button><dialog id="goldCopilot" style="width:95%;max-width:1100px"><button id="copilotClose">Close</button><button data-copilot-tf="2">TF2</button><button data-copilot-tf="15">TF15</button><div id="copilotContent"></div></dialog><script src="/dashboard-live-core.js"></script><script src="/gold-copilot-core.js"></script><script src="/pine-insights.js"></script><script src="/gold-copilot.js"></script>',contentType:'text/html; charset=utf-8'});
  if(path==='/api/analysis/timeframes')return route.fulfill({json:payload()});
  if(path==='/analysis')return route.fulfill({body:'<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/analysis-dual.css"><link rel="stylesheet" href="/pine-insights.css"><main class="dual-app"><select id="pairSelector"><option>XAUUSD</option></select><div id="dualConnection"></div><button data-view="both">Both</button><button data-view="2">TF2</button><button data-view="15">TF15</button><section id="dualViews" class="dual-views"></section></main><script>window.EventSource=undefined</script><script src="/pine-insights.js"></script><script src="/analysis-dual.js"></script>',contentType:'text/html; charset=utf-8'});
  if(['/dashboard-live-core.js','/gold-copilot-core.js','/gold-copilot.js','/pine-insights.js','/analysis-dual.js','/analysis-dual.css','/pine-insights.css'].includes(path))return route.fulfill({body:fs.readFileSync('.'+path),contentType:path.endsWith('.js')?'application/javascript; charset=utf-8':'text/css; charset=utf-8'});
  return route.fulfill({body:''});
 });
 await page.goto('http://localhost/analysis');await page.locator('.pine-status.fresh').first().waitFor();
 assert.equal(await page.locator('.pine-insights').count(),2);
 assert.match(await page.locator('.pine-insights[data-tf="2"]').innerText(),/Uptrend/);
 
 await page.getByRole('button',{name:'TF2',exact:true}).click();assert(await page.locator('[data-timeframe="15"]').isHidden());await page.getByRole('button',{name:'Both',exact:true}).click();
 assert.match(await page.locator('[data-timeframe="2"] .chart-solid-note').innerText(),/SOLID BUY pada chart/);
 assert.match(await page.locator('[data-timeframe="2"] .chart-solid-note').innerText(),/BELUM LAYAK/);
 assert.match(await page.locator('.pine-insights[data-tf="15"]').innerText(),/Downtrend/);
 await page.locator('.pine-insights[data-tf="15"] summary').click();await page.waitForTimeout(1200);
 assert(await page.locator('.pine-insights[data-tf="15"] details').evaluate(d=>d.open));
 assert.equal(await page.locator('.pine-insights[data-tf="15"] .pine-coach-row').count(),3);
 await page.screenshot({path:'pine-ui-desktop.png',fullPage:true});
 await page.getByRole('button',{name:'TF15',exact:true}).click();assert(await page.locator('[data-timeframe="2"]').isHidden());
 await page.getByRole('button',{name:'Both',exact:true}).click();
 await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:'pine-ui-mobile.png',fullPage:true});
 missing=true;await page.locator('#pairSelector').dispatchEvent('change');await page.waitForTimeout(300);
 assert.match(await page.locator('.pine-insights[data-tf="15"]').innerText(),/TUNGGU DATA/);
 assert.doesNotMatch(await page.locator('.pine-insights[data-tf="15"]').innerText(),/Uptrend|Downtrend/);
 missing=false;await page.goto('http://localhost/app');await page.getByRole('button',{name:'AI',exact:true}).click();await page.locator('.pine-status.fresh').first().waitFor();assert.equal(await page.locator('.pine-insights').count(),2);assert.match(await page.locator('.pine-insights[data-tf="15"]').innerText(),/Downtrend/);await page.locator('[data-copilot-tf="15"]').click();assert.equal(await page.locator('[data-copilot-tf="15"]').getAttribute('aria-pressed'),'true');await page.locator('.pine-insights[data-tf="2"] summary').click();await page.waitForTimeout(1200);assert(await page.locator('.pine-insights[data-tf="2"] details').evaluate(d=>d.open));assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 assert.deepEqual(errors,[]);console.log('Pine UI: separate TF2/TF15, missing feed, disclosure persists, switching, mobile width passed');await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});

