(() => {
 'use strict';
 const dialog=document.getElementById('goldCopilot'),robot=document.getElementById('copilotRobot'),content=document.getElementById('copilotContent');let views=[],tf=2,failed=false;
 const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
 function render(){
  robot.dataset.live=String(!failed&&views.some(v=>window.ZenCoreDashboardLive.fresh(v)));
  if(!dialog.open)return;
  const report=window.ZenCoreGoldCopilot.analyse(failed?views.map(v=>({...v,status:'DISCONNECTED'})):views,tf);
  const nodes=[el('span',({QUALIFIED:'SOP CUKUP',WAIT_DATA:'DATA TAK FRESH',WAIT_PLAN:'LEVEL BELUM READY',INVALIDATED:'SETUP BATAL',WAIT_RANGE:'LUAR RANGE',WAIT_CONFIRMATION:'TUNGGU CONFIRM'})[report.status]||report.status,'copilot-status '+(report.status==='QUALIFIED'?'pass':'')),el('h2',report.action),el('p',report.reason)];
  if(report.forecast){nodes.push(el('h3','Gold tengah buat apa?'),el('p','Bacaan forecast: '+report.forecast.direction+' · skor '+(report.forecast.score??'—')+'% · anggaran 10 candle TF'+tf+' ('+report.forecast.horizonMinutes+' minit).'),el('p','HEMA TF'+tf+': '+report.hema.own+' / TF'+report.higher+': '+report.hema.higher+' · Bentuk: '+report.hema.shape));}
  if(report.levels){nodes.push(el('h3','Level yang kita tengah tengok'));const levels=el('div',undefined,'copilot-levels');for(const [k,v]of Object.entries(report.levels))levels.append(el('div',k.toUpperCase()+'\n'+v.toFixed(3)));nodes.push(levels,el('p','R:R entry→TP1: '+report.rr.toFixed(2)+' · Price latest: '+report.price.toFixed(3)));}
  if(report.scenarios.length){nodes.push(el('h3','Lepas ni, perhatikan benda ni'));const list=el('ol');report.scenarios.forEach(x=>list.append(el('li',x)));nodes.push(list);}
  if(report.checks.length){nodes.push(el('h3','SOP mana dah lepas?'));const list=el('div',undefined,'copilot-checks');for(const g of report.checks)list.append(el('p',(g.pass?'✓ ':'○ ')+g.label+(g.detail?' · '+g.detail:''),g.pass?'pass':''));nodes.push(list);}
  if(report.management)nodes.push(el('p','Arahan manage trade dari Pine: '+report.management+' · check MT5 untuk tahu order betul-betul dah jalan atau belum.'));
  if(report.observedAt)nodes.push(el('p','Price update pukul '+new Date(report.observedAt).toLocaleTimeString('en-GB',{timeZone:'Asia/Kuala_Lumpur',hour12:false})+' MYT · '+Math.max(0,(Date.now()-report.observedAt)/1000).toFixed(1)+'s lalu.','copilot-note'));
  nodes.push(el('p',report.method+' '+report.note,'copilot-note'));content.replaceChildren(...nodes);
 }
 async function refresh(){try{const r=await fetch('/api/trading-cockpit',{credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(8000)});if(!r.ok)throw Error('FEED');const j=await r.json();if(!j.ok||!Array.isArray(j.pairs))throw Error('DATA');views=j.pairs.filter(p=>p.symbol==='XAUUSD').flatMap(p=>p.views);failed=false;}catch(_){failed=true;}render();}
 robot.onclick=()=>{dialog.showModal();render();refresh();};document.getElementById('copilotClose').onclick=()=>dialog.close();
 for(const b of document.querySelectorAll('[data-copilot-tf]'))b.onclick=()=>{tf=Number(b.dataset.copilotTf);document.querySelectorAll('[data-copilot-tf]').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));render();};
 document.addEventListener('zencore:dashboard',e=>{views=e.detail.views;failed=e.detail.failed;render();});
 const timer=setInterval(render,1000);window.addEventListener('pagehide',()=>clearInterval(timer));
})();
