(() => {
  'use strict';
  let prefs={popup:true,sound:true,telegramEnabled:false,telegramId:'',verified:false}, cursor=null, user='', audio, stopped=false;
  const root=document.createElement('details');root.className='alert-settings';root.open=true;
  root.innerHTML=`<summary>ALERT ANALYSIS · ENTRY & CLOSE</summary>
    <p>Alert semua pair ZenCore untuk signal entry dan close posisi. Popup diterima semasa halaman Analysis dibuka. Telegram boleh diterima walaupun halaman ditutup.</p>
    <div class="alert-controls"><label><input id="zaPopup" type="checkbox" checked> Popup</label><label><input id="zaSound" type="checkbox" checked> Bunyi</label><button id="zaTest" type="button">Aktifkan / uji bunyi</button></div>
    <p id="zaAudio">Klik halaman atau butang uji untuk membenarkan bunyi dalam browser.</p>
    <div class="alert-telegram"><label>Telegram ID <input id="zaId" type="text" inputmode="numeric" placeholder="Contoh: 123456789" maxlength="16"></label>
    <p id="zaTelegramHelp">Masukkan ID nombor akaun Telegram anda, bukan @username. Tekan Start pada bot sebelum meminta kod.</p>
    <a id="zaBot" target="_blank" rel="noopener" hidden>Buka bot ZenCore</a><button id="zaCode" type="button">Hantar kod pengesahan</button>
    <label>Kod <input id="zaVerifyCode" type="text" inputmode="numeric" maxlength="6" autocomplete="one-time-code" placeholder="6 digit"></label><button id="zaVerify" type="button">Sahkan ID</button>
    <label><input id="zaTelegram" type="checkbox"> Hantar alert ke Telegram</label></div>
    <button id="zaSave" type="button">Simpan tetapan</button><p id="zaStatus" class="alert-status" role="status">Memuatkan tetapan…</p>
    <p id="zaConnection" role="status"></p><details><summary>Alert terkini</summary><div id="zaHistory" class="alert-history">Belum ada signal baharu.</div></details>`;
  const app=document.querySelector('.app');if(!app)return;app.querySelector('header')?.insertAdjacentElement('afterend',root);
  const q=id=>document.getElementById(id),status=t=>{q('zaStatus').textContent=t;};
  const host=document.createElement('div');host.className='alert-toasts';host.setAttribute('aria-live','polite');document.body.append(host);
  async function api(path,body){const r=await fetch('/api/analysis-alerts/'+path,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined,cache:'no-store'});if(r.status===401){stopped=true;throw Error('Sesi tamat. Log masuk semula untuk menerima alert.');}const j=await r.json();if(!r.ok||!j.ok)throw Error(j.error||'Alert tidak tersedia.');return j;}
  function fill(){q('zaPopup').checked=prefs.popup;q('zaSound').checked=prefs.sound;q('zaId').value=prefs.telegramId;q('zaTelegram').checked=prefs.telegramEnabled;q('zaTelegram').disabled=!prefs.verified||!prefs.telegramAvailable;q('zaCode').disabled=!prefs.telegramAvailable;q('zaVerify').disabled=!prefs.telegramAvailable;
    if(prefs.botName){q('zaBot').hidden=false;q('zaBot').href='https://t.me/'+prefs.botName;}else q('zaBot').hidden=true;
    if(!prefs.telegramAvailable)q('zaTelegramHelp').textContent='Telegram belum tersedia. Pentadbir perlu mengaktifkan bot ZenCore. Popup dan bunyi boleh digunakan.';
  }
  async function sound(test=false){if(!test&&!prefs.sound)return;try{audio ||= new (window.AudioContext||window.webkitAudioContext)();await audio.resume();if(audio.state!=='running')return;const o=audio.createOscillator(),g=audio.createGain();o.connect(g);g.connect(audio.destination);o.frequency.value=test?660:880;g.gain.setValueAtTime(.12,audio.currentTime);g.gain.exponentialRampToValueAtTime(.001,audio.currentTime+.45);o.start();o.stop(audio.currentTime+.45);q('zaAudio').textContent='Bunyi sedia pada browser ini.';}catch{q('zaAudio').textContent='Bunyi disekat browser. Klik Aktifkan / uji bunyi.';}}
  document.addEventListener('pointerdown',()=>{try{audio ||= new (window.AudioContext||window.webkitAudioContext)();audio.resume().then(()=>{if(audio.state==='running')q('zaAudio').textContent='Bunyi sedia pada browser ini.';});}catch{}},{once:true});
  q('zaTest').onclick=()=>sound(true);
  async function save(){const j=await api('settings',{popup:q('zaPopup').checked,sound:q('zaSound').checked,telegramEnabled:q('zaTelegram').checked,telegramId:q('zaId').value});prefs=j.settings;fill();status('Tetapan disimpan.');}
  q('zaId').oninput=()=>{if(q('zaId').value.trim()!==prefs.telegramId){q('zaTelegram').checked=false;q('zaTelegram').disabled=true;}};
  function action(id,fn){q(id).onclick=async()=>{q(id).disabled=true;try{await fn();}catch(e){status(e.message);}finally{q(id).disabled=false;}};}
  action('zaSave',save);
  action('zaCode',async()=>{await save();await api('telegram/code',{});status('Kod dihantar ke Telegram. Masukkan kod untuk mengesahkan ID.');});
  action('zaVerify',async()=>{prefs=(await api('telegram/verify',{code:q('zaVerifyCode').value})).settings;fill();status('ID disahkan. Pilih Hantar alert ke Telegram dan simpan.');});
  const history=[];
  function show(e){history.unshift(e);history.splice(30);q('zaHistory').replaceChildren(...history.map(x=>{const a=document.createElement('article');a.textContent=new Date(x.time).toLocaleString()+'\n'+x.message;return a;}));
    if(prefs.popup){const el=document.createElement('article');el.className='alert-toast '+(e.kind==='CLOSE'?'close':'');const b=document.createElement('button');b.textContent='×';b.setAttribute('aria-label','Tutup alert');b.onclick=()=>el.remove();const title=document.createElement('strong');title.textContent=e.kind==='ENTRY'?'SIGNAL ENTRY':'SIGNAL CLOSE';const p=document.createElement('p');p.textContent=e.message;const small=document.createElement('small');small.textContent=new Date(e.time).toLocaleTimeString()+' · Signal Analysis';el.append(b,title,p,small);host.append(el);while(host.children.length>4)host.firstChild.remove();setTimeout(()=>el.remove(),20000);}sound();
  }
  try{for(const k of Object.keys(localStorage)){if(k.startsWith('zc-alert-seen:')&&Date.now()-Number(localStorage.getItem(k))>86400000)localStorage.removeItem(k);}}catch{}
  async function poll(){if(stopped)return;try{const data=await api('events'+(cursor===null?'':'?after='+encodeURIComponent(cursor)));for(const e of data.events){if(Date.now()-e.time<180000){const notify=()=>{const key='zc-alert-seen:'+user+':'+e.id;let seen=false;try{seen=!!localStorage.getItem(key);localStorage.setItem(key,String(Date.now()));}catch{}if(!seen)show(e);};if(navigator.locks)await navigator.locks.request('zencore-alert:'+user,notify);else notify();}}cursor=data.cursor;q('zaConnection').textContent='Alert aktif · signal baharu akan dipaparkan di sini.';}catch(e){q('zaConnection').textContent=e.message;}finally{if(!stopped)setTimeout(poll,2500);}}
  api('settings').then(j=>{prefs=j.settings;user=j.userId;fill();if(j.readOnly){root.querySelectorAll('input,button').forEach(x=>x.disabled=true);q('zaTest').disabled=false;}poll();}).catch(e=>status(e.message));
})();
