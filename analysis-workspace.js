(() => {
  'use strict';
  const $=id=>document.getElementById(id),pair=()=>$('pairSelector')?.value||'XAUUSD';
  const text=(id,v)=>{if($(id))$(id).textContent=v??'—';};
  const time=v=>v?new Date(v).toLocaleString('ms-MY',{hour12:false}):'Belum tersedia';
  const price=v=>v==null?'—':new Intl.NumberFormat('en-US',{maximumFractionDigits:8}).format(v);
  let requestId=0,controller=null,lastResult=null,snapshot=null;
  function renderSnapshot(s){
    snapshot=s;
    if(s.integrations){const i=s.integrations;text('aiConnections',`Feed 3M/1M: ${i.feedConfigured?'dikonfigurasi':'belum disambungkan'} · GPT: ${i.gptConfigured?'dikonfigurasi':'belum disambungkan'} · Data luar: ${i.externalConfigured?'dikonfigurasi':'belum disambungkan'}`);}
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
    lastResult=r;$('aiResults').hidden=false;text('aiStamp',`${r.symbol} • Snapshot ${time(r.generatedAt)} • TF 3M / 15 minit`);
    if(!r.zencore.dataAt&&r.liveSop){
      text('aiZTitle','Analisis SOP ZenCore semasa');text('aiZDirection',r.liveSop.side+' · '+r.liveSop.state);
      text('aiZReason',r.liveSop.reason);text('aiZData',time(r.liveSop.sourceBarTime||r.liveSop.dataAt));
      text('aiGptStatus',r.gpt.status==='AVAILABLE'?'ULASAN GPT · DATA LUARAN':'DATA SOP PINE · BUKAN V33');
      text('aiNarrative',r.gpt.status==='AVAILABLE'?r.gpt.text:'Feed V33 belum disambungkan. '+r.gpt.text+' Lihat analisis SOP semasa di bawah.');
    }else{
      text('aiZTitle','AI Analysis ZenCore');text('aiZDirection',r.zencore.side);text('aiZReason',r.zencore.reason);text('aiZData',time(r.zencore.dataAt));
      text('aiNarrative',r.gpt.text);text('aiGptStatus',r.gpt.status==='AVAILABLE'?'ULASAN GPT':'ULASAN GPT BELUM TERSEDIA');
    }
    text('aiExternalStatus',r.external.status);text('aiExternalReason',r.external.reason);text('aiExternalMethod',r.external.method||r.nativeExternal.reason);
    text('aiExternalData',time(r.external.dataAt));text('aiExternalPrice',price(r.external.currentPrice));text('aiExternalPriceAt',time(r.external.priceAt));
    const aligned=r.liveSop&&r.external.status==='AVAILABLE'&&Math.abs(r.liveSop.dataAt-r.external.dataAt)<=240000;
    const compared=aligned&&['BUY','SELL'].includes(r.liveSop.side)&&['BUY','SELL'].includes(r.external.bias);
    text('aiComparison',compared?(r.liveSop.side===r.external.bias?'ARAH SELARAS · SOP vs OHLC LUARAN':'ARAH BERBEZA · SOP vs OHLC LUARAN'):r.comparison);
    text('aiExternalSource',r.external.source);text('aiExternalBias',r.external.bias||'—');
    text('aiFreshness','Snapshot kekal. Klik Analisis Semula untuk keadaan baharu.');
  }
  $('generateAnalysis').addEventListener('click',async()=>{
    const id=++requestId,symbol=pair();controller?.abort();controller=new AbortController();
    $('generateAnalysis').disabled=true;text('generateAnalysis','SEDANG MENGANALISIS…');text('aiStatus','Membaca snapshot dan sumber yang tersedia…');
    try{const r=await fetch('/api/analysis-ai',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({symbol}),signal:controller.signal});const body=await r.json();
      if(r.ok&&!body.zencore?.dataAt)body.liveSop=await liveSop(symbol,controller.signal);
      if(id!==requestId||symbol!==pair())return;if(!r.ok)throw Error(body.error||'Analisis gagal.');renderResult(body);text('aiStatus','Analisis selesai. Semak masa data setiap sumber.');
    }catch(e){if(id===requestId&&e.name!=='AbortError')text('aiStatus',e.message||'Analisis tidak tersedia.');}
    finally{if(id===requestId){$('generateAnalysis').disabled=false;text('generateAnalysis','ANALISIS SEMULA');}}
  });
  $('pairSelector')?.addEventListener('change',()=>{requestId++;controller?.abort();lastResult=null;renderSnapshot({symbol:pair(),status:'WAIT',side:'WAIT',reason:'Membaca data pair yang dipilih…',checks:[]});$('aiResults').hidden=true;$('generateAnalysis').disabled=false;text('generateAnalysis','JANA & BANDING AI ANALYSIS');text('aiStatus','Klik untuk analisis pair yang dipilih.');refresh();});
  setInterval(()=>{if(snapshot?.dataAt&&Date.now()-snapshot.dataAt>90000){text('v33Status','DATA LEWAT');text('v33Reason','Snapshot melebihi 90 saat. Tunggu data baharu sebelum menilai entry.');}
    if(lastResult&&Date.now()-lastResult.generatedAt>180000)text('aiFreshness','Snapshot melebihi satu candle 3M. Jana semula untuk perbandingan terkini.');},1000);
  document.querySelector('.legacy-analysis')?.addEventListener('toggle',()=>window.dispatchEvent(new Event('resize')));
  refresh();setInterval(refresh,15000);
})();
