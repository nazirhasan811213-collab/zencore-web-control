'use strict';
// Keep one pending refresh during a slow dispatch; fetch the latest data on rerun.
function createCoalescingDispatcher(work,onError=()=>{}) {
  let running=false,pending=false;
  return async function tick() {
    pending=true;
    if(running)return;
    running=true;
    try {
      do {
        pending=false;
        try { await work(); } catch(error) { onError(error); }
      } while(pending);
    } finally { running=false; }
  };
}
module.exports={createCoalescingDispatcher};
