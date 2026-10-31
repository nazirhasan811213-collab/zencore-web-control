(()=>{'use strict';const root='/demo/ib',base=root+'/view',nativeFetch=window.fetch.bind(window),realLocation=window.location;const logical=()=>realLocation.pathname.startsWith(base)?realLocation.pathname.slice(base.length):'/ib';
function destination(value){const u=new URL(value,realLocation.href);if(u.origin!==realLocation.origin)return null;if(u.pathname.startsWith(root+'/'))return u.href;if(u.pathname==='/login'||u.pathname==='/')return root;return base+u.pathname+u.search+u.hash;}
function go(v,replace=false){const dest=destination(v);if(dest)replace?realLocation.replace(dest):realLocation.assign(dest);}
window.ZenCoreDemoLocation={get pathname(){return logical()},get origin(){return realLocation.origin},get search(){return realLocation.search},get hash(){return realLocation.hash},set hash(v){realLocation.hash=v},get href(){return realLocation.origin+logical()+realLocation.search+realLocation.hash},set href(v){go(v)},replace:v=>go(v,true),assign:v=>go(v),reload:()=>realLocation.reload()};
window.EventSource=undefined;window.WebSocket=undefined;
window.fetch=(input,options={})=>{const raw=input instanceof Request?input.url:input,u=new URL(raw,realLocation.href),method=String(options.method||(input instanceof Request?input.method:'GET')).toUpperCase();
 if(u.origin!==realLocation.origin)return Promise.resolve(new Response(JSON.stringify({ok:false,error:'Pautan luar tidak digunakan dalam Mod Demo.'}),{status:403,headers:{'Content-Type':'application/json'}}));
 if(u.pathname.startsWith(root+'/'))return nativeFetch(input,options);
 if(u.pathname==='/auth/logout')return nativeFetch(root+'/logout',{...options,method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
 if(!u.pathname.startsWith('/api/')&&!u.pathname.startsWith('/auth/'))return Promise.resolve(new Response('{}',{status:403}));
 const target=root+'/presentation-api?path='+encodeURIComponent(u.pathname+u.search);return nativeFetch(target,input instanceof Request?new Request(input,{...options,method}):{...options,method});
};
function init(){const strip=document.createElement('div');strip.className='zc-demo-strip';strip.innerHTML='<b>MOD DEMO</b><span>Simulasi latihan</span><a href="/demo/ib/view/ib">Panel IB</a><a href="/demo/ib/view/telegram">Telegram</a><button type="button" id="zcDemoReset">Reset</button><button type="button" id="zcDemoLogout">Keluar</button>';document.body.prepend(strip);document.body.classList.add('zc-demo-presentation');
 strip.querySelector('#zcDemoReset').onclick=async()=>{const r=await nativeFetch(root+'/reset',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});if(r.ok)realLocation.reload();};strip.querySelector('#zcDemoLogout').onclick=async()=>{await nativeFetch(root+'/logout',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});realLocation.assign(root);};
 document.addEventListener('click',e=>{const a=e.target.closest('a');if(!a||a.hasAttribute('download'))return;const href=a.getAttribute('href');if(!href||href.startsWith('#'))return;const dest=destination(a.href);e.preventDefault();if(dest)realLocation.assign(dest);},true);
 const chartNote=document.querySelector('.dual-note');if(chartNote)chartNote.textContent='Chart dan analisis mengikut senario latihan TF2 dan TF15.';
 const nav=document.querySelector('.mg-sidebar nav,.zc-workspace-nav nav');if(nav&&!nav.querySelector('[data-demo-telegram]')){const a=document.createElement('a');a.dataset.demoTelegram='true';a.href=base+'/telegram';a.textContent='✉ Telegram';nav.append(a);}
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
