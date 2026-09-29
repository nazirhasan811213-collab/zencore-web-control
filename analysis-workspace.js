(() => {
  'use strict';
  const $=id=>document.getElementById(id),pair=()=>$('pairSelector')?.value||'XAUUSD';
  const set=(id,value)=>{const el=$(id);if(el)el.textContent=value??'—';};
  const price=value=>value==null?'—':new Intl.NumberFormat('en-US',{maximumFractionDigits:8}).format(value);
  const time=value=>value?new Date(value).toLocaleString('ms-MY',{timeZone:'Asia/Kuala_Lumpur',hour12:false}):'—';
  let requestId=0,controller=null,lastAt=0;
  function render(result){
    const p=result.pineScalp||{},levels=p.levels;
    $('aiResults').hidden=false;
    set('aiGuideAction',p.action||'TUNGGU DATA 3M');
    set('aiGuideSide',p.side||'WAIT');
    set('aiGuideReason',p.reason||'Data 3M belum lengkap.');
    set('aiGuideStamp',`${result.symbol} · Candle 3M ${time(p.sourceBarTime)} · Feed diterima ${time(p.dataAt)}`);
    set('aiGuideClose',price(p.close3m));
    set('aiGuideEntry',levels?price(levels.entry):'Tiada entry disahkan');
    set('aiGuideLevels',levels?[levels.sl,levels.tp1,levels.tp2,levels.tp3].map(price).join(' / '):'—');
    const sections=$('aiGuideSections');sections.replaceChildren();
    for(const section of p.sections||[]){
      const card=document.createElement('section'),heading=document.createElement('h5'),body=document.createElement('p');
      heading.textContent=section.title;body.textContent=section.body;card.append(heading,body);sections.append(card);
    }
    const modelAvailable=result.gpt?.status==='AVAILABLE'&&p.status==='AVAILABLE';
    $('aiGuideModel').hidden=!modelAvailable;
    if(modelAvailable)set('aiGuideModelText',result.gpt.text);
    set('aiCoachHeadline',p.coach?.headline||'Menunggu data market semasa.');
    const coachRows=$('aiCoachRows');coachRows.replaceChildren();
    for(const row of p.coach?.rows||[]){
      const line=document.createElement('p'),label=document.createElement('b');
      label.textContent=row.label+': ';line.append(label,document.createTextNode(row.text));coachRows.append(line);
    }
    const readings=$('aiGuideReadings');readings.replaceChildren();
    for(const row of p.readings||[]){
      const item=document.createElement('div'),label=document.createElement('span'),value=document.createElement('b');
      item.className='pine-check';label.textContent=row.label;value.textContent=row.value;item.append(label,value);readings.append(item);
    }
    set('aiGuideNote',p.note||'Analisis menggunakan data 3 minit yang disahkan.');
    $('aiResults').classList.toggle('ai-guide-ready',!!levels);
    lastAt=Date.now();
    set('aiStatus',p.status==='AVAILABLE'?'Analisis dikemas kini. Semak masa candle dan feed di atas.':'Feed 3M belum segar; keputusan entry ditangguhkan.');
  }
  async function refresh(){
    const id=++requestId,symbol=pair();controller?.abort();controller=new AbortController();
    $('generateAnalysis').disabled=true;set('generateAnalysis','MENGANALISIS…');set('aiStatus','Menyemak dashboard TradingView dan SOP 3M…');
    try{
      const response=await fetch('/api/analysis-ai',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({symbol}),signal:controller.signal});
      const result=await response.json();if(id!==requestId||symbol!==pair())return;
      if(!response.ok)throw Error(result.error||'Analisis belum tersedia.');
      render(result);
    }catch(error){if(id===requestId&&error.name!=='AbortError')set('aiStatus',error.message||'Analisis belum tersedia.');}
    finally{if(id===requestId){$('generateAnalysis').disabled=false;set('generateAnalysis','ANALISIS SEMULA');}}
  }
  $('generateAnalysis')?.addEventListener('click',refresh);
  $('pairSelector')?.addEventListener('change',()=>{$('aiResults').hidden=true;refresh();});
  setInterval(()=>{if(document.visibilityState==='visible'&&Date.now()-lastAt>=60000)refresh();},60000);
  refresh();
})();
