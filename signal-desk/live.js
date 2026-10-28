(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else{root.ZenCoreLiveModel=api;api.mount();}})(typeof globalThis==='undefined'?this:globalThis,function(){
'use strict';
const ORIGIN='https://zencore-errante.onrender.com',SITE='https://zencore-signal-desk.magicpeony2.chatgpt.site',finite=Number.isFinite;
function project(packet){
 const m=packet?.pine,h=packet?.history,tf=String(m?.timeframe);
 if(m?.symbol!=='XAUUSD'||!['2','15'].includes(tf)||h?.symbol!=='XAUUSD'||String(h?.timeframe)!==tf||!Array.isArray(h.candles)||h.candles.length>5000)throw Error('Data simbol atau TF tidak sepadan.');
 const s=m.strategyNormal||{},p=s.plan||{};const pine={symbol:'XAUUSD',timeframe:tf,signalObservedAt:m.signalObservedAt,receivedAt:m.receivedAt,sourceBarTime:m.sourceBarTime??m.time,confirmed:m.confirmed===true,close:m.normal3Close??m.close??m.price,strategyNormal:{state:['READY','WATCH','WAIT','EXIT'].includes(s.state)?s.state:'WAIT',side:['BUY','SELL'].includes(s.side)?s.side:null,solid:s.solid===true,entrySopVersion:typeof s.entrySopVersion==='string'?s.entrySopVersion.slice(0,100):null,plan:{}}};
 for(const key of ['entry','sl','tp1','tp2','tp3'])pine.strategyNormal.plan[key]=finite(p[key])&&p[key]>0?p[key]:null;
 const meta=m.setupMeta||{};pine.setupMeta={};for(const key of ['solidSide','solidHoldActive','solidClosedAt','entryPolicyVersion','entryRuleVersion'])if(['string','boolean','number'].includes(typeof meta[key])||meta[key]===null)pine.setupMeta[key]=meta[key];
 const sop=s.sop||{};pine.strategyNormal.sop={};const hema=sop['hema'+tf]||m.hemaConfirmation?.['tf'+tf];if(hema&&finite(hema.fast)&&finite(hema.slow))pine.strategyNormal.sop['hema'+tf]={fast:hema.fast,slow:hema.slow};
 if(!finite(pine.close)||pine.close<=0||!finite(pine.signalObservedAt)||!finite(pine.receivedAt))throw Error('Harga atau masa feed belum lengkap.');
 let previous=0;const candles=h.candles.map(c=>{if(!finite(c.time)||c.time<=previous||![c.open,c.high,c.low,c.close].every(n=>finite(n)&&n>0)||c.high<Math.max(c.open,c.close)||c.low>Math.min(c.open,c.close)||c.low>c.high||c.timeframe!==undefined&&String(c.timeframe)!==tf)throw Error('Candle tidak sah.');previous=c.time;return {time:c.time,timeframe:tf,open:c.open,high:c.high,low:c.low,close:c.close};});
 return {pine,history:{symbol:'XAUUSD',timeframe:tf,candles}};
}
function model(packet,now,horizon,F){
 const x=project(packet),m=x.pine,tf=m.timeframe,limit=tf==='2'?60000:30000;
 const fresh=m.signalObservedAt>0&&m.receivedAt>0&&now-m.signalObservedAt<=limit&&now-m.receivedAt<=limit&&m.signalObservedAt<=now+5000&&m.receivedAt<=now+5000;
 const c=x.history.candles.filter(c=>c.time+Number(tf)*60000<=m.signalObservedAt),atr=c.length>=15?F.atr(c,14).at(-1):null;
 const levels=c.length&&finite(atr)?F.structure(c,m.close,atr):{support:null,resistance:null,direction:'WAIT'};
 const s=m.strategyNormal,p=s.plan,side=s.side;
 const planValid=side==='BUY'?[p.sl,p.entry,p.tp1,p.tp2,p.tp3].every(finite)&&p.sl<p.entry&&p.entry<p.tp1&&p.tp1<p.tp2&&p.tp2<p.tp3:side==='SELL'?[p.sl,p.entry,p.tp1,p.tp2,p.tp3].every(finite)&&p.sl>p.entry&&p.entry>p.tp1&&p.tp1>p.tp2&&p.tp2>p.tp3:false;
 const ready=fresh&&s.state==='READY'&&s.solid&&planValid;
 return {packet:x,tf,fresh,ready,side,planValid,plan:p,price:m.close,asOf:m.signalObservedAt,receivedAt:m.receivedAt,validUntil:m.signalObservedAt+Number(horizon)*60000,candles:c,atr,levels,title:!fresh?'Data lama. Tunggu feed baharu.':!planValid?'Tunggu pelan Pine yang lengkap.':ready?'Setup '+side+' pada server. Sahkan sebelum entry.':'Belum ada setup yang sedia. Tunggu.',confirmation:m.confirmed};
}
function mount(){
 const $=id=>document.getElementById(id),F=window.ZenCoreFusion,packets=new Map();let popup=null,connection='Belum tersambung ke sesi Errante.';
 const section=document.createElement('section');section.id='live-report';section.className='panel live-report';section.setAttribute('aria-label','Laporan data sebenar');$('fusion-panel').before(section);
 const num=n=>finite(n)?new Intl.NumberFormat('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}).format(n):'—';
 const time=n=>new Intl.DateTimeFormat('ms-MY',{timeZone:'Asia/Kuala_Lumpur',dateStyle:'medium',timeStyle:'medium'}).format(new Date(n))+' MYT';
 const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const native=document.querySelector('meta[name="zencore-desk-host"]')?.content==='errante';
 function renderLive(){
 const active=window.ZenCoreFusionDesk.getView()==='live';section.hidden=!active;if(!active){window.ZenCoreVisual?.render();return;}
 document.querySelectorAll('[data-nav]').forEach(a=>a.href='#live-report');
 $('sample-reports').hidden=true;$('fusion-panel').hidden=true;$('fusion-performance').hidden=true;
 document.querySelector('.report-caption .sample-tag').textContent='DATA SEBENAR · BACA SAHAJA';
 const tf=window.ZenCoreFusionDesk.getTimeframe(),period=Number(new URLSearchParams(location.search).get('period')||30),packet=packets.get(tf);let r=null;
 try{if(packet)r=model(packet,Date.now(),period,F);}catch(error){connection=error.message;}
 $('data-banner-text').textContent=r?(r.fresh?'Feed Pine/Errante diterima. Semak status setup dan masa data.':'Feed lama. Entry baharu perlu tunggu data segar.'):'Tunggu data sebenar. Tiada harga atau signal direka.';
 document.querySelector('.snapshot>div').innerHTML='Data Pine<strong>'+(r?esc(time(r.asOf)):'Belum diterima')+'</strong>';
 const cells=r?[['Harga feed',r.price],['Entry asal Pine',r.planValid?r.plan.entry:null],['SL asal Pine',r.planValid?r.plan.sl:null],['TP1',r.planValid?r.plan.tp1:null],['TP2',r.planValid?r.plan.tp2:null],['TP3',r.planValid?r.plan.tp3:null],['Sokongan dekat',r.levels.support],['Rintangan dekat',r.levels.resistance]]:[];
 const note=r?.planValid?`Jika ${r.side==='BUY'?'bertahan di atas':'bertahan di bawah'} entry ${num(r.plan.entry)}, pantau TP1 ${num(r.plan.tp1)}. Jika SL ${num(r.plan.sl)} disentuh, pelan ini gagal. Arah dan pelan asal daripada Pine; laluan bukan kepastian.`:'Tunggu arah, entry, SL dan TP asal Pine. Pelan yang belum lengkap tidak digunakan.';
 const stages=r?.planValid?['1 · Tunggu harga menghampiri entry '+num(r.plan.entry),'2 · Sahkan setup '+r.side+' masih READY pada server','3 · Pantau TP1 '+num(r.plan.tp1)+'; gagal jika SL '+num(r.plan.sl)]:['1 · Tunggu feed TF'+tf,'2 · Tunggu pelan Pine lengkap','3 · Sahkan status setup sebelum entry'];
 section.innerHTML=`<div class="live-heading"><div><div class="eyebrow">XAUUSD · TF${tf} · ${period===60?'1 JAM':'30 MINIT'} KE HADAPAN</div><h2>${esc(r?.title||'Tunggu data Pine/Errante.')}</h2><p>${esc(connection)}</p></div>${native?'':'<button class="button outline" id="connect-live">Sambung / buka semula Errante ↗</button>'}</div><div class="live-status ${r?.fresh?'fresh':'waiting'}">${r?(r.fresh?'DATA SEGAR':'DATA LAMA'):'TUNGGU DATA'} · ${r?'Masa Pine: '+esc(time(r.asOf)):'Login Errante diperlukan'}</div><p class="live-outlook">${esc(note)}</p><div class="live-steps">${stages.map(s=>'<div>'+esc(s)+'</div>').join('')}</div><div class="live-cells">${cells.map(([label,value])=>'<div><span>'+label+'</span><strong>'+num(value)+'</strong></div>').join('')}</div><div class="live-chart">${chart(r,num)}</div><div class="live-notes"><p>${r?`Diterima server: ${esc(time(r.receivedAt))}. Horizon laporan hingga ${esc(time(r.validUntil))}. Kesegaran data tetap disemak setiap 5 saat.`:'Biarkan tetingkap sambungan Errante terbuka. Selepas login, tekan sambung sekali lagi jika laporan belum masuk.'}</p><p>${r?`${r.candles.length} candle tutup · ATR14 ${num(r.atr)} · ${r.confirmation?'Candle sumber disahkan tutup.':'Feed intrabar / penutupan belum disahkan.'}`:'TF2 dan TF15 menggunakan feed masing-masing. Paras tidak disalin antara TF.'}</p><p>Berita, spread, slippage dan prestasi sebenar belum disahkan. Tiada win rate direka. Laporan ini tidak menghantar order.</p></div>`;
 window.ZenCoreWebsite?.render();
 $('connect-live')?.addEventListener('click',connect);
 }
 function connect(){popup=window.open(ORIGIN+'/signal-desk/?bridge=1&view=live','zencore-live-connection','width=1000,height=820');connection=popup?'Login dalam tetingkap Errante. Data akan muncul selepas sambungan.':'Popup disekat. Benarkan popup untuk sambungan Errante.';renderLive();}
 function chart(r,n){
 if(!r?.candles.length)return '<p>Carta sebenar menunggu candle Pine. Tiada candle simulasi digunakan.</p>';
 const c=r.candles.slice(-60),values=c.flatMap(b=>[b.high,b.low]),lo=Math.min(...values),hi=Math.max(...values),span=hi-lo||1,x=i=>30+i*700/Math.max(c.length-1,1),y=v=>185-(v-lo)*150/span;
 const lines=c.map((b,i)=>`<path d="M${x(i)} ${y(b.high)}V${y(b.low)}M${x(i)-3} ${y(b.open)}H${x(i)}V${y(b.close)}H${x(i)+3}" stroke="${b.close>=b.open?'#70cbb5':'#ed9d93'}" fill="none"><title>${esc(new Date(b.time).toISOString())} · O ${n(b.open)} H ${n(b.high)} L ${n(b.low)} C ${n(b.close)}</title></path>`).join('');
 return `<h3>Candle Pine sebenar · TF${r.tf}</h3><svg viewBox="0 0 800 220" role="img" aria-label="Carta OHLC Pine TF${r.tf}, ${c.length} candle tutup">${lines}<text x="30" y="212" fill="#a7b2ba">${esc(time(c[0].time))}</text><text x="780" y="16" fill="#a7b2ba" text-anchor="end">${n(hi)}</text><text x="780" y="185" fill="#a7b2ba" text-anchor="end">${n(lo)}</text></svg>`;
 }
 function accept(packet){const p=project(packet);packets.set(p.pine.timeframe,p);try{window.ZenCoreFusionDesk.acceptReadOnlyData?.(p);}catch{}connection='Data daripada sesi Analysis Errante · baca sahaja.';renderLive();if(typeof renderSources==='function')renderSources();}
 window.addEventListener('message',event=>{if(event.origin!==ORIGIN||!popup||event.source!==popup||event.data?.type!=='zencore-real-data')return;try{accept(event.data.packet);}catch(error){connection=error.message;renderLive();}});
 window.ZenCoreLive={render:renderLive,connect,connectionStatus:()=>connection,modelFor:(tf,horizon)=>{const p=packets.get(String(tf));return p?model(p,Date.now(),horizon,F):null;},status:message=>{connection=String(message);renderLive();},snapshot:()=>{const p=packets.get(window.ZenCoreFusionDesk.getTimeframe());return p?{tf:p.pine.timeframe,asOf:p.pine.signalObservedAt,receivedAt:p.pine.receivedAt}:null;},acceptHost:packet=>{if(!native)throw Error('Host tidak disahkan.');accept(packet);},project,report:()=>{const tf=window.ZenCoreFusionDesk.getTimeframe(),p=packets.get(tf);if(!p)return 'ZENCORE · TUNGGU DATA SEBENAR · TF'+tf;const r=model(p,Date.now(),Number(new URLSearchParams(location.search).get('period')||30),F);return `ZENCORE · DATA PINE SEBENAR · TF${tf}\n${time(r.asOf)}\n${r.title}\nHarga ${num(r.price)}\nEntry ${num(r.planValid?r.plan.entry:null)} · SL ${num(r.planValid?r.plan.sl:null)} · TP1 ${num(r.planValid?r.plan.tp1:null)}\nData ${r.fresh?'segar':'lama'}. Tiada jaminan untung. Tiada order dihantar.`;}};
 const original=window.ZenCoreFusionDesk.report;window.ZenCoreFusionDesk.report=()=>window.ZenCoreFusionDesk.getView()!=='paired'?window.ZenCoreLive.report():original();
 setInterval(renderLive,5000);renderLive();
}
return {ORIGIN,SITE,project,model,mount};
});
