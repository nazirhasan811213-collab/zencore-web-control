'use strict';
const CANONICAL='ZenCore Multi-Pair Feed';
const ALIASES=['ZenCore Native SOP24 TF1','ZenCore Original Dashboard TF1 SOP80'];
// Compatibility for already-created alerts. Authentication is still checked by ingress.
function normalizeTf1FeedSource(batch){
 if(!batch||!ALIASES.includes(batch.source))return batch;
 if(batch.feedVersion!=='TF1_REALTIME_V1'||String(batch.timeframe)!=='1'||
    batch.schemaVersion!=='32.3-EXIT-STEPLOCK'||batch.encoding!=='zencore-compact-v1'||
    !['DASHBOARD','EXECUTION'].includes(batch.feedChannel)||!Array.isArray(batch.markets)||!batch.markets.length||
    !batch.markets.every(r=>Array.isArray(r)&&r.length===67&&r[0]==='XAUUSD'&&
      ['TF1_SOLID_80PCT_SCALP_CAP_V3','TF1_SOLID_80PCT_LIVE_V2','TF1_SOLID_80PCT_V1'].includes(r[66]?.entryRuleVersion)))return batch;
 return {...batch,source:CANONICAL};
}
module.exports={CANONICAL,ALIASES,normalizeTf1FeedSource};
