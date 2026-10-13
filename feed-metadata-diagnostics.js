'use strict';
const RULE='TF2_3GREEN_TP1_HEMAGAP_V1';
// Bounded, account-free ingress evidence. Never retain the raw webhook body.
function createFeedMetadataDiagnostics({now=Date.now}={}){
 const channels=new Map();
 function record(batch,acceptedSymbols=[]){
  const tf=String(batch?.timeframe),channel=batch?.feedChannel;
  if(!['2','15'].includes(tf)||!['DASHBOARD','EXECUTION'].includes(channel)||
   batch?.feedVersion!==`TF${tf}_REALTIME_V1`||!Array.isArray(batch?.markets))return;
  const row=batch.markets.find(r=>Array.isArray(r)&&r[0]==='XAUUSD');
  if(!row)return;
  const meta=row[66],key=`TF${tf}_${channel}`,previous=channels.get(key);
  const revised=meta?.entryRuleVersion===RULE&&meta?.pendingEntryReturn===true;
  const observedAt=now(),emittedAt=Number(batch.emittedAt);
  const sample={receivedAt:observedAt,emittedAt:Number.isFinite(emittedAt)?emittedAt:null,
   transportLagMs:Number.isFinite(emittedAt)?observedAt-emittedAt:null,rowLength:row.length,
   rule:meta?.entryRuleVersion===RULE?RULE:null,pendingEntryReturn:meta?.pendingEntryReturn===true,
   hasEntryMetadata:!!meta&&typeof meta==='object'&&!Array.isArray(meta),
   hasLiveHema:row[65]?.version===(tf==='2'?'HEMA23_LIVE_V1':'HEMA1530_V1'),
   entryEvent:meta?.entryEvent===true,accepted:acceptedSymbols.includes('XAUUSD')};
  channels.set(key,{timeframe:tf,channel,count:(previous?.count||0)+1,
   revisedCount:(previous?.revisedCount||0)+(revised?1:0),
   unversionedCount:(previous?.unversionedCount||0)+(revised?0:1),latest:sample,
   lastRevised:revised?sample:previous?.lastRevised||null});
 }
 function snapshot(){return {version:'INGRESS_METADATA_V1',sinceProcessStart:true,channels:[...channels.values()].map(d=>({...d,latest:{...d.latest},lastRevised:d.lastRevised?{...d.lastRevised}:null}))};}
 return {record,snapshot};
}
module.exports={createFeedMetadataDiagnostics};
