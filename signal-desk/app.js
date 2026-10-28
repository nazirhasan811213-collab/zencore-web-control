'use strict';

const paths={
 grid:'<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
 target:'<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><path d="m14 10 7-7m-4 0h4v4"/>',
 layers:'<path d="m3 7 9-4 9 4-9 4-9-4Zm0 5 9 4 9-4M3 17l9 4 9-4"/>',
 check:'<path d="m5 12 4 4L19 6"/><path d="M20 12v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h8"/>',
 database:'<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 4 16 4 16 0V5M4 12c0 4 16 4 16 0"/>',
 arrowUpRight:'<path d="M7 17 17 7M7 7h10v10"/>',
 arrowRight:'<path d="M4 12h16m-6-6 6 6-6 6"/>',
 clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
 lock:'<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2"/>',
 copy:'<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
 flask:'<path d="M9 3h6m-5 0v6L4 19a1.3 1.3 0 0 0 1 2h14a1.3 1.3 0 0 0 1-2L14 9V3M7 14h10m-7 3h.01m4 1h.01"/>',
 info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10h.01"/>',
 activity:'<path d="M2 12h4l3-8 6 16 3-8h4"/>',
 crosshair:'<circle cx="12" cy="12" r="7"/><path d="M12 2v5m0 10v5M2 12h5m10 0h5"/>',
 shield:'<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z"/><path d="m8 12 3 3 5-6"/>',
 mouse:'<rect x="6" y="2" width="12" height="20" rx="6"/><path d="M12 6v4"/>',
 x:'<path d="m6 6 12 12M6 18 18 6"/>',
 tick:'<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
 pending:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
 trend:'<path d="m3 17 6-6 4 4 8-10m-6 0h6v6"/>',
 warning:'<path d="m12 3 10 18H2L12 3Zm0 6v5m0 3h.01"/>'
};
const icon=(name)=>`<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name]||paths.info}</svg>`;
function icons(root=document){root.querySelectorAll('[data-icon]').forEach(el=>{el.innerHTML=icon(el.dataset.icon);});}
const $=(id)=>document.getElementById(id);
const format=(value)=>value.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
const snapshot=new Date('2026-10-28T02:00:00Z');
const timeFmt=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Kuala_Lumpur',hour:'2-digit',minute:'2-digit',hour12:false});
const state={tf:'2',period:'30',position:'flat',scenario:'main',step:0};
const markets={
 '2':{
  label:'Scalping',price:4268.4,change:8.2,atr:1.85,entry:[4266.8,4267.5],line:4267.2,stop:4264.8,tp:[4270,4272.4,4274.8],
  structure:'Higher low',hema:'TF2 + TF3',hemaValue:'Selari menaik',risk:'Sederhana',
  levels:[{name:'S1',type:'Sokongan',price:4267},{name:'S2',type:'Sokongan',price:4264.8},{name:'R1',type:'Rintangan',price:4270},{name:'R2',type:'Rintangan',price:4272.4}],
  base:4260.2,chartSpan:11.1,
 },
 '15':{
  label:'Intraday',price:4268.4,change:19.6,atr:8.4,entry:[4261.8,4263.2],line:4263.2,stop:4255.6,tp:[4276,4284,4291.2],
  structure:'Range menaik',hema:'TF15 + TF30',hemaValue:'Belum selari',risk:'Tinggi · whipsaw',
  levels:[{name:'S1',type:'Sokongan',price:4263},{name:'S2',type:'Sokongan',price:4255.6},{name:'R1',type:'Rintangan',price:4276},{name:'R2',type:'Rintangan',price:4284}],
  base:4248.8,chartSpan:30.2,
 }
};
for(const m of Object.values(markets))m.checks=assessData(currentEvidence).checks;
const reports={
 "2-30": {
  "chip": "Cuba naik",
  "status": "TUNGGU ZON",
  "title": "Turun sikit. Jika bertahan, cuba naik.",
  "summary": "Tunggu harga di 4,266.80–4,267.50. Jika harga bertahan, jangka cubaan ke 4,270.00.",
  "context": "Harga hampir 4,270.00. Tunggu harga turun ke zon dahulu.",
  "outlook": "30 minit ke hadapan",
  "scope": "Laporan utama",
  "forecast": {
   "bias": "TURUN DULU → CUBA NAIK",
   "actionTitle": "Tunggu di zon kuning.",
   "actionText": "Masuk hanya selepas candle TF2 tutup atas 4,267.20 dan SOP aktif sah.",
   "stages": [
    [
     "01",
     "Tunggu harga turun",
     "Zon: 4,266.80–4,267.50."
    ],
    [
     "02",
     "Tunggu candle tutup",
     "TF2 tutup atas 4,267.20. Semak SOP."
    ],
    [
     "03",
     "Pantau sasaran dekat",
     "4,270.00. Harga mungkin berhenti di sini."
    ]
   ],
   "failedStages": [
    [
     "01",
     "Sokongan gagal",
     "Harga gagal bertahan di zon kuning."
    ],
    [
     "02",
     "Perhatikan 4,264.80",
     "Tunggu candle TF2 tutup."
    ],
    [
     "03",
     "Batalkan pelan naik",
     "Jika TF2 tutup bawah 4,264.80."
    ]
   ],
   "condition": "Zon bertahan + TF2 tutup atas 4,267.20 + SOP sah.",
   "failure": "Jika TF2 tutup bawah 4,264.80, batalkan pelan naik. Tunggu setup baharu.",
   "mainPath": [
    4268.4,
    4267.1,
    4267.2,
    4270
   ],
   "failedPath": [
    4268.4,
    4267,
    4267.2,
    4264.5
   ],
   "mainEnd": "Sasaran 4,270.00",
   "failedEnd": "Batal bawah 4,264.80"
  },
  "flat": {
   "title": "Belum masuk? Tunggu zon.",
   "text": "Jangan kejar harga. Tunggu zon kuning dan candle TF2 tutup atas 4,267.20. Semak SOP aktif."
  },
  "buy": {
   "title": "Sudah BUY? Pantau 4,270.00.",
   "text": "Kekalkan SL asal. Jangan tambah posisi di rintangan. Urus exit ikut SOP yang dipasang."
  },
  "sell": {
   "title": "Sudah SELL? Jaga SL.",
   "text": "Jangan tambah SELL hanya kerana harga tinggi. Pelan BUY batal tidak bermakna ada signal SELL."
  },
  "scenarios": [
   [
    "trend",
    "JIKA ZON BERTAHAN",
    "Cuba ke 4,270.00",
    "Tunggu TF2 tutup atas 4,267.20. Semak SOP sebelum masuk."
   ],
   [
    "warning",
    "JIKA ZON PECAH",
    "Pantau 4,264.80",
    "TF2 tutup bawah paras ini: batalkan pelan naik."
   ],
   [
    "activity",
    "JIKA HARGA “LIBAS”",
    "Tunggu dahulu",
    "Candle besar atau spread lebar? Jangan kejar. Semak SOP candle besar."
   ]
  ]
 },
 "2-60": {
  "chip": "Naik bertahap",
  "status": "TUNGGU ZON",
  "title": "Cuba 4,270. Tembus? Pantau 4,272.40.",
  "summary": "Tunggu harga kembali ke zon. Jika lantunan sah, pantau 4,270.00 dahulu. Sasaran kedua perlukan pecahan yang sah.",
  "context": "Ada dua rintangan dekat. Harga boleh berhenti atau turun semula di situ.",
  "outlook": "1 jam ke hadapan",
  "scope": "Pandangan lebih jauh",
  "forecast": {
   "bias": "NAIK SATU PARAS DEMI SATU",
   "actionTitle": "Tunggu zon. Jangan masuk lewat.",
   "actionText": "Candle tetap TF2. Laporan 1 jam tidak menukar syarat entry.",
   "stages": [
    [
     "01",
     "Tunggu harga kembali",
     "Zon: 4,266.80–4,267.50."
    ],
    [
     "02",
     "Pantau 4,270.00",
     "Jika lantunan dan SOP sah."
    ],
    [
     "03",
     "Kemudian 4,272.40",
     "Hanya jika 4,270.00 ditembusi dan kekal bertahan."
    ]
   ],
   "failedStages": [
    [
     "01",
     "4,270.00 menolak harga",
     "Kenaikan boleh berhenti di sini."
    ],
    [
     "02",
     "Turun ke sokongan dekat",
     "Pantau 4,267.00, kemudian 4,264.80."
    ],
    [
     "03",
     "Batalkan jika pecah",
     "TF2 tutup bawah 4,264.80: pelan BUY batal."
    ]
   ],
   "condition": "Zon bertahan. Ke 4,272.40 hanya jika TF2 tutup atas 4,270.00 dan harga kekal di atasnya.",
   "failure": "Jika 4,270.00 menolak harga, pantau 4,267.00–4,264.80. TF2 tutup bawah 4,264.80: pelan BUY batal.",
   "mainPath": [
    4268.4,
    4267.1,
    4270,
    4272.4
   ],
   "failedPath": [
    4268.4,
    4270,
    4267,
    4264.8
   ],
   "mainEnd": "Ke 4,272.40 jika sah",
   "failedEnd": "Kembali ke sokongan"
  },
  "flat": {
   "title": "Tunggu harga di zon.",
   "text": "Masuk hanya selepas pengesahan TF2 dan SOP aktif. Jika TP1 sudah berlalu, tunggu setup baharu."
  },
  "buy": {
   "title": "Sudah BUY? Pantau dua sasaran.",
   "text": "4,270.00 dahulu. Kemudian 4,272.40 jika harga tembus dan bertahan. Ikut SOP exit aktif."
  },
  "sell": {
   "title": "Sudah SELL? Jangan tambah dahulu.",
   "text": "Penolakan harga sahaja belum cukup. Tunggu signal SELL baharu dan ikut SL posisi sendiri."
  },
  "scenarios": [
   [
    "trend",
    "JIKA HARGA NAIK",
    "4,270 → 4,272.40",
    "Sasaran kedua hanya jika pecahan 4,270.00 disahkan."
   ],
   [
    "warning",
    "JIKA HARGA DITOLAK",
    "4,267 → 4,264.80",
    "TF2 tutup bawah 4,264.80: pelan BUY batal."
   ],
   [
    "activity",
    "JIKA HARGA “LIBAS”",
    "Tunggu sahaja",
    "Harga tembus kemudian masuk semula? Jangan kejar."
   ]
  ]
 },
 "15-30": {
  "chip": "Naik turun",
  "status": "TUNGGU",
  "title": "Jangka naik turun antara dua paras.",
  "summary": "Pantau 4,263.00 di bawah dan 4,276.00 di atas. Selagi belum pecah, harga boleh berulang dalam kawasan ini.",
  "context": "Harga di tengah kawasan. Arah TF15 dan TF30 belum selari.",
  "outlook": "30 minit ke hadapan",
  "scope": "Semakan ringkas",
  "forecast": {
   "bias": "ANTARA 4,263 DAN 4,276",
   "actionTitle": "Tunggu di tepi kawasan.",
   "actionText": "Jangan masuk di tengah. Tunggu pengesahan candle TF15 dan SOP aktif.",
   "stages": [
    [
     "01",
     "Pantau bawah: 4,263.00",
     "Ini kawasan harga boleh bertahan."
    ],
    [
     "02",
     "Jika bertahan, cuba lantun",
     "Tunggu candle TF15 dan semak SOP."
    ],
    [
     "03",
     "Pantau atas: 4,276.00",
     "Harga boleh berhenti atau turun semula."
    ]
   ],
   "failedStages": [
    [
     "01",
     "4,263.00 pecah",
     "Tunggu TF15 tutup bawah paras ini."
    ],
    [
     "02",
     "Risiko turun lagi",
     "Pantau kawasan 4,255.60."
    ],
    [
     "03",
     "Gugurkan pelan lantunan",
     "Tunggu setup baharu. Jangan terus SELL tanpa SOP."
    ]
   ],
   "condition": "Harga masih dalam range 4,263.00–4,276.00.",
   "failure": "Jika TF15 tutup bawah 4,263.00, pantau 4,255.60. Jika pecah atas 4,276.00, semak pelan naik baharu.",
   "mainPath": [
    4268.4,
    4263,
    4268.4,
    4276
   ],
   "failedPath": [
    4268.4,
    4263,
    4260.4,
    4255.6
   ],
   "mainEnd": "Uji 4,276 jika bawah tahan",
   "failedEnd": "Risiko ke 4,255.60"
  },
  "flat": {
   "title": "Belum masuk? Tunggu.",
   "text": "Arah TF15 dan TF30 belum sama. Tunggu pengesahan penuh mengikut SOP aktif."
  },
  "buy": {
   "title": "Sudah BUY? Pantau 4,276.00.",
   "text": "Jangan tambah posisi di tengah kawasan. Kekalkan SL dan ikut pelan exit sendiri."
  },
  "sell": {
   "title": "Sudah SELL? Patuhi SL.",
   "text": "Harga masih boleh melantun. Jangan campur pelan TF2 dengan pelan TF15."
  },
  "scenarios": [
   [
    "trend",
    "JIKA BAWAH BERTAHAN",
    "Cuba lantun ke 4,276",
    "Masuk hanya jika candle TF15 dan SOP sah."
   ],
   [
    "warning",
    "JIKA BAWAH PECAH",
    "Pantau 4,255.60",
    "TF15 tutup bawah 4,263.00: pelan lantunan gagal."
   ],
   [
    "activity",
    "JIKA HARGA “LIBAS”",
    "Duduk tepi dahulu",
    "Tunggu arah jelas. Tidak perlu masuk setiap laporan."
   ]
  ]
 },
 "15-60": {
  "chip": "Naik turun",
  "status": "TUNGGU PECAHAN",
  "title": "Pecah atas: cuba naik. Pecah bawah: awas.",
  "summary": "Atas 4,276.00: pantau 4,284.00. Bawah 4,263.00: pantau 4,255.60. Tunggu candle TF15 dan pengesahan SOP.",
  "context": "Arah belum jelas. Tunggu harga keluar dari kawasan 4,263.00–4,276.00.",
  "outlook": "1 jam ke hadapan",
  "scope": "Laporan utama",
  "forecast": {
   "bias": "TUNGGU ATAS ATAU BAWAH",
   "actionTitle": "Tunggu arah disahkan.",
   "actionText": "Pecahan harga sahaja belum cukup. Sahkan candle TF15 dan SOP aktif dahulu.",
   "stages": [
    [
     "01",
     "Jangka naik turun dahulu",
     "Kawasan: 4,263.00–4,276.00."
    ],
    [
     "02",
     "Tunggu pecah 4,276.00",
     "Candle TF15 tutup di atas dan harga kekal bertahan."
    ],
    [
     "03",
     "Baru pantau 4,284.00",
     "Sambungan naik hanya selepas pengesahan."
    ]
   ],
   "failedStages": [
    [
     "01",
     "Pecah bawah 4,263.00",
     "Tunggu candle TF15 tutup di bawah."
    ],
    [
     "02",
     "Pantau 4,255.60",
     "Ini kawasan sokongan seterusnya."
    ],
    [
     "03",
     "Pelan BUY batal jika pecah",
     "TF15 tutup bawah 4,255.60. Tunggu setup baharu."
    ]
   ],
   "condition": "Untuk naik: TF15 tutup atas 4,276.00 dan harga kekal bertahan. Dalam range, tunggu dahulu.",
   "failure": "Jika TF15 tutup bawah 4,263.00, pantau 4,255.60. Tutup bawah 4,255.60: pelan BUY batal.",
   "mainPath": [
    4268.4,
    4263,
    4276,
    4284
   ],
   "failedPath": [
    4268.4,
    4263,
    4260.4,
    4255.6
   ],
   "mainEnd": "Ke 4,284 jika pecahan sah",
   "failedEnd": "Uji bawah 4,255.60"
  },
  "flat": {
   "title": "Belum masuk? Tunggu pecahan.",
   "text": "Selepas pecahan, tunggu harga uji semula paras itu. Masuk hanya jika SOP aktif sah."
  },
  "buy": {
   "title": "Sudah BUY? Jaga SL.",
   "text": "Jangan tambah posisi selagi arah belum sah. Sasaran naik tidak dijamin."
  },
  "sell": {
   "title": "Sudah SELL? Jangan tambah di tengah.",
   "text": "Tunggu pengesahan arah turun. Ikut SL posisi sendiri."
  },
  "scenarios": [
   [
    "trend",
    "JIKA PECAH ATAS",
    "4,276 → 4,284",
    "TF15 tutup atas 4,276 dan harga kekal bertahan."
   ],
   [
    "warning",
    "JIKA PECAH BAWAH",
    "4,263 → 4,255.60",
    "TF15 tutup bawah 4,263. Semak setup baharu."
   ],
   [
    "activity",
    "JIKA HARGA “LIBAS”",
    "Tunggu dahulu",
    "Wick panjang dan arah bercampur? Jangan kejar."
   ]
  ]
 }
};

