(()=>{'use strict';const p=location.pathname.match(/^\/admin\/client\/([0-9a-f-]{36})$/i);if(!p)return;const id=p[1],$=x=>document.getElementById(x),root=$('adminHandover');if(!root)return;root.hidden=false;$('adminSetupLink').href='/admin/client/'+id+'/setup';let busy=false,generation=null,currentState=null;
async function api(action='',body){
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
 try{const r=await fetch('/api/admin/clients/'+id+'/'+(action||'handover'),{signal:controller.signal,credentials:'same-origin',cache:'no-store',...(body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});
 if(r.status===401||r.status===403)throw Error('Sesi admin tamat atau akses ditolak. Log masuk admin semula.');
 if(!r.headers.get('content-type')?.includes('application/json'))throw Error('Respons pelayan tidak sah. Muat semula atau log masuk admin semula.');
 const j=await r.json();if(!r.ok||j.ok===false)throw Error(j.error||'Permintaan gagal. Cuba semula.');return j;
 }catch(e){if(e.name==='AbortError')throw Error('Pelayan lambat memberi respons. Semak status serahan sebelum cuba semula.');throw e;}finally{clearTimeout(timer);}
}
function render(j){generation=j.generation;currentState=j.state;
 $('adminHandoverState').textContent=({ADMIN_SETUP:'ADMIN SETUP',USER_PROFILE:'MENUNGGU PROFIL USER',LIVE:'LIVE'})[j.state]||j.state;
 $('adminHandoverInfo').textContent=j.state==='ADMIN_SETUP'?'Sambung MT5 dan simpan lot, layer serta pair. Auto Trade kekal STOP sebelum serahan.':j.state==='USER_PROFILE'?'Serahan sudah dibuka. User perlu log masuk, lengkapkan profil dan tukar password.':'Serahan selesai. Akaun sudah LIVE.';
 $('releaseClient').disabled=busy||j.state!=='ADMIN_SETUP';$('releaseClient').textContent=busy?'Memproses…':j.state==='USER_PROFILE'?'Serahan Sudah Dibuka':j.state==='LIVE'?'Akaun Sudah Live':'Buka Serahan User';$('adminSetupLink').hidden=j.state!=='ADMIN_SETUP';
 if(j.state!=='ADMIN_SETUP')$('releaseConfirmation').hidden=true;
}
async function load(){const j=await api();render(j);try{const saved=JSON.parse(sessionStorage.getItem('zc-master-reset:'+id)||'null');if(saved&&saved.generation===generation&&Date.now()-saved.at<300000&&!$('adminHandoverMessage').textContent)$('adminHandoverMessage').textContent=saved.message;}catch{}}
$('releaseClient').disabled=true;
$('releaseClient').onclick=()=>{if(busy||currentState!=='ADMIN_SETUP')return;$('releaseConfirmation').hidden=false;$('confirmReleaseClient').focus();};
$('cancelReleaseClient').onclick=()=>{$('releaseConfirmation').hidden=true;$('releaseClient').focus();};
$('confirmReleaseClient').onclick=async()=>{
 if(busy||currentState!=='ADMIN_SETUP')return;busy=true;$('releaseClient').disabled=true;$('confirmReleaseClient').disabled=true;$('cancelReleaseClient').disabled=true;$('adminHandoverMessage').textContent='Sedang menyemak sambungan dan tetapan untuk serahan…';
 try{const j=await api('handover/release',{});render(j);$('releaseConfirmation').hidden=true;$('adminHandoverMessage').textContent='Serahan dibuka. User wajib lengkapkan profil dan tukar password.';}
 catch(e){$('adminHandoverMessage').textContent=e.message;}
 finally{busy=false;$('confirmReleaseClient').disabled=false;$('cancelReleaseClient').disabled=false;if(currentState)render({state:currentState,generation});}
};
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
