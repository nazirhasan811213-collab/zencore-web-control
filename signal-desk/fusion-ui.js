'use strict';

const fusionData=new Map();
let fusionView='live',fusionRecords=[],fusionImportKind='pine';
const deskParams=new URLSearchParams(location.search);
if(['sample','paired','live'].includes(deskParams.get('view')))fusionView=deskParams.get('view');
if(deskParams.get('embed')==='1')document.documentElement.dataset.layout='embedded';
const F=window.ZenCoreFusion;
const fusionSnapshotMarkup=document.querySelector('.snapshot>div').innerHTML;
const escapeText=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function fusionCurrent(){const data=fusionData.get(state.tf);return data?F.analyze(data,data.mode==='SAMPLE'?data.asOf:Date.now(),Number(state.period),sourceReview.events):null;}
function renderFusion(){
 const result=fusionCurrent(),data=fusionData.get(state.tf),paired=fusionView==='paired';
 $('fusion-panel').hidden=!paired;$('fusion-performance').hidden=!paired;$('sample-reports').hidden=paired;
 document.querySelectorAll('[data-view]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.view===fusionView)));
 const banner=paired?(data?.mode==='ZENCORE_READONLY'?'Data daripada Analysis ZenCore · baca sahaja. Model gabungan masih dalam ujian.':'Feed live belum disambungkan. Padanan dan win rate belum disahkan.'):'Contoh sahaja. Harga dan laluan ialah rekaan.';
 $('data-banner-text').textContent=banner;
 const tag=document.querySelector('.report-caption .sample-tag');tag.textContent=paired?(data?data.mode==='SAMPLE'?'CONTOH KIRAAN':data.mode==='ZENCORE_READONLY'?'ZENCORE · BACA SAHAJA':'IMPORT · BUKAN LIVE':'TUNGGU DATA PINE'):'SAMPEL · BUKAN LIVE';
 document.querySelector('.snapshot>div').innerHTML=paired?`Data Pine<strong>${data?escapeText(timeFmt.format(new Date(data.asOf)))+' MYT · '+(data.mode==='SAMPLE'?'contoh':data.mode==='ZENCORE_READONLY'?'Analysis ZenCore':'import'):'Belum diterima'}</strong>`:fusionSnapshotMarkup;
 const targets=paired?{main:'#main',entry:'#fusion-reference',levels:'#fusion-rows',sop:'#fusion-methods'}:{main:'#main',entry:'#entry',levels:'#levels',sop:'#sop'};
 document.querySelectorAll('[data-nav]').forEach(a=>{a.href=targets[a.dataset.nav];});
 $('fusion-decision').textContent=result?result.title:'Tunggu data Pine yang sebenar.';
 $('fusion-reason').textContent=result?result.conclusion:'Belum ada harga dan candle untuk dipadankan. Feed live memerlukan sambungan Errante yang sah.';
 $('fusion-origin').textContent=data?`${data.mode==='SAMPLE'?'Contoh rekaan dinilai pada masa contoh':data.mode==='ZENCORE_READONLY'?'Data Analysis ZenCore · baca sahaja':'Import manual · asal-usul belum diaudit'} · ${new Intl.DateTimeFormat('ms-MY',{timeZone:'Asia/Kuala_Lumpur',dateStyle:'medium',timeStyle:'short'}).format(new Date(data.asOf))} MYT`:'Feed live: belum disambungkan. Rekod prestasi: belum diterima.';
 document.querySelector('.fusion-decision').classList.toggle('has-conflict',!!result?.rows.some(row=>row.status==='CONFLICT'));
 const rows=result?.rows||['Pine','Trend','Struktur harga','Momentum','Gerak & kos','Berita'].map(name=>({name,status:'WAIT',value:'Tunggu data',detail:'Belum boleh dinilai.'}));
 const names={Pine:'crosshair',Trend:'trend','Struktur harga':'layers',Momentum:'activity','Gerak & kos':'shield',Berita:'clock'};
 $('fusion-rows').innerHTML=rows.map(row=>`<article class="fusion-check ${row.status.toLowerCase()}"><div><i>${icon(names[row.name])}</i><span>${row.status==='PASS'?'SEHALA':row.status==='CONFLICT'?'BERCANGGAH':'TUNGGU'}</span></div><h3>${escapeText(row.name)}</h3><strong>${escapeText(row.value)}</strong><p>${escapeText(row.detail)}</p></article>`).join('');
 const ref=result?.reference;
 $('fusion-reference').innerHTML=[['Harga data',ref?.price],['Entry asal Pine',ref?.plan?.entry],['Sokongan dekat',ref?.support],['Rintangan dekat',ref?.resistance],['SL asal Pine',ref?.plan?.sl],['TP1 asal Pine',ref?.plan?.tp1]].map(([name,value])=>`<div><span>${name}</span><strong>${Number.isFinite(value)?format(value):'—'}</strong></div>`).join('');
 $('fusion-data-note').textContent=result?`${result.warmup}/${result.warmupRequired} candle minimum · ${result.excludedOpen} candle belum tutup diketepikan${result.gaps?' · Ada jurang masa':''}. Bacaan ini tidak menggantikan signal server atau mengesahkan win rate.`:'Tiada angka ramalan atau paras harga direka untuk mengisi data yang belum ada.';
 $('fusion-source-links').innerHTML=F.SOURCES.map(src=>`<a href="${src.url}" target="_blank" rel="noopener noreferrer">${src.name}<i>${icon('arrowUpRight')}</i></a>`).join('');
 renderFusionPerformance();
 if(window.ZenCoreLive)window.ZenCoreLive.render();
}
function renderFusionPerformance(){
 const s=F.performance(fusionRecords,state.tf,state.period);
 const percent=n=>n===null?'—':(n*100).toFixed(1)+'%';
 $('performance-grid').innerHTML=[
  ['Rekod OOS',String(s.n),`TF${state.tf} · ${state.period} minit`],
  ['Win rate diperhati',percent(s.winRate),s.n?`${s.wins} menang / ${s.n} hasil dinilai`:'Belum diukur'],
  ['Purata hasil bersih',s.expectancy===null?'—':s.expectancy.toFixed(2)+' R','Selepas kos setiap hasil'],
  ['Julat Wilson 95%',s.interval?`${percent(s.interval.low)}–${percent(s.interval.high)}`:'—','Anggaran daripada rekod; bukan ramalan']
 ].map(([label,value,note])=>`<div><span>${label}</span><strong>${value}</strong><small>${note}</small></div>`).join('');
 $('performance-foot').textContent=s.n?`IMPORT MANUAL · belum diaudit. ${s.n<100?'Data masih sedikit. ':''}Profit factor: ${s.profitFactor===null?(s.noLosses?'belum ada kerugian dalam sampel ini':'—'):s.profitFactor.toFixed(2)} · Susut maksimum: ${s.maxDrawdown.toFixed(2)} R. Hasil dinilai pada exit SOP atau akhir horizon. Semua calon mesti direkod; elak memilih yang menang sahaja.`:'Belum ada rekod untuk model gabungan ini. Bilangan indikator bukan peratus menang. Uji tetapan tetap pada data baharu sebelum membuat dakwaan prestasi.';
}
function openFusionImport(kind){
 fusionImportKind=kind;$('pine-import-title').textContent=kind==='results'?'Buka rekod ujian gabungan.':'Buka data Pine + candle.';
 $('pine-import-description').textContent=kind==='results'?'Import rekod OOS selepas kos untuk model V1 ini. Hasil import dikira semula; asal-usul data belum diaudit.':'Gunakan export analisis dan candle pada TF yang sama. Import manual tidak mengaktifkan feed live.';
 $('pine-json').value='';$('pine-import-error').textContent='';$('pine-import-dialog').showModal();
}
function demoFusion(){
 const m=markets[state.tf],tf=state.tf,end=snapshot.getTime(),period=Number(tf)*60000;
 // Synthetic, fixed-time demonstration. No live Pine data or historical win rate is fabricated.
 const candles=[];
 for(let i=0;i<100;i++){
  const close=m.price-8+i*.08+Math.sin(i*.7)*m.atr*.6,open=i?candles.at(-1).close:close-.1;
  candles.push({time:end-(100-i)*period,timeframe:tf,open,high:Math.max(open,close)+m.atr*.35,low:Math.min(open,close)-m.atr*.35,close});
 }
 const last=candles.at(-1),price=last.close;
 const packet={mode:'SAMPLE',pine:{symbol:'XAUUSD',timeframe:tf,sourceBarTime:last.time,signalObservedAt:end,receivedAt:end,confirmed:true,normal3Close:price,
  normal3Entry:price,initialSl:price-m.atr,tp1:price+m.atr*1.5,tp2:price+m.atr*2,tp3:price+m.atr*3,
  setupMeta:{solidSide:'BUY',solidHoldActive:true,solidClosedAt:null,entryRuleVersion:tf==='2'?'TF2_SOLID_RIBBON_V1':'TF15_SOLID_RIBBON_V1',entryPolicyVersion:'PINE_SOLID_3OF4_FORECAST45_V5'},
  strategyNormal:{state:'WAIT'},hemaConfirmation:{['tf'+tf]:{fast:price-.1,slow:price-.4}}},
  history:{symbol:'XAUUSD',timeframe:tf,candles},costs:{spread:.2,slippageRoundTrip:.1,commissionPrice:0},news:{clear:false}};
 fusionData.set(tf,F.normalize(packet));fusionView='paired';renderFusion();toast('Contoh kiraan dimuatkan. Bukan signal Pine sebenar.');
}
function fusionReportText(){
 const r=fusionCurrent(),s=F.performance(fusionRecords,state.tf,state.period);
 if(!r)return `ZENCORE FUSION V1 · TUNGGU DATA PINE\nTF${state.tf} | ${state.period} minit\nFeed belum disambungkan. Tiada analisis live atau win rate yang disahkan.`;
 return `ZENCORE FUSION V1 · ${r.mode==='SAMPLE'?'CONTOH REKAAN':'IMPORT MANUAL BELUM DIAUDIT'} · BUKAN SIGNAL LIVE\nTF${state.tf} | ${state.period} minit\n${r.title}\n${r.conclusion}\n\n${r.rows.map(row=>`${row.name}: ${row.status} | ${row.value} | ${row.detail}`).join('\n')}\n\nSokongan dekat: ${r.reference.support??'belum ada'}\nRintangan dekat: ${r.reference.resistance??'belum ada'}\nSL asal: ${r.reference.plan?.sl??'belum disahkan'}\nTP1 asal: ${r.reference.plan?.tp1??'belum disahkan'}\n\nHasil OOS yang diimport: ${s.n}. Win rate: ${s.winRate===null?'belum diukur':(100*s.winRate).toFixed(1)+'% (manual, belum diaudit)'}.\nPenapis V1 belum terbukti menaikkan ketepatan. Tiada order dihantar.`;
}
document.querySelectorAll('[data-view]').forEach(button=>button.addEventListener('click',()=>{fusionView=button.dataset.view;const p=new URLSearchParams(location.search);p.set('view',fusionView);history.replaceState(null,'',`${location.pathname}?${p}${location.hash}`);renderFusion();}));
$('open-pine-import').addEventListener('click',()=>openFusionImport('pine'));
$('open-results-import').addEventListener('click',()=>openFusionImport('results'));
$('close-pine-import').addEventListener('click',()=>$('pine-import-dialog').close());
$('fusion-demo').addEventListener('click',demoFusion);
$('clear-fusion-data').addEventListener('click',()=>{fusionData.clear();fusionRecords=[];$('pine-json').value='';$('pine-import-error').textContent='';renderFusion();$('pine-import-dialog').close();toast('Data import dikosongkan.');});
$('apply-pine-import').addEventListener('click',()=>{
 try{
  const raw=$('pine-json').value;if(raw.length>4*1024*1024)throw new Error('Fail melebihi 4 MB.');const packet=JSON.parse(raw);
  if(fusionImportKind==='results'){
   if(!Array.isArray(packet.trades))throw new Error('Perlu bahagian trades berbentuk senarai.');
   if(packet.trades.some(t=>!['2','15'].includes(String(t.timeframe))||![30,60].includes(Number(t.horizonMinutes))||!['IS','OOS'].includes(t.split)))throw new Error('Setiap rekod perlu TF2/TF15, horizon 30/60 dan split IS/OOS.');
   for(const tf of ['2','15'])for(const horizon of [30,60])F.performance(packet.trades,tf,horizon);
   fusionRecords=packet.trades.map(t=>({id:t.id,variant:t.variant,timeframe:t.timeframe,horizonMinutes:t.horizonMinutes,split:t.split,labelGeneratedAt:t.labelGeneratedAt,openedAt:t.openedAt,closedAt:t.closedAt,grossR:t.grossR,costR:t.costR,netR:t.netR,exitKind:t.exitKind}));
  }else{const data=F.normalize(packet);fusionData.set(data.tf,data);state.tf=data.tf;state.period=data.tf==='2'?'30':'60';render();}
  fusionView='paired';$('pine-json').value='';$('pine-import-dialog').close();renderFusion();toast('Data import disemak. Asal-usul masih belum diaudit.');
 }catch(error){$('pine-import-error').textContent=error instanceof SyntaxError?'JSON tidak sah. Semak format fail.':error.message;}
});
window.ZenCoreFusionDesk={
 render:renderFusion,report:()=>fusionView==='paired'?fusionReportText():reportText(),
 getView:()=>fusionView,getTimeframe:()=>state.tf,
 acceptReadOnlyData:packet=>{const data=F.normalize({...packet,mode:"ZENCORE_READONLY"},{originVerified:true});fusionData.set(data.tf,data);renderFusion();},
 getHostSnapshot:()=>{const data=fusionData.get(state.tf);return data?.mode==='ZENCORE_READONLY'?{asOf:data.asOf,receivedAt:data.receivedAt,tf:data.tf}:null;},
 setTimeframe:tf=>{if(!['2','15'].includes(String(tf)))return;state.tf=String(tf);state.period=state.tf==='2'?'30':'60';state.step=0;state.scenario='main';render();},
 acceptHostPacket:packet=>{
  if(document.querySelector('meta[name="zencore-desk-host"]')?.content!=='errante')throw new Error('Host Analysis ZenCore tidak disahkan.');
  const data=F.normalize({...packet,mode:'ZENCORE_READONLY'},{originVerified:true});fusionData.set(data.tf,data);renderFusion();if(typeof renderSources==='function')renderSources();
 }
};
renderFusion();
// Refresh only on-screen age checks; does not fetch data or schedule background work.
setInterval(()=>{if(fusionView==='paired'&&fusionData.size)renderFusion();},15000);