function render(){
 if(window.ZenCoreVisual&&window.ZenCoreFusionDesk?.getView()==='sample'){window.ZenCoreVisual.render();return;}
 const m=markets[state.tf],r=reports[`${state.tf}-${state.period}`];
 document.querySelectorAll('[data-tf]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.tf===state.tf)));
 document.querySelectorAll('[data-period]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.period===state.period)));
 $('report-caption').innerHTML=`<strong>TF${state.tf} ${m.label}</strong> &nbsp;/&nbsp; ${r.outlook} &nbsp;·&nbsp; ${r.scope}`;
 renderForecast();renderSources();
 $('context-chip').textContent=r.chip;$('context-chip').classList.toggle('warning',state.tf==='15'||state.period==='60');
 $('price').textContent=format(m.price);$('price-change').textContent=`↗ +${format(m.change)} USD`;
 $('price-change-caption').textContent=`sepanjang ${state.tf==='2'?'96 minit':'12 jam'} carta contoh`;
 $('structure').textContent=m.structure;$('hema-label').textContent=`HEMA ${m.hema}`;$('hema-value').textContent=m.hemaValue;
 $('hema-value').style.color=state.tf==='15'?'var(--gold)':'var(--cyan)';$('market-risk').textContent=m.risk;
 $('market-context').textContent=r.context;$('status-chip').textContent=r.status;$('guidance-title').textContent=r.forecast.actionTitle;$('guidance-summary').textContent=r.forecast.actionText;
 document.querySelector('.guidance-card').classList.toggle('no-trade',state.tf==='15');
 $('close-tf').textContent=`TF${state.tf}`;renderPosition();
 $('chart-tf').textContent=`TF${state.tf}`;$('chart-subtitle').textContent=state.tf==='2'?'Struktur dekat TF2. Fokus reaksi, bukan paras jauh.':'Struktur TF15. Paras ini khusus untuk intraday.';
 $('chart-atr').textContent=`ATR14 contoh · $${m.atr.toFixed(2)}`;
 $('entry-subtitle').textContent=`Trigger kekal pada candle close TF${state.tf}.`;
 $('direction-tag').textContent=state.tf==='2'?'BUY BERSYARAT':'TUNGGU';$('direction-tag').classList.toggle('wait',state.tf==='15');
 $('entry-range').textContent=`${format(m.entry[0])} – ${format(m.entry[1])}`;
 $('entry-trigger').textContent=`Tunggu harga di zon. Candle TF${state.tf} tutup atas ${format(m.line)}. Semak SOP aktif.`;
 $('stop-price').textContent=format(m.stop);m.tp.forEach((p,i)=>$(`tp${i+1}`).textContent=format(p));
 $('entry-note').textContent='Paras contoh sahaja. Pelan sebenar mesti ikut feed dan versi SOP aktif. Tiada order dihantar.';
 const rewardLow=(m.tp[0]-m.entry[1])/(m.entry[1]-m.stop),rewardHigh=(m.tp[0]-m.entry[0])/(m.entry[0]-m.stop);
 $('risk-reward').textContent=`1:${rewardLow.toFixed(2)}–${rewardHigh.toFixed(2)}*`;
 $('risk-reward').title='Anggaran kasar dari hujung zon entry ke SL dan TP1, belum termasuk spread atau slippage. Bukan kebarangkalian untung.';
 $('levels-tf').textContent=`TF${state.tf} ${m.label}`;
 $('levels-subtitle').textContent=state.tf==='2'?'Swing lokal TF2 · jarak diukur daripada 4,268.40.':'Swing lokal TF15 · jangan guna sebagai SL scalping TF2.';
 $('level-rows').innerHTML=m.levels.map(l=>{
  const d=l.price-m.price;
  return `<div class="level-row ${l.type==='Rintangan'?'resistance':''}"><span><b class="level-label">${l.name}</b>${l.type}</span><strong>${format(l.price)}</strong><span class="level-distance"><span class="distance-track"><b style="width:${Math.min(100,Math.abs(d)/m.atr/2.5*100)}%"></b></span>${d>=0?'+':'−'}$${Math.abs(d).toFixed(2)}<small>${(Math.abs(d)/m.atr).toFixed(2)}× ATR</small></span></div>`;
 }).join('');
 $('levels-footnote').textContent=state.tf==='2'?'Semua paras contoh dekat dengan harga: dalam 2.5× ATR TF2. Kira semula dengan candle broker sebelum guna.':'Paras ini untuk TF15. Untuk scalping, tukar ke TF2.';
 const count=m.checks.filter(c=>c.ok).length;
 $('sop-count').innerHTML=`${count}<small> / 5 data</small>`;$('sop-progress').style.width=`${count*20}%`;
 $('sop-rows').innerHTML=m.checks.map(c=>`<div class="sop-row ${c.ok?'':'pending'}"><i>${icon(c.ok?'tick':'pending')}</i><span>${c.label}</span><small>${c.status}</small></div>`).join('');
 $('sop-count').title='Data disahkan, bukan skor SOP atau kebarangkalian untung. Contoh ini belum ada data live.';
 $('scenario-window').textContent=`Contoh 10:00–${state.period==='30'?'10:30':'11:00'} MYT`;
 $('scenario-grid').innerHTML=r.scenarios.map(s=>`<div class="scenario"><div class="scenario-top"><i>${icon(s[0])}</i>${s[1]}</div><h3>${s[2]}</h3><p>${s[3]}</p></div>`).join('');
 $('chart-tooltip').hidden=true;renderChart(m);
 document.title=`TF${state.tf} · ${state.period==='30'?'30 minit':'1 jam'} | ZenCore Signal Desk`;
 const params=new URLSearchParams({tf:state.tf,period:state.period}),currentParams=new URLSearchParams(location.search);
 if(currentParams.get('embed')==='1')params.set('embed','1');
 if(currentParams.get('bridge')==='1')params.set('bridge','1');
 if(currentParams.get('layout')==='website')params.set('layout','website');
 if(['sample','paired','live'].includes(currentParams.get('view')))params.set('view',currentParams.get('view'));
 history.replaceState(null,'',`${location.pathname}?${params}${location.hash}`);
 if(typeof window!=='undefined'&&window.ZenCoreFusionDesk)window.ZenCoreFusionDesk.render();
}
function renderPosition(){
 if(window.ZenCoreVisual&&window.ZenCoreFusionDesk?.getView()==='sample'){window.ZenCoreVisual.render();return;}
 const r=reports[`${state.tf}-${state.period}`];
 document.querySelectorAll('[data-position]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.position===state.position)));
 $('position-title').textContent=r[state.position].title;$('position-text').textContent=r[state.position].text;
}

function renderForecast(){
 if(window.ZenCoreVisual&&window.ZenCoreFusionDesk?.getView()==='sample'){window.ZenCoreVisual.render();return;}
 const m=markets[state.tf],r=reports[`${state.tf}-${state.period}`],f=r.forecast;
 const failed=state.scenario==='failed',selected=failed?f.failedPath:f.mainPath,color=failed?'#df918b':'#d8b56c';
 const steps=failed?f.failedStages:f.stages;
 const end=timeFmt.format(new Date(snapshot.getTime()+Number(state.period)*60000));
 $('forecast-window').textContent=`Contoh 10:00–${end} MYT`;
 $('forecast-title').textContent=r.title;$('forecast-summary').textContent=r.summary;$('forecast-bias').textContent=f.bias;
 $('quick-map').innerHTML=[
  ['trend',failed?'RISIKO SETERUSNYA':'JANGKAAN',failed?'Boleh turun lagi':state.tf==='2'?'Cuba naik':'Naik / turun','Contoh bersyarat',failed?'red':'gold'],
  ['target','ZON BUY CONTOH',`<span>${format(m.entry[0])}–</span><span>${format(m.entry[1])}</span>`,'Tunggu harga di sini','gold'],
  [failed?'warning':'crosshair',failed?'PANTAU JIKA GAGAL':'SASARAN DEKAT',format(failed?m.levels[1].price:m.tp[0]),failed?'Bukan signal SELL':'Pantau reaksi harga',failed?'red':'green'],
  ['x','BATAL PELAN BUY',format(m.stop),`Jika candle TF${state.tf} tutup di bawah`,'red']
 ].map(q=>`<div class="quick-tile ${q[4]}"><div><i>${icon(q[0])}</i><span>${q[1]}</span></div><strong>${q[2]}</strong><small>${q[3]}</small></div>`).join('');
 $('stage-label').textContent=failed?'JIKA PELAN GAGAL · TEKAN LANGKAH':'3 LANGKAH MUDAH · TEKAN UNTUK LIHAT';
 $('forecast-stages').innerHTML=steps.map((step,i)=>`<button class="forecast-stage ${failed?'failed':''}" data-step="${i}" aria-pressed="${state.step===i}"><span>${step[0]}</span><div><strong>${step[1]}</strong><p>${step[2]}</p></div><i>${icon('arrowRight')}</i></button>`).join('');
 $('forecast-condition').textContent=f.condition;$('forecast-failure').textContent=f.failure;
 $('forecast-validity').textContent=`Contoh sehingga ${end} MYT. Batal jika syarat gagal. Semua paras dan laluan ialah rekaan.`;
 document.querySelectorAll('[data-scenario]').forEach(btn=>btn.setAttribute('aria-pressed',String(btn.dataset.scenario===state.scenario)));
 const min=Math.min(...f.mainPath,...f.failedPath)-m.atr*.9,max=Math.max(...f.mainPath,...f.failedPath)+m.atr*.9;
 const pad={l:30,r:55,t:34,b:48},w=560,h=224,pw=w-pad.l-pad.r,ph=h-pad.t-pad.b;
 const x=i=>pad.l+i*pw/3,y=price=>pad.t+(max-price)/(max-min)*ph;
 const grid=Array.from({length:4},(_,i)=>{const yy=pad.t+ph*i/3;return `<path d="M${pad.l} ${yy}H${w-pad.r}" stroke="#344039" stroke-width=".65"/>`;}).join('');
 const path=selected.map((price,i)=>`${i?'L':'M'}${x(i)},${y(price)}`).join(' ');
 const colors=failed?['#df918b','#df918b','#df918b']:['#d8b56c','#73c8c5','#83c8ac'];
 const points=selected.map((price,i)=>{
  const active=i===state.step+1,c=i?colors[i-1]:color;
  return `${active?`<circle cx="${x(i)}" cy="${y(price)}" r="13" fill="${c}" opacity=".15"/>`:''}<circle cx="${x(i)}" cy="${y(price)}" r="${active?7:4}" fill="${c}" stroke="#18221b" stroke-width="2"/><text x="${x(i)}" y="${y(price)-16}" fill="${c}" font-size="12" text-anchor="${i===0?'start':i===3?'end':'middle'}" font-family="Consolas,monospace">${format(price)}</text>${i?`<text x="${x(i)}" y="${y(price)+22}" fill="${c}" font-size="9" text-anchor="${i===3?'end':'middle'}">${failed?'AWAS ':''}${i===1?'①':i===2?'②':'③'}</text>`:''}`;
 }).join('');
 const labels=`<text x="${x(0)}" y="${h-12}" fill="#a9bbb0" font-size="10">Contoh 10:00</text><text x="${x(3)}" y="${h-12}" fill="#a9bbb0" font-size="10" text-anchor="end">Sehingga ${end} MYT</text>`;
 $('forecast-chart').innerHTML=`<title>Contoh laluan ${failed?'jika gagal':'jangkaan utama'} TF${state.tf}, ${state.period} minit selepas laporan.</title><desc>${failed?f.failure:r.summary} Langkah dipilih: ${steps[state.step][1]}.</desc>${grid}<path d="${path}" fill="none" stroke="${color}" stroke-width="3" stroke-dasharray="8 6"/>${points}${labels}`;
 $('forecast-chart').setAttribute('aria-label',`Contoh ${failed?'jika gagal':'jangkaan utama'} ${r.outlook}. Langkah ${state.step+1}: ${steps[state.step][1]}. ${failed?f.failure:r.summary}`);
}
function renderSources(){
 const review=calendarReview();
 const host=window.ZenCoreFusionDesk?.getHostSnapshot?.()||window.ZenCoreLive?.snapshot?.();
 $('sources-summary').textContent=host?'6 semakan sumber · data Analysis ZenCore TF'+host.tf:'6 semakan sumber · feed live belum masuk';
 $('source-grid').innerHTML=sourceReview.sources.map(original=>{
  const src=host&&original.name==='Harga & candle Errante'?{...original,status:'DATA SERVER',kind:'reference',detail:'Bacaan daripada sesi Analysis ZenCore. Masa data dan semakan candle ditunjukkan dalam Pine + teknikal.'}:original;
  const expired=src.name==='Federal Reserve & BLS'&&review.expired;
  return `<article class="source-card"><div class="source-card-top"><i>${icon(src.icon)}</i><span class="source-badge ${expired?'pending':src.kind}">${expired?'SEMAK SEMULA':src.status}</span></div><h3>${src.name}</h3><p>${src.use}</p><small>${src.detail}</small>${src.url?`<a href="${src.url}" target="_blank" rel="noopener noreferrer">${src.link}<i>${icon('arrowUpRight')}</i></a>`:'<span class="source-no-result">Kadar menang: belum ada</span>'}</article>`;
 }).join('');
 $('calendar-state').textContent=review.label;
 $('calendar-events').innerHTML=review.events.map(event=>`<a class="calendar-event" href="${event.url}" target="_blank" rel="noopener noreferrer"><span class="event-dot"></span><div><strong>${event.name}</strong><small>${event.detail}</small></div><div><b>${event.display}</b><small>${review.expired?'Semak jadual rasmi semula':event.state}</small></div><i>${icon('arrowUpRight')}</i></a>`).join('');
}

// Deterministic, synthetic, closed-candle data. This is never presented as a live feed.
function candlesFor(m,tf){
 const n=48,out=[];let prev=m.base;
 for(let i=0;i<n;i++){
  const t=i/(n-1),wave=Math.sin(i*.73)*.18+Math.sin(i*1.91)*.07;
  const trend=t<.78?t/.78:1-(t-.78)*.85;
  let close=m.base+m.chartSpan*(trend+wave*.30),open=prev+(Math.sin(i*3.7)*m.atr*.16);
  if(i===n-1)close=m.price;
  if(i===0)open=m.base;
  const high=Math.max(open,close)+m.atr*(.15+Math.abs(Math.sin(i*1.3))*.35);
  const low=Math.min(open,close)-m.atr*(.13+Math.abs(Math.cos(i*1.7))*.32);
  out.push({open,close,high,low,time:new Date(snapshot.getTime()-(n-1-i)*Number(tf)*60000)});prev=close;
 }
 return out;
}
function renderChart(m){
 const svg=$('price-chart'),data=candlesFor(m,state.tf),w=800,h=306,pad={l:20,r:90,t:17,b:34},pw=w-pad.l-pad.r,ph=h-pad.t-pad.b;
 const min=Math.min(...data.map(c=>c.low),...m.levels.map(l=>l.price))-m.atr*.65;
 const max=Math.max(...data.map(c=>c.high),...m.levels.map(l=>l.price))+m.atr*.65;
 const x=i=>pad.l+(i+.5)*pw/data.length,y=v=>pad.t+(max-v)/(max-min)*ph;
 const axis=Array.from({length:6},(_,i)=>{const val=min+(max-min)*i/5,yy=y(val);return `<path d="M${pad.l} ${yy}H${w-pad.r}" stroke="#2b363d" stroke-width=".7"/><text x="${w-pad.r+12}" y="${yy+3}" fill="#7f929e" font-size="9" font-family="Consolas,monospace">${format(val)}</text>`;}).join('');
 const zoneTop=y(m.entry[1]),zoneBottom=y(m.entry[0]);
 const zone=`<rect x="${pad.l}" y="${zoneTop}" width="${pw}" height="${Math.max(2,zoneBottom-zoneTop)}" fill="#d8b56c" opacity=".10"/><path d="M${pad.l} ${y(m.line)}H${w-pad.r}" stroke="#d8b56c" stroke-width=".8" stroke-dasharray="5 5" opacity=".7"/><text x="${pad.l+6}" y="${zoneBottom+12}" font-size="8" fill="#cfb777" font-family="Segoe UI,Arial,sans-serif">ZON ENTRY BERSYARAT</text>`;
 const levels=m.levels.map(l=>{const yy=y(l.price),color=l.type==='Rintangan'?'#d88c85':'#6dbdb8';return `<path d="M${pad.l} ${yy}H${w-pad.r}" stroke="${color}" stroke-width=".7" stroke-dasharray="3 6" opacity=".5"/><text x="${pad.l+5}" y="${yy-5}" fill="${color}" font-size="8" font-family="Consolas,monospace">${l.name} ${format(l.price)}</text>`;}).join('');
 const linePoints=data.map((c,i)=>`${x(i)},${y(c.close)}`).join(' ');
 const candleMarkup=data.map((c,i)=>{const color=c.close>=c.open?'#7ec9ba':'#c9807b',xx=x(i),bodyY=Math.min(y(c.open),y(c.close)),bodyH=Math.max(1.5,Math.abs(y(c.open)-y(c.close)));return `<g><path d="M${xx} ${y(c.high)}V${y(c.low)}" stroke="${color}" stroke-width="1.1"/><rect x="${xx-3.4}" y="${bodyY}" width="6.8" height="${bodyH}" fill="${color}" rx=".7"/><rect class="candle-hit" data-candle="${i}" x="${xx-pw/data.length/2}" y="${pad.t}" width="${pw/data.length}" height="${ph}" fill="transparent"/></g>`;}).join('');
 const times=[0,12,24,36,47].map(i=>`<text x="${x(i)}" y="${h-12}" fill="#7f929e" font-size="9" text-anchor="middle" font-family="Consolas,monospace">${timeFmt.format(data[i].time)}</text>`).join('');
 const currentY=y(m.price);
 const current=`<path d="M${x(47)} ${currentY}H${w-pad.r+5}" stroke="#90c9bd" stroke-width=".8" stroke-dasharray="3 3"/><circle cx="${x(47)}" cy="${currentY}" r="3" fill="#a1d7c9"/><rect x="${w-pad.r+5}" y="${currentY-10}" width="81" height="20" rx="3" fill="#294c43" stroke="#446d60"/><text x="${w-pad.r+45}" y="${currentY+3}" fill="#c2e3d7" text-anchor="middle" font-size="9" font-family="Consolas,monospace">${format(m.price)}</text>`;
 svg.innerHTML=`<title>Carta simulasi XAUUSD TF${state.tf}, 48 candle tertutup. Bukan data live.</title><desc>Harga sampel ${format(m.price)}. Entry bersyarat ${format(m.entry[0])} hingga ${format(m.entry[1])}. Sokongan dan rintangan ialah struktur TF${state.tf}.</desc><defs><linearGradient id="area-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#6dbdb8" stop-opacity=".10"/><stop offset="100%" stop-color="#6dbdb8" stop-opacity="0"/></linearGradient></defs>${axis}<path d="M${x(0)} ${y(data[0].close)}L${linePoints}L${x(47)} ${pad.t+ph}H${x(0)}Z" fill="url(#area-fill)"/>${zone}${levels}${candleMarkup}${current}${times}`;
 svg.setAttribute('aria-label',`Carta simulasi XAUUSD TF${state.tf}. Harga ${format(m.price)}, sokongan ${format(m.levels[0].price)}, rintangan ${format(m.levels[2].price)}.`);
 svg.querySelectorAll('.candle-hit').forEach(hit=>{
  const show=()=>{const c=data[Number(hit.dataset.candle)];$('chart-tooltip').innerHTML=`<strong>TF${state.tf} · ${timeFmt.format(c.time)} MYT · SAMPEL</strong>O ${format(c.open)} &nbsp; H ${format(c.high)} &nbsp; L ${format(c.low)} &nbsp; C ${format(c.close)}`;$('chart-tooltip').hidden=false;};
  hit.addEventListener('pointerenter',show);hit.addEventListener('click',show);
 });
 svg.addEventListener('pointerleave',()=>{$('chart-tooltip').hidden=true;},{once:true});
}

const dialogs={
 data:{eyebrow:'SUMBER & KETEPATAN',title:'Data sebenar belum masuk.',body:`<p><strong>Laman ini masih guna contoh.</strong> Harga, carta dan laluan bukan signal live.</p><div class="data-state"><span>Harga broker</span><strong>BELUM MASUK</strong></div><div class="data-state"><span>Versi SOP live</span><strong>BELUM DISAHKAN</strong></div><div class="data-state"><span>Ketepatan signal</span><strong>BELUM DIUKUR</strong></div><h3>Sumber yang sudah disemak</h3><ul><li>Panduan ZenCore: flow TF2 dan TF15.</li><li>Kod Errante: versi SOP dan syarat data segar.</li><li>Federal Reserve & BLS: jadual berita.</li><li>World Gold Council: konteks emas sahaja.</li></ul><p>Berita dan dokumen tidak menggantikan harga broker. Feed Errante memerlukan sesi login yang sah; ia belum disambungkan di sini.</p><p>Kod ada beberapa versi SOP. Versi yang sedang digunakan mesti disahkan daripada feed. Semakan kod sahaja tidak membuktikan signal akan tepat.</p><h3>Sebelum signal sebenar digunakan</h3><p>Sahkan harga broker, candle tutup, versi SOP, pelan asal dan spread. Selepas itu, ukur hasil signal dengan data sebenar. Tiada peratus menang direka.</p><h3>Jadual laporan</h3><p>TF2: setiap 30 minit. TF15: setiap 1 jam. Versi contoh ini tidak menjana laporan live automatik.</p>`},
 sop:{eyebrow:'FAHAM ZENCORE',title:'Tunggu. Sahkan. Baru bertindak.',body:`<h3>① Tunggu zon</h3><p>Jangan kejar harga. Tunggu harga sampai ke kawasan yang dirancang.</p><h3>② Sahkan setup</h3><p>Gunakan candle yang sudah tutup dan SOP aktif daripada feed ZenCore. SOLID sahaja belum cukup.</p><h3>③ Jaga risiko</h3><p>Semak SL, sasaran dan spread. Jika setup batal, tunggu setup baharu. Jangan masuk semula menggunakan setup yang sudah melepasi TP1.</p><h3>TF2 dan TF15 berasingan</h3><p>Jangan guna paras TF15 sebagai SL scalping TF2. Tempoh laporan juga tidak menukar timeframe candle.</p><h3>Kenapa versi SOP perlu disahkan?</h3><p>Panduan lama dan kod yang disemak mempunyai beberapa versi. Ada versi dengan pengesahan 3/4 serta syarat forecast yang berlainan. Versi sebenar hanya boleh dipadankan selepas feed aktif diterima.</p><details><summary>Butiran teknikal sumber</summary><p>Branch rujukan: clone/zencore-errante-20261020. Fail TF2/TF15 menyokong PINE_3TRIGGERS_3OF4_CHOP50_V3, PINE_3TRIGGERS_3OF4_FORECAST45_V4 dan PINE_SOLID_3OF4_FORECAST45_V5. Forecast score dalam kod bukan kadar menang. Paras SL/TP mesti diambil daripada pelan versi aktif.</p></details><h3>Exit ikut tetapan asal</h3><p>Rujukan step-lock: TP1 → SL ke entry; TP2 → SL ke TP1; TP3 → SL ke TP2. Partial close dan exit akhir ikut SOP auto yang dipasang.</p><p>Lock close 60 saat tidak menghentikan SL broker atau Emergency Close All. Laman ini tidak membuka atau menutup order.</p>`}
};
let toastTimer;
function toast(message){$('toast').textContent=message;$('toast').classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.remove('show'),3500);}
let dialogOpener;
function openDialog(key,opener){if(key==='data'){dialogs.data={eyebrow:'SUMBER DATA LIVE',title:'Data Pine/Errante sebenar.',body:'<p>Harga, candle dan pelan asal datang daripada sesi Errante yang disambungkan. Laporan visual tidak menggunakan harga sampel.</p><p>Data lama dan bahagian yang belum lengkap ditanda Tunggu. Berita, kos dan win rate belum disahkan. Tiada order dihantar.</p>'};}const d=dialogs[key];dialogOpener=opener;$('dialog-eyebrow').textContent=d.eyebrow;$('dialog-title').textContent=d.title;$('dialog-body').innerHTML=d.body;$('info-dialog').showModal();$('info-dialog').scrollTop=0;}
function closeDialog(){$('info-dialog').close();}
function reportText(){
 const m=markets[state.tf],r=reports[`${state.tf}-${state.period}`];
 return `ZENCORE · LAPORAN SAMPEL (BUKAN SIGNAL LIVE)\nXAUUSD | TF${state.tf} ${m.label} | ${r.outlook}\nSnapshot simulasi: 28 Okt 2026, 10:00 MYT\nTetingkap contoh: 10:00–${state.period==='30'?'10:30':'11:00'} MYT\n\n${r.status}: ${r.title}\n${r.summary}\n\nJANGKAAN SELEPAS LAPORAN:\n${r.forecast.stages.map(s=>`${s[0]}. ${s[1]}: ${s[2]}`).join('\n')}\n\nJANGKAAN KEKAL JIKA: ${r.forecast.condition}\nJIKA JANGKAAN GAGAL: ${r.forecast.failure}\n\nASAS JANGKAAN: ${r.context}\n\n${state.position==='flat'?'BELUM ENTRY':state.position==='buy'?'SEDANG BUY':'SEDANG SELL'}: ${r[state.position].title}\n${r[state.position].text}\n\nEntry bersyarat: ${format(m.entry[0])}–${format(m.entry[1])}\nEntry-line: ${format(m.line)} (candle close TF${state.tf})\nSL / batal setup: ${format(m.stop)}\nTP1: ${format(m.tp[0])} | TP2: ${format(m.tp[1])} | TP3: ${format(m.tp[2])}\n\nS/R LOKAL TF${state.tf}:\n${m.levels.map(l=>`${l.name} ${l.type}: ${format(l.price)} | jarak $${Math.abs(l.price-m.price).toFixed(2)} (${(Math.abs(l.price-m.price)/m.atr).toFixed(2)}× ATR)`).join('\n')}\n\nDATA DISAHKAN (${m.checks.filter(c=>c.ok).length}/5; bukan kadar ketepatan):\n${m.checks.map(c=>`${c.ok?'✓':'○'} ${c.label}: ${c.status}`).join('\n')}\n\nPELAN BERSYARAT:\n${r.scenarios.map(s=>`${s[1]} · ${s[2]}: ${s[3]}`).join('\n')}\n\nSTATUS SIGNAL SEBENAR: TUNGGU DATA. Versi SOP aktif belum disahkan. Ketepatan belum diukur.\nSumber disemak: panduan ZenCore, kod Errante, kalendar Fed/BLS dan World Gold Council. Sumber rujukan bukan feed harga broker.\n\nPanduan pendidikan menggunakan data rekaan. Feed live belum disambungkan; tiada order dihantar. Semak SOP ZenCore dan risiko broker sebelum trade sebenar.`;
}

document.querySelectorAll('[data-tf]').forEach(b=>b.addEventListener('click',()=>{state.tf=b.dataset.tf;state.period=state.tf==='2'?'30':'60';state.scenario='main';state.step=0;render();announce(`TF${state.tf} ${markets[state.tf].label}, ${state.period==='30'?'30 minit':'1 jam'}. Laporan dikemas kini.`);}));
document.querySelectorAll('[data-period]').forEach(b=>b.addEventListener('click',()=>{state.period=b.dataset.period;state.scenario='main';state.step=0;render();announce(`Horizon ${state.period==='30'?'30 minit':'1 jam'}, candle kekal TF${state.tf}.`);}));
document.querySelectorAll('[data-scenario]').forEach(b=>b.addEventListener('click',()=>{state.scenario=b.dataset.scenario;state.step=0;renderForecast();announce(state.scenario==='main'?'Skema jangkaan utama dipaparkan.':'Skema jika jangkaan gagal dipaparkan.');}));
$('forecast-stages').addEventListener('click',e=>{const button=e.target.closest('[data-step]');if(!button)return;state.step=Number(button.dataset.step);renderForecast();$('forecast-stages').querySelector(`[data-step="${state.step}"]`).focus({preventScroll:true});announce(`Langkah ${state.step+1} dipilih pada carta.`);});
document.querySelectorAll('[data-position]').forEach(b=>b.addEventListener('click',()=>{state.position=b.dataset.position;renderPosition();}));
document.querySelectorAll('[data-dialog]').forEach(b=>b.addEventListener('click',()=>openDialog(b.dataset.dialog,b)));
$('close-dialog').addEventListener('click',closeDialog);$('dialog-done').addEventListener('click',closeDialog);
$('info-dialog').addEventListener('close',()=>dialogOpener?.focus());
$('info-dialog').addEventListener('click',e=>{if(e.target===$('info-dialog')){const rect=e.target.getBoundingClientRect();if(e.clientX<rect.left||e.clientX>rect.right||e.clientY<rect.top||e.clientY>rect.bottom)closeDialog();}});
document.querySelectorAll('.nav-link').forEach(link=>link.addEventListener('click',()=>{document.querySelectorAll('.nav-link').forEach(l=>l.classList.toggle('active',l===link));}));
document.querySelector('.brand').addEventListener('click',e=>{e.preventDefault();window.scrollTo({top:0,behavior:'smooth'});});
$('copy-report').addEventListener('click',async()=>{
 const content=window.ZenCoreFusionDesk?window.ZenCoreFusionDesk.report():reportText();
 try{await navigator.clipboard.writeText(content);toast('Laporan disalin bersama label sumber data.');}
 catch{
  const blob=new Blob([content],{type:'text/plain;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download=`ZenCore-SAMPEL-TF${state.tf}-${state.period}min.txt`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('Salinan dimuat turun sebagai fail teks.');
 }
});
const announcer=document.createElement('div');announcer.setAttribute('role','status');announcer.style.cssText='position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)';document.body.append(announcer);
function announce(t){announcer.textContent=t;}
const params=new URLSearchParams(location.search);if(['2','15'].includes(params.get('tf')))state.tf=params.get('tf');state.period=state.tf==='2'?'30':'60';if(['30','60'].includes(params.get('period')))state.period=params.get('period');
icons();render();
