'use strict';
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs');
const {cockpit}=require('../trading-cockpit-model');
(async()=>{
 const browser=await chromium.launch({headless:true}),page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));let missing=false;
 function payload(){const now=Date.now();return cockpit([2,15].map(tf=>({symbol:'XAUUSD',timeframe:String(tf),receivedAt:now,signalObservedAt:now,price:4100,open:4099,high:4101,low:4098,close:4100,hema20:4100,hema40:4099,ema9:4100,ema20:4099,ema50:4098,waveTrend1:10,waveTrend2:5,rsi:missing?undefined:58,chopIndex:55,relativeVolume:1.2,atr:2,strategyNormal:{tf:tf+'m',state:'WAIT',solid:true,side:'BUY',plan:{entry:4100,sl:4096,tp1:4101.5,tp2:4102.5,tp3:4103.5},sop:{atrReference:2,mtfScore:1,forecast:'CHOPPY',marketPower:65,advisor:{trend:'Sideways',momentum:'Mula perlahan',proTip:'Tunggu arah jelas.'}}}})),now);}
 await page.route('**/*',route=>{const path=new URL(route.request().url()).pathname;
  if(path==='/app'){const html=fs.readFileSync('home.html','utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'');return route.fulfill({body:html+'<script>window.EventSource=undefined;</script><script src="/dashboard-live-core.js"></script><script src="/trading-cockpit.js"></script>',contentType:'text/html'});}
  if(path==='/api/trading-cockpit')return route.fulfill({json:payload()});
  if(path==='/auth/me')return route.fulfill({json:{user:{displayName:'UI Test'}}});
  if(path.startsWith('/api/')||path==='/ready')return route.fulfill({json:{ok:true}});
  if(/^\/[a-z0-9-]+\.(js|css)$/i.test(path)&&fs.existsSync('.'+path))return route.fulfill({body:fs.readFileSync('.'+path),contentType:path.endsWith('.js')?'application/javascript':'text/css'});
  return route.fulfill({body:''});
 });
 await page.goto('http://localhost/app');await page.waitForFunction(()=>/Overall Setup Strength \d+%/.test(document.querySelector('#featuredChecks').textContent));
 const text=await page.locator('#featuredChecks').innerText();assert.match(text,/Strength \d+%/);assert.doesNotMatch(text,/Jangkauan setup: —/);assert.match(await page.locator('#marketGrid').innerText(),/Sideways/);assert.match(await page.locator('#marketGrid').innerText(),/Mula perlahan/);assert.match(await page.locator('#marketGrid').innerText(),/Tunggu arah jelas/);
 missing=true;await page.waitForFunction(()=>/Input Pine belum lengkap: rsi/.test(document.querySelector('#featuredChecks').textContent));assert.match(await page.locator('#featuredChecks').innerText(),/Strength —/);
 missing=false;await page.waitForFunction(()=>/Overall Setup Strength \d+%/.test(document.querySelector('#featuredChecks').textContent));
 await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual(errors,[]);
 console.log('Strength dashboard: CHOPPY scores, nested Pine summary, missing-input explanation and recovery, mobile layout passed');await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
