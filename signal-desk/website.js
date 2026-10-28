/* Alternate presentation of the same authenticated market data. */
(function(){
'use strict';
const desk=window.ZenCoreFusionDesk,live=window.ZenCoreLive;if(!desk||!live)return;
const main=document.querySelector('main'),root=document.documentElement;
const switcher=document.createElement('div');switcher.className='presentation-switch';switcher.setAttribute('role','group');switcher.setAttribute('aria-label','Paparan website');
switcher.innerHTML='<span>PAPARAN</span><button type="button" data-layout-choice="desk" aria-pressed="true">Laporan desk</button><button type="button" data-layout-choice="website" aria-pressed="false">Website sebenar ↗</button>';
main.prepend(switcher);
const hero=document.createElement('section');hero.className='website-hero';hero.hidden=true;hero.setAttribute('aria-label','Website live ZenCore');
hero.innerHTML='<div class="website-top"><a class="website-brand" href="#main"><b>Z</b><span>ZENCORE<small>LIVE MARKET WEBSITE</small></span></a><span class="website-private">● AKSES PERIBADI</span></div><div class="website-intro"><div><span class="eyebrow">GOLD · XAUUSD</span><h1>Rancang langkah<br><em>seterusnya.</em></h1><p>Satu pandangan untuk arah, entry dan paras dekat.<br>TF2 untuk scalping. TF15 untuk konteks.</p></div><div class="website-connection"><span class="eyebrow">SUMBER DATA</span><strong>Pine → Errante → ZenCore</strong><p id="website-connection-copy">Sambungkan sesi Errante untuk mula melihat data sebenar.</p><button type="button" class="button gold-button" id="website-connect">Sambung data sebenar ↗</button></div></div><div class="website-market-grid" id="website-market-grid" aria-label="Ringkasan dua timeframe"></div><div class="website-report-label"><span>LAPORAN PILIHAN ANDA</span><span>Harga & pelan asal Pine · semak syarat dahulu</span></div>';
switcher.after(hero);
const format=n=>Number.isFinite(n)?new Intl.NumberFormat('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}).format(n):'—';
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function active(){return root.dataset.presentation==='website';}
function select(layout){
 if(!['desk','website'].includes(layout))return;
 root.dataset.presentation=layout;hero.hidden=layout!=='website';
 const p=new URLSearchParams(location.search);if(layout==='website')p.set('layout','website');else p.delete('layout');history.replaceState(null,'',location.pathname+'?'+p+location.hash);
 switcher.querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.layoutChoice===layout)));
 if(layout==='website'&&desk.getView()!=='live')document.querySelector('[data-view="live"]').click();
 render();
}
function render(){
 if(!active()){document.title='TF'+desk.getTimeframe()+' · '+(new URLSearchParams(location.search).get('period')==='60'?'1 jam':'30 minit')+' | ZenCore Signal Desk';return;}
 const period=Number(new URLSearchParams(location.search).get('period')||30),tf=desk.getTimeframe();
 const rows=['2','15'].map(t=>({tf:t,data:live.modelFor(t,period)}));
 document.getElementById('website-market-grid').innerHTML=rows.map(({tf:t,data:r})=>`<button type="button" class="website-market-card ${t===tf?'selected':''}" data-website-tf="${t}" aria-pressed="${t===tf}"><span class="website-market-top"><b>TF${t} <small>${t==='2'?'SCALPING':'INTRADAY'}</small></b><span class="website-feed ${r?.fresh?'fresh':''}">${r?r.fresh?'DATA SEGAR':'DATA LAMA':'TUNGGU DATA'}</span></span><strong class="website-market-price">${format(r?.price)} <small>USD / oz</small></strong><span class="website-market-direction">${r?escape(r.title):'Belum ada bacaan untuk TF ini.'}</span><span class="website-market-levels"><span>Sokongan <b>${format(r?.levels.support)}</b></span><span>Rintangan <b>${format(r?.levels.resistance)}</b></span><span>Entry Pine <b>${format(r?.planValid?r.plan.entry:null)}</b></span></span><span class="website-card-link">Lihat laporan TF${t} <span>→</span></span></button>`).join('');
 document.querySelectorAll('[data-website-tf]').forEach(button=>button.addEventListener('click',()=>{const horizon=document.querySelector('[data-period][aria-pressed="true"]')?.dataset.period;desk.setTimeframe(button.dataset.websiteTf);if(horizon)document.querySelector('[data-period="'+horizon+'"]').click();render();}));
 const available=rows.filter(x=>x.data),fresh=available.filter(x=>x.data.fresh);
 document.getElementById('website-connection-copy').textContent=available.length?fresh.length+' / 2 TF mempunyai data segar. Masa dan status setiap feed dinilai berasingan.':'Sambungkan sesi Errante untuk mula melihat data sebenar.';
 document.getElementById('website-connect').textContent=available.length?'Buka semula sambungan ↗':'Sambung data sebenar ↗';
 document.title='ZenCore · Website sebenar · TF'+tf+' · '+(period===60?'1 jam':'30 minit');
}
switcher.querySelectorAll('button').forEach(b=>b.addEventListener('click',()=>select(b.dataset.layoutChoice)));
document.getElementById('website-connect').addEventListener('click',()=>document.getElementById('connect-live')?.click());
window.ZenCoreWebsite={render};
select(new URLSearchParams(location.search).get('layout')==='website'?'website':'desk');
})();
