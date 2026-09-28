(()=>{'use strict';
  const motion=window.matchMedia('(prefers-reduced-motion: reduce)');
  const pointer=window.matchMedia('(hover: hover) and (pointer: fine)');
  if(motion.matches||!pointer.matches)return;
  const selector='.market-card, .best-setup:not(.disabled), .ws-scenario';
  let active=null,frame=0,point=null;
  const reset=()=>{if(frame)cancelAnimationFrame(frame);frame=0;point=null;
    if(active){active.removeAttribute('data-depth-active');active.style.removeProperty('--zc-rotate-x');active.style.removeProperty('--zc-rotate-y');active=null;}};
  document.addEventListener('pointermove',e=>{
    if(e.pointerType!=='mouse'&&e.pointerType!=='pen')return;
    const card=e.target.closest?.(selector);
    if(!card||!card.isConnected){reset();return;}
    if(active!==card){reset();active=card;card.setAttribute('data-depth-active','');}
    point={x:e.clientX,y:e.clientY};if(frame)return;
    frame=requestAnimationFrame(()=>{frame=0;if(!active||!point)return;const b=active.getBoundingClientRect();
      const x=Math.max(-1,Math.min(1,(point.x-b.left)/b.width*2-1));
      const y=Math.max(-1,Math.min(1,(point.y-b.top)/b.height*2-1));
      active.style.setProperty('--zc-rotate-x',`${(-y*3.5).toFixed(2)}deg`);
      active.style.setProperty('--zc-rotate-y',`${(x*3.5).toFixed(2)}deg`);
    });
  },{passive:true});
  document.addEventListener('pointerleave',reset);window.addEventListener('blur',reset);
  motion.addEventListener?.('change',e=>{if(e.matches)reset()});
})();
