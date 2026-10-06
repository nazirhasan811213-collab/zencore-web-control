(() => {
  'use strict';
  const existing = document.querySelector('.mg-sidebar');
  const path = location.pathname;
  const links = [['/app','Dashboard','◈'],['/analysis','Analisis','⌁'],['/results','Rekod','▤'],['/analysis#alerts','Signal','◉'],['/auto-trade','Auto Trade','↯'],['/account','Akaun','○']];
  function makeLink(href,label,icon) {
    const a=document.createElement('a'); a.href=href;
    const mark=document.createElement('span');mark.textContent=icon;mark.setAttribute('aria-hidden','true');
    a.append(mark,document.createTextNode(label));
    const active=href==='/analysis#alerts'?path==='/analysis'&&location.hash==='#alerts':path===href&&!(href==='/analysis'&&location.hash==='#alerts');
    if(active)a.setAttribute('aria-current','page');
    return a;
  }
  if(existing){
    const nav=existing.querySelector('nav');
    if(nav&&!nav.querySelector('a[href="/app"]'))nav.prepend(makeLink('/app','Dashboard','◈'));
    if(nav&&!nav.querySelector('a[href="/analysis#alerts"]'))nav.append(makeLink('/analysis#alerts','Signal','◉'));
  } else {
    document.body.classList.add('zc-workspace');
    const aside=document.createElement('aside');aside.className='zc-workspace-nav';aside.id='zcWorkspaceNav';
    const brand=document.createElement('a');brand.className='zc-workspace-brand';brand.href='/app';brand.innerHTML='<b><span class="zc-logo" aria-hidden="true"><i class="zc-logo-ring ring-a"></i><i class="zc-logo-ring ring-b"></i><i class="zc-logo-ring ring-c"></i><i class="zc-logo-shield"></i><i class="zc-logo-z"></i><i class="zc-logo-flare"></i></span><span>ZenCore</span></b><small>XAUUSD · TF2 / TF15</small>';
    const nav=document.createElement('nav');nav.setAttribute('aria-label','Navigasi utama');links.forEach(l=>nav.append(makeLink(...l)));
    const note=document.createElement('p');note.className='zc-workspace-note';note.textContent='Baca setup. Ikut SOP. Jaga risiko.';
    aside.append(brand,nav,note);document.body.prepend(aside);
    const menu=document.createElement('button');menu.type='button';menu.className='zc-menu-toggle';menu.textContent='☰ Menu ZenCore';menu.setAttribute('aria-controls',aside.id);menu.setAttribute('aria-expanded','false');
    function close(){document.body.classList.remove('zc-menu-open');menu.setAttribute('aria-expanded','false');}
    menu.onclick=()=>{const open=document.body.classList.toggle('zc-menu-open');menu.setAttribute('aria-expanded',String(open));};
    document.body.prepend(menu);nav.addEventListener('click',close);document.addEventListener('keydown',e=>{if(e.key==='Escape'){close();menu.focus();}});
    fetch('/auth/me',{credentials:'same-origin',headers:{Accept:'application/json'}}).then(r=>r.ok?r.json():null).then(data=>{
      const role=data?.user?.role;
      if(role==='admin'||role==='ib'){const account=nav.querySelector('a[href="/account"]');account?.replaceWith(makeLink(role==='admin'?'/admin':'/ib',role==='admin'?'Panel Admin':'IB Dashboard','◇'));}
    }).catch(()=>{});
  }
  function openAlerts(){document.querySelectorAll('.zc-workspace-nav a').forEach(a=>{const u=new URL(a.href);if(u.pathname===path&&((u.hash==='#alerts')===(location.hash==='#alerts')))a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');});if(location.hash!=='#alerts')return;const panel=document.getElementById('alerts');if(panel){panel.open=true;panel.scrollIntoView({block:'start'});panel.querySelector('summary')?.focus();}}
  window.addEventListener('hashchange',openAlerts);openAlerts();
  // Views only: keep the result engine, filters and live updates intact.
  const overview=document.querySelector('.results-overview');
  if(overview){
    const groups={active:[document.querySelector('.open-panel')],history:[document.querySelector('.result-controls'),document.querySelector('.history-panel')],performance:[document.querySelector('.pair-panel')]};
    const tabs=document.createElement('div');tabs.className='zc-result-tabs';tabs.setAttribute('role','group');tabs.setAttribute('aria-label','Paparan rekod');
    const buttons=[];
    function select(key){Object.entries(groups).forEach(([k,els])=>els.forEach(el=>{if(el)el.hidden=k!==key;}));overview.hidden=key==='history';buttons.forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.view===key)));}
    for(const [key,label] of [['active','Signal Aktif'],['history','History Signal'],['performance','Rekod Pair']]){const b=document.createElement('button');b.type='button';b.textContent=label;b.dataset.view=key;b.onclick=()=>select(key);buttons.push(b);tabs.append(b);}
    overview.before(tabs);select('active');
  }
})();
