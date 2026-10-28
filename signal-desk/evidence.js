'use strict';

// Source review, not a live feed or a replacement for the ZenCore strategy engine.
const sourceReview=Object.freeze({
 reviewedOn:'2026-10-28',calendarValidUntil:'2026-10-29T04:00:00Z',
 sources:[
  {icon:'database',name:'Harga & candle Errante',status:'BELUM MASUK',kind:'missing',use:'Sumber utama untuk harga dan signal sebenar.',detail:'API analisis memerlukan sesi ZenCore yang sah. Feed belum disambungkan ke laman ini.',url:'https://zencore-errante.onrender.com/login',link:'Buka ZenCore Errante'},
  {icon:'check',name:'Panduan ZenCore',status:'RUJUKAN',kind:'reference',use:'Terangkan flow TF2, TF15 dan pengurusan posisi.',detail:'Dokumen 12 Okt 2026. Rujukan ini bukan signal semasa.',url:'https://chatgpt.com/library?file_id=libfile_d1e9012b57548191b5f356207251af28&account_id=personal',link:'Lihat panduan'},
  {icon:'layers',name:'Kod SOP Errante',status:'VERSI LIVE BELUM SAH',kind:'pending',use:'Semak cara kod menerima atau menolak setup.',detail:'Kod ada beberapa versi SOP. Versi feed aktif perlu dipadankan dahulu.',url:'https://github.com/nazirhasan811213-collab/zencore-web-control/blob/clone/zencore-errante-20261020/tf2-ribbon-scalping.js',link:'Lihat sumber kod'},
  {icon:'clock',name:'Federal Reserve & BLS',status:'JADUAL DISEMAK',kind:'reference',use:'Kenal waktu berita. Bukan penentu BUY atau SELL.',detail:'Semakan 28 Okt 2026. Jadual rasmi; bukan feed berita automatik.',url:'https://www.federalreserve.gov/newsevents/2026-october.htm',link:'Kalendar Fed'},
  {icon:'activity',name:'World Gold Council',status:'KONTEKS SAHAJA',kind:'reference',use:'Rujukan emas bagi tempoh yang lebih panjang.',detail:'Data rujukan dikemas kini mingguan. Tidak digunakan untuk entry TF2.',url:'https://www.gold.org/goldhub/data/gold-prices',link:'Lihat rujukan emas'},
  {icon:'shield',name:'Rekod ketepatan signal',status:'BELUM DIUKUR',kind:'missing',use:'Ukur hasil sebenar selepas kos trading.',detail:'Belum ada sampel signal live yang boleh diuji di laman ini. Tiada kadar menang dipaparkan.',url:null,link:null}
 ],
 events:[
  {name:'Data pekerjaan BLS',at:'2026-10-28T14:00:00Z',display:'28 Okt · 10:00 malam MYT',detail:'Data metro & Business Employment Dynamics.',url:'https://www.bls.gov/schedule/2026/10_sched_list.htm'},
  {name:'FOMC · keputusan dasar',at:'2026-10-28T18:00:00Z',display:'29 Okt · 2:00 pagi MYT',detail:'Waktu yang dijadualkan oleh Federal Reserve.',url:'https://www.federalreserve.gov/newsevents/2026-october.htm'},
  {name:'FOMC · sidang media',at:'2026-10-28T18:30:00Z',display:'29 Okt · 2:30 pagi MYT',detail:'Waktu yang dijadualkan oleh Federal Reserve.',url:'https://www.federalreserve.gov/newsevents/2026-october.htm'}
 ],
 provenance:{branch:'clone/zencore-errante-20261020',files:[
  {path:'tf2-ribbon-scalping.js',blobSha:'b2e6166feb8c97dd74617f0e46287e06a6fd1a70'},
  {path:'tf15-intraday.js',blobSha:'128b0e9f189981d3644d7b69413c4b938ce74623'},
  {path:'server-analysis.js',blobSha:'06ed40e64ee0337c51c2a8c5eb17faf84819dbf4'},
  {path:'analysis-execution-contract.js',blobSha:'bbdcf46cae45d5425855713693ecc6c9bf9ebcf6'}
 ]}
});

const currentEvidence=Object.freeze({mode:'SAMPLE',symbol:'XAUUSD',tf:null,observedAt:null,receivedAt:null,brokerMatched:false,closedCandles:false,activePolicyMatched:false,serverPlanVerified:false,spreadChecked:false});

// This only checks whether data is reviewable. It can never authorize an order.
// Age limits come from the read-only Errante TF2/TF15 strategy code above.
function assessData(e,now=Date.now()){
 const at=v=>typeof v==='string'?Date.parse(v):NaN;
 const fresh=(v,maxAge)=>Number.isFinite(at(v))&&now-at(v)>=-5000&&now-at(v)<=maxAge;
 const supported=e.symbol==='XAUUSD'&&['2','15'].includes(e.tf);
 const limits=e.tf==='2'?60000:30000;
 const checks=[
  {label:'Harga broker segar',ok:supported&&e.brokerMatched===true&&fresh(e.observedAt,limits)&&fresh(e.receivedAt,limits),status:'Belum masuk'},
  {label:'Candle sudah tutup',ok:e.closedCandles===true,status:'Belum disahkan'},
  {label:'Versi SOP aktif sepadan',ok:e.activePolicyMatched===true,status:'Perlu semak'},
  {label:'Pelan asal ZenCore sah',ok:e.serverPlanVerified===true,status:'Belum disahkan'},
  {label:'Spread broker disemak',ok:e.spreadChecked===true,status:'Belum masuk'}
 ];
 const sample=e.mode!=='LIVE';
 if(sample)checks.forEach(c=>{c.ok=false;});
 return {status:sample?'SAMPLE':checks.every(c=>c.ok)?'REVIEWABLE':'WAIT',reviewable:!sample&&checks.every(c=>c.ok),orderExecution:false,checks};
}
function calendarReview(now=Date.now()){
 const expired=now>Date.parse(sourceReview.calendarValidUntil);
 return {expired,label:expired?'PERLU SEMAK SEMULA':'JADUAL · 28 OKT',events:sourceReview.events.map(e=>({...e,state:now>=Date.parse(e.at)?'Masa berlalu · hasil belum disahkan':'Dijadualkan'}))};
}
