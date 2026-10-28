/* Same-origin Analysis module. Does not read or alter trading controls. */
(function(){
 'use strict';
 const anchor=document.querySelector('#dualViews');if(!anchor)return;
 const section=document.createElement('section');section.className='zc-signal-desk';section.setAttribute('aria-label','Laporan ZenCore');
 section.innerHTML='<div class="zc-desk-heading"><div><span>LAPORAN ZENCORE</span><h2>Apa langkah selepas ini?</h2><p>Data sebenar Pine/Errante. Pilih TF dan tempoh untuk lihat panduan.</p></div><div class="zc-desk-actions"><a href="https://zencore-signal-desk.magicpeony2.chatgpt.site" target="_blank" rel="noopener noreferrer">Buka website ↗</a><button type="button" aria-expanded="true">Tutup laporan</button></div></div><iframe title="ZenCore Signal Desk — laporan TF2 dan TF15" src="/signal-desk/?embed=1&amp;tf=2&amp;period=30&amp;view=live" referrerpolicy="same-origin"></iframe>';
 anchor.after(section);
 const frame=section.querySelector('iframe'),toggle=section.querySelector('button');
 toggle.addEventListener('click',()=>{frame.hidden=!frame.hidden;toggle.setAttribute('aria-expanded',String(!frame.hidden));toggle.textContent=frame.hidden?'Buka laporan':'Tutup laporan';});
 document.querySelector('.dual-tabs')?.addEventListener('click',event=>{
  const tf=event.target.closest('button[data-view]')?.dataset.view;
  if(['2','15'].includes(tf))frame.contentWindow?.postMessage({type:'zencore-desk-timeframe',tf},location.origin);
 });
})();
