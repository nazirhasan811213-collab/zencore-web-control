(()=>{'use strict';const p=location.pathname.match(/^\/admin\/client\/([0-9a-f-]{36})$/i);if(!p)return;const id=p[1],$=x=>document.getElementById(x),root=$('adminHandover');if(!root)return;root.hidden=false;$('adminSetupLink').href='/admin/client/'+id+'/setup';let busy=false,generation=null;
async function api(action='',body){const r=await fetch('/api/admin/clients/'+id+'/'+(action||'handover'),{credentials:'same-origin',cache:'no-store',...(body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})}),j=await r.json();if(!r.ok)throw Error(j.error||'Permintaan gagal.');return j;}
async function load(){const j=await api();generation=j.generation;try{const saved=JSON.parse(sessionStorage.getItem('zc-master-reset:'+id)||'null');if(saved&&saved.generation===generation&&Date.now()-saved.at<300000)$('adminHandoverMessage').textContent=saved.message;}catch{}$('adminHandoverState').textContent=({ADMIN_SETUP:'ADMIN SETUP',USER_PROFILE:'MENUNGGU PROFIL USER',LIVE:'LIVE'})[j.state]||j.state;$('adminHandoverInfo').textContent=j.state==='ADMIN_SETUP'?'Sambung MT5 dan simpan tetapan Auto Trade dahulu. Selepas sedia, buka serahan kepada user.':j.state==='USER_PROFILE'?'User perlu melengkapkan nama, e-mel, telefon dan password baharu.':'Akaun boleh digunakan. Reset akan memerlukan setup dan serahan semula.';$('releaseClient').disabled=busy||j.state!=='ADMIN_SETUP';$('adminSetupLink').hidden=j.state!=='ADMIN_SETUP';}
$('releaseClient').onclick=async()=>{if(busy||!confirm('Sudah semak akaun MT5, server dan tetapan client? Buka serahan kepada user sekarang?'))return;busy=true;$('releaseClient').disabled=true;try{await api('handover/release',{});await load();$('adminHandoverMessage').textContent='Serahan dibuka. User wajib lengkapkan profil dan tukar password.';}catch(e){$('adminHandoverMessage').textContent=e.message;}finally{busy=false;await load().catch(()=>{});}};
$('resetClientAccount').onclick=async()=>{
 if(busy||generation===null||!confirm('MASTER RESET AKAUN: ID asal kekal, password kembali zc123. Profil, tetapan, Telegram dan rekod ZenCore dipadam. Sistem akan STOP dan reset pautan EA/Connector. SEMUA posisi akaun MT5 ini, termasuk manual/EA lain, akan DITUTUP dan semua pending order DIBATALKAN tanpa pengesahan user. Untung/rugi akan direalisasikan. Jika Connector tidak dapat dicapai atau arahan luput, pautan dan akaun sistem tetap dikosongkan WALAU POSISI BROKER BELUM DISAHKAN TUTUP. Login dan sejarah broker kekal. Teruskan?'))return;
 busy=true;$('resetClientAccount').disabled=true;$('releaseClient').disabled=true;
 let commandId=null;const resetGeneration=generation;
 try{
  for(let attempt=0;attempt<90;attempt++){
   const j=await api('master-reset',{confirmation:'RESET',closeAllAccount:true,resetPolicy:'MASTER_RESET_RELEASE_V3',allowUnconfirmedDisconnect:true,resetGeneration,...(commandId?{commandId}:{})});
   $('adminHandoverMessage').textContent=j.message;
   if(j.completed){sessionStorage.setItem('zc-master-reset:'+id,JSON.stringify({generation:j.generation,message:j.message,at:Date.now()}));await load();location.reload();return;}
   commandId=j.commandId;
   await new Promise(resolve=>setTimeout(resolve,2000));
  }
  throw Error('Masih menunggu Connector/EA. Pastikan Manager dan MT5 online, kemudian cuba Master Reset semula.');
 }catch(e){$('adminHandoverMessage').textContent=e.message;}
 finally{busy=false;$('resetClientAccount').disabled=false;await load().catch(()=>{});}
};load().catch(e=>$('adminHandoverMessage').textContent=e.message);})();
