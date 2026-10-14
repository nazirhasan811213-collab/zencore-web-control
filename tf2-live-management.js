'use strict';
// The authenticated webhook handles identity; this guard validates freshness and
// the compact execution state before preserving intrabar management actions.
function allow(row,batch,now=Date.now()){
 const meta=row?.[66],t=batch?.emittedAt,action=row?.[49],stage=row?.[48];
 if(!Array.isArray(row)||String(batch?.timeframe)!=='2'||batch.feedChannel!=='EXECUTION'||batch.feedUpdateVersion!=='SPLIT_CHANNEL_BOOTSTRAP_V2'||batch.feedVersion!=='TF2_REALTIME_V1'||batch.schemaVersion!=='32.3-EXIT-STEPLOCK'||
 !['TF2_SOLID_80PCT_SCALP_CAP_V3','TF2_SOLID_HOLD_SCALP_CAP_V4','TF2_SOLID_HOLD_SCALP_CAP_V5'].includes(meta?.entryRuleVersion)||
 !Number.isFinite(t)||now-t< -5000||now-t>30000||!Number.isFinite(meta.setupAt)||meta.setupAt<=0||
 !['BUY','SELL'].includes(row[34])||!Number.isFinite(row[22])||row[22]<=0)return false;
 if(action==='CLOSE_50_NOW')return stage==='WAIT_YELLOW'&&row[50]===true&&row[52]===50;
 if(['EXIT_ALL','EXIT_REMAINING','EXIT_SL'].includes(action))return stage==='CLOSED'&&row[52]===0;
 return ['HOLD','WAIT_OPPOSITE_YELLOW','IDLE'].includes(action)&&Number.isFinite(row[24])&&row[24]>0&&
 row[59]===true&&['MOVE_SL_ENTRY','MOVE_SL_TP1','MOVE_SL_TP2'].includes(row[58]);
}
function block(row,batch){
 const versioned=String(batch?.timeframe)==='2'&&batch.feedUpdateVersion==='SPLIT_CHANNEL_BOOTSTRAP_V2'&&['TF2_SOLID_80PCT_SCALP_CAP_V3','TF2_SOLID_HOLD_SCALP_CAP_V4','TF2_SOLID_HOLD_SCALP_CAP_V5'].includes(row?.[66]?.entryRuleVersion);
 return versioned?!allow(row,batch):batch?.confirmed===false;
}
module.exports={allow,block};
