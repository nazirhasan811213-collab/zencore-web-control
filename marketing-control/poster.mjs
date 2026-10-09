const esc=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
export function renderPoster({headline='ZENCORE OFFICIAL LAUNCH',subtitle='BIAR ZENCORE TRADE UNTUK ANDA',date='19 OKTOBER 2026'}={}){
 const a=esc(String(headline).slice(0,48)),b=esc(String(subtitle).slice(0,62)),c=esc(String(date).slice(0,42));
 return '<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350" viewBox="0 0 1080 1350">'
 +'<defs><linearGradient id="b" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#071020"/><stop offset="1" stop-color="#164779"/></linearGradient></defs>'
 +'<rect width="1080" height="1350" fill="url(#b)"/>'
 +'<circle cx="830" cy="250" r="300" fill="#178aff" opacity=".18"/>'
 +'<rect x="65" y="70" width="950" height="1210" rx="30" fill="none" stroke="#44baff" stroke-width="3"/>'
 +'<text x="105" y="170" font-family="Arial" font-size="50" font-weight="bold" letter-spacing="8" fill="#79e5ff">ZENCORE</text>'
 +'<path d="M105 215H970" stroke="#39c7ff" stroke-width="4"/>'
 +'<text x="105" y="450" font-family="Arial" font-size="55" font-weight="bold" fill="#fff">'+a+'</text>'
 +'<text x="105" y="550" font-family="Arial" font-size="32" fill="#c5e6ff">'+b+'</text>'
 +'<rect x="105" y="665" width="870" height="310" rx="28" fill="#0b243d" stroke="#2c719a"/>'
 +'<path d="M135 890L230 815L340 852L460 720L550 770L700 705L810 760L935 688" fill="none" stroke="#4ef3ff" stroke-width="9"/>'
 +'<text x="105" y="1100" font-family="Arial" font-size="47" font-weight="bold" fill="#7ae5ff">'+c+'</text>'
 +'<text x="105" y="1200" font-family="Arial" font-size="23" fill="#c5d5e2">Trading involves risk of financial loss.</text>'
 +'</svg>';
}
