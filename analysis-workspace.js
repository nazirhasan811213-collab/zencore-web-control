(() => {
  'use strict';
  const $=id=>document.getElementById(id),pair=()=>$('pairSelector')?.value||'XAUUSD';
  const text=(id,v)=>{if($(id))$(id).textContent=v??'—';};
  const time=v=>v?new Date(v).toLocaleString('ms-MY',{hour12:false}):'Belum tersedia';
  const price=v=>v==null?'—':new Intl.NumberFormat('en-US',{maximumFractionDigits:8}).format(v);
  let requestId=0,controller=null,lastResult=null,snapshot=null;
  function renderSnapshot(s){
    snapshot=s;
    if(s.integrations){const i=s.integrations;text('aiConnections',`Pine SOP 3M: dibaca daripada feed semasa · V33: ${i.feedConfigured?'aktif':'pratonton belum aktif'} · GPT: ${i.gptConfigured?'aktif':'pilihan'} · Data luar: ${i.externalConfigured?'aktif':'pilihan'}`);}
    text('v33Pair',s.symbol);text('v33Status',s.status.replaceAll('_',' '));text('v33Reason',s.reason);
    text('v33Direction',s.side);text('v33Quality',s.entryQuality==null?'—':s.entryQuality+'/100');
    text('v33Forecast',s.forecast||'—');text('v33Data',time(s.dataAt));
    const p=s.position?.status==='ACTIVE'?s.position.plan:s.plan;
    for(const k of ['entry','sl','tp1','tp2','tp3'])text('v33'+k,price(p?.[k]));
    text('v33PlanState',p?(s.position?.status==='ACTIVE'?'PLAN DIREKOD • SIMULASI':'CALON PLAN'):'MENUNGGU SETUP');
    text('v33Target',p?`Sasaran utama: ${p.primaryTarget} • horizon 15 minit • R:R ${p.rr.join(' / ')}`:'Paras muncul apabila data dan semua syarat lengkap.');
    const list=$('v33Checks');list.replaceChildren();
    for(const c of s.checks||[]){const li=document.createElement('li');li.textContent=(c.pass?'✓ ':'○ ')+c.label;li.className=c.pass?'pass':'pending';list.append(li);}
    text('v33Position',s.position?`${s.position.status} • TP dicapai: ${s.position.targetStage}/3 • Tamat penilaian: ${time(s.position.expiresAt)}`:'Satu setup, satu rekod entry. Signal calon ini belum dihantar ke Telegram atau MT5.');
  }
  async function refresh(){const symbol=pair();try{const r=await fetch('/api/analysis-v33?symbol='+encodeURIComponent(symbol),{cache:'no-store'});if(r.ok&&symbol===pair())renderSnapshot(await r.json());}catch{ text('v33Reason','Tidak dapat membaca feed calon.');}}
  async function liveSop(symbol,signal){
    try{
      const response=await fetch('/api/prediction/'+encodeURIComponent(symbol),{cache:'no-store',signal});
      if(!response.ok)return null;
      const data=await response.json(),at=typeof data.receivedAt==='number'?data.receivedAt:Date.parse(data.receivedAt);
      if(data.symbol!==symbol||data.freshness!=='LIVE'||!Number.isFinite(at)||at>Date.now()+5000)return null;
      const sop=data.strategyNormal;
      if(!sop||!['BUY','SELL','WAIT'].includes(sop.side))return null;
      return {side:sop.side,state:sop.state||'WAIT',reason:sop.reason||'Semak aturan SOP pada panel di bawah.',dataAt:at,sourceBarTime:data.sourceBarTime};
    }catch{return null;}
  }
  function renderResult(r){
    const pine=r.pineScalp||{};
    text('aiPineAction',pine.action||'TUNGGU FEED PINE 3M');
    text('aiPineSide',pine.side||'WAIT');text('aiPineReason',pine.reason||'Menunggu SOP 3M yang segar.');
    text('aiPineClose',price(pine.close3m));
    text('aiPineEntry',pine.levels?`${price(pine.levels.entry)} / ${price(pine.levels.sl)}`:'Tiada pelan entry baharu');
    text('aiPineTargets',pine.levels?`${price(pine.levels.tp1)} / ${price(pine.levels.tp2)} / ${price(pine.levels.tp3)}`:'—');
    text('aiPineTime',pine.dataAt?`Candle Pine: ${time(pine.sourceBarTime||pine.dataAt)} · Snapshot feed: ${time(pine.dataAt)}`:'Tiada feed Pine segar.');
    text('aiPineCaution',pine.conflicting?.length?`Semak percanggahan: ${pine.conflicting.join(', ')}. Skor penapis bukan peluang menang.`:pine.note||'');
    const overview=$('aiPineOverview');overview.replaceChildren();
    for(const item of pine.overview||[]){const box=document.createElement('div'),label=document.createElement('span'),value=document.createElement('b'),detail=document.createElement('small');
      label.textContent=item.label;value.textContent=item.value;detail.textContent=item.detail;box.append(label,value,detail);overview.append(box);}
    const summary=$('aiPineSummary');summary.replaceChildren();
    for(const line of pine.summary||[]){const p=document.createElement('p');p.textContent=line;summary.append(p);}
    const d=pine.dashboard||{};
    text('aiPineContext',[
      d.dxy?'DXY: '+d.dxy:null,d.whales?'Whales: '+d.whales:null,
      d.supplyDemand?'S&D: '+d.supplyDemand:null,d.risk?'Risiko: '+d.risk:null,
      d.tip?'Tip Pine: '+d.tip:null
    ].filter(Boolean).join(' · ')||'Medan dashboard tambahan muncul selepas webhook Pine dikemas kini.');
    const checks=$('aiPineChecks');checks.replaceChildren();
    for(const item of pine.checks||[]){const row=document.createElement('div');row.className='pine-check '+String(item.state||'INFO').toLowerCase();
      const label=document.createElement('span'),value=document.createElement('b');label.textContent=item.label;value.textContent=item.value;row.append(label,value);checks.append(row);}

    lastResult=r;$('aiResults').hidden=false;text('aiStamp',`${r.symbol} • Snapshot ${time(r.generatedAt)} • TF 3M / 15 minit`);
    if(!r.zencore.dataAt&&r.liveSop){
      text('aiZTitle','Analisis SOP ZenCore semasa');text('aiZDirection',r.liveSop.side+' · '+r.liveSop.state);
      text('aiZReason',r.liveSop.reason);text('aiZData',time(r.liveSop.sourceBarTime||r.liveSop.dataAt));
      text('aiGptStatus',r.gpt.status==='AVAILABLE'?(r.sopInModel?'ULASAN GPT · SOP SEMASA':'ULASAN GPT · DATA LUARAN'):'DATA SOP PINE · BUKAN V33');
      text('aiNarrative',r.gpt.status==='AVAILABLE'?r.gpt.text:'Ulasan GPT pilihan belum tersedia. Ringkasan Pine 3M di atas tetap menggunakan indikator dan SOP semasa.');
    }else{
      text('aiZTitle','AI Analysis ZenCore');text('aiZDirection',r.zencore.side);text('aiZReason',r.zencore.reason);text('aiZData',time(r.zencore.dataAt));
      text('aiNarrative',r.gpt.text);text('aiGptStatus',r.gpt.status==='AVAILABLE'?'ULASAN GPT':'ULASAN GPT BELUM TERSEDIA');
    }
    text('aiExternalStatus',r.external.status);text('aiExternalReason',r.external.reason);text('aiExternalMethod',r.external.method||r.nativeExternal.reason);
    text('aiExternalData',time(r.external.dataAt));text('aiExternalPrice',price(r.external.currentPrice));text('aiExternalPriceAt',time(r.external.priceAt));
    text('aiComparison',r.external.status==='NOT_CONFIGURED'?(pine.status==='AVAILABLE'?'PINE 3M TERSEDIA · SEMAKAN LUARAN PILIHAN':'TUNGGU FEED PINE 3M'):r.comparison);
    text('aiExternalSource',r.external.source);text('aiExternalBias',r.external.bias||'—');
    const s=r.scenario||{};
    const pineRange=s.status==='WAIT_DATA'&&pine.status==='AVAILABLE'&&pine.close3m!=null&&pine.atr3m>0;
    text('aiScenarioStatus',pineRange?'JULAT ATR PINE':String(s.status||'WAIT_DATA').replaceAll('_',' '));
    text('aiScenarioReason',pineRange?'Rujukan volatiliti daripada close dan ATR Pine 3M. Bukan harga tick semasa atau cadangan entry.':s.reason||'Menunggu data lengkap.');
    text('aiScenarioRefLabel',pineRange?'CLOSE PINE 3M':'CLOSE LUARAN 1M');
    text('aiScenarioPrice',price(pineRange?pine.close3m:s.price));
    text('aiScenario3m',pineRange?`${price(pine.close3m-pine.atr3m*.5)} – ${price(pine.close3m+pine.atr3m*.5)}`:s.next3m?`${price(s.next3m.low)} – ${price(s.next3m.high)}`:'—');
    text('aiScenario15m',pineRange?`${price(pine.close3m-pine.atr3m*1.5)} – ${price(pine.close3m+pine.atr3m*1.5)}`:s.next15m?`${price(s.next15m.low)} – ${price(s.next15m.high)}`:'—');
    text('aiScenarioNote',pineRange?'ATR Pine 3M × 0.5 dan × 1.5 ialah anggaran julat dua arah; tidak menunjukkan sasaran atau peluang harga sampai.':s.note||'Julat ialah rujukan volatiliti, bukan ramalan tepat atau arahan entry.');
    const v=r.verdict||{};
    const pineOnly=pine.status==='AVAILABLE'&&r.external.status!=='AVAILABLE';
    text('aiVerdictLabel',pineOnly?(pine.state==='READY'?'SOP READY · BERSYARAT':'TUNGGU TRIGGER SOP'):v.label||'DATA BELUM CUKUP');text('aiVerdictProfit',pineOnly?'POTENSI BELUM DISAHKAN':v.profitView||'BELUM DAPAT DINILAI');
    text('aiEntryNow',pineOnly?(pine.state==='READY'?'SEMAK HARGA & SPREAD BROKER':'TUNGGU SETUP 3M'):v.entryNow||'TUNGGU DATA');
    text('aiEntryDistance',s.distanceFromEntry==null?'Jarak harga daripada entry: —':`Jarak searah daripada entry: ${price(s.distanceFromEntry)} · Zon rujukan ±${price(s.entryZone)} · Close 1M, bukan tick broker`);
    text('aiVerdictReason',pineOnly?pine.reason:v.reason||'Menunggu data semasa.');
    text('aiVerdictScore',v.score==null?'—':`${v.score}/100 · ${v.grade||'—'}`);
    text('aiVerdictStability',v.stability==null||v.readiness==null?'—':`${v.stability}/100 · ${v.readiness}/100`);
    text('aiVerdictRr',v.rrTp1==null?'—':`${v.rrTp1}R`);text('aiVerdictNote',v.note||'Skor bukan peluang menang.');
    renderTargetMap(r.targetMap);
    text('aiFreshness','Snapshot kekal. Klik Analisis Semula untuk keadaan baharu.');
  }
  function renderTargetMap(map){
    map=map||{};$('aiTargetMap').hidden=!Array.isArray(map.targets)||!map.targets.length;
    if(!$('aiTargetMap').hidden){
      text('aiTargetSide',map.side);text('aiTargetReason',map.reason);
      text('aiTargetEntry',price(map.entry));text('aiTargetRisk',`${map.riskDistance} ${map.unit} · SL ${price(map.sl)}`);
      text('aiTargetRoom',map.room15m==null?'Input Pine belum lengkap':`${map.room15m} ${map.unit} · ${map.indicator.support}/${map.indicator.total} penapis`);
      text('aiTargetNote',map.note);
      const rows=$('aiTargetRows');rows.replaceChildren();
      for(const target of map.targets){
        const tr=document.createElement('tr');
        const cells=[target.name,price(target.price),`${target.distance} ${target.unit} · ${target.rr}R`,
          `${target.reach}${target.remaining==null?'':` · baki ${target.remaining} ${target.unit}`}`,
          map.indicator?.forecast?`${map.indicator.forecast} · ${map.indicator.power}/100`:'Input belum lengkap'];
        cells.forEach((value,index)=>{const td=document.createElement('td');td.textContent=value;
          if(index===3)td.className='reach '+(target.reach.startsWith('TERHALANG')||target.reach.startsWith('DI LUAR')?'far':target.reach==='PARAS TELAH DILEPASI'?'passed':'');tr.append(td);});
        rows.append(tr);
      }
    }
  }
  async function refreshTargetMap(){
    const symbol=pair(),id=requestId;
    try{const response=await fetch('/api/target-map?symbol='+encodeURIComponent(symbol),{cache:'no-store',credentials:'same-origin'});
      if(!response.ok)return;const result=await response.json();
      if(id===requestId&&symbol===pair()&&!lastResult)renderTargetMap(result.targetMap);
    }catch{}
  }
  $('generateAnalysis').addEventListener('click',async()=>{
    const id=++requestId,symbol=pair();controller?.abort();controller=new AbortController();
    $('generateAnalysis').disabled=true;text('generateAnalysis','SEDANG MENGANALISIS…');text('aiStatus','Membaca snapshot dan sumber yang tersedia…');
    try{const r=await fetch('/api/analysis-ai',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({symbol}),signal:controller.signal});const body=await r.json();
      if(r.ok&&!body.zencore?.dataAt&&!body.liveSop)body.liveSop=await liveSop(symbol,controller.signal);
      if(id!==requestId||symbol!==pair())return;if(!r.ok)throw Error(body.error||'Analisis gagal.');renderResult(body);text('aiStatus','Analisis selesai. Semak masa data setiap sumber.');
    }catch(e){if(id===requestId&&e.name!=='AbortError')text('aiStatus',e.message||'Analisis tidak tersedia.');}
    finally{if(id===requestId){$('generateAnalysis').disabled=false;text('generateAnalysis','ANALISIS SEMULA');}}
  });
  $('pairSelector')?.addEventListener('change',()=>{requestId++;controller?.abort();lastResult=null;$('aiTargetMap').hidden=true;renderSnapshot({symbol:pair(),status:'WAIT',side:'WAIT',reason:'Membaca data pair yang dipilih…',checks:[]});$('aiResults').hidden=true;$('generateAnalysis').disabled=false;text('generateAnalysis','JANA & BANDING AI ANALYSIS');text('aiStatus','Klik untuk analisis pair yang dipilih.');refresh();refreshTargetMap();});
  setInterval(()=>{if(snapshot?.dataAt&&Date.now()-snapshot.dataAt>90000){text('v33Status','DATA LEWAT');text('v33Reason','Snapshot melebihi 90 saat. Tunggu data baharu sebelum menilai entry.');}
    if(lastResult&&Date.now()-lastResult.generatedAt>180000){
      text('aiFreshness','Snapshot melebihi satu candle 3M. Jana semula untuk perbandingan terkini.');
      if(!$('aiTargetMap').hidden){text('aiTargetRoom','DATA LEWAT · JANA SEMULA');
        text('aiTargetReason','Snapshot Pine dan bacaan indikator sudah lewat. Jana semula sebelum menilai sasaran.');}
    }},1000);
  document.querySelector('.legacy-analysis')?.addEventListener('toggle',()=>window.dispatchEvent(new Event('resize')));
  refresh();refreshTargetMap();setInterval(refresh,15000);setInterval(()=>{if(!lastResult)refreshTargetMap();},45000);
})();
