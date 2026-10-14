'use strict';
const CANONICAL='ZenCore Multi-Pair Feed';
const ALIASES=['ZenCore Native SOP24 TF2','ZenCore Original Dashboard TF2 SOP80'];
// Compatibility for already-created alerts. Authentication is still checked by ingress.
function normalizeTf2FeedSource(batch){
 if(!batch||!ALIASES.includes(batch.source))return batch;
 if(batch.feedVersion!=='TF2_REALTIME_V1'||String(batch.timeframe)!=='2'||
    batch.schemaVersion!=='32.3-EXIT-STEPLOCK'||batch.encoding!=='zencore-compact-v1'||
    !['DASHBOARD','EXECUTION'].includes(batch.feedChannel)||!Array.isArray(batch.markets)||!batch.markets.length||
    !batch.markets.every(r=>Array.isArray(r)&&r.length===67&&r[0]==='XAUUSD'&&
      ['TF2_SOLID_80PCT_LIVE_V2','TF2_SOLID_80PCT_V1'].includes(r[66]?.entryRuleVersion)))return batch;
 return {...batch,source:CANONICAL};
}
module.exports={CANONICAL,ALIASES,normalizeTf2FeedSource};
