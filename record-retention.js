'use strict';
// Record history only. Never applies to broker positions, execution commands or identity data.
const START_AT=Date.parse('2026-11-01T00:00:00+08:00'),MONTHS=2,OFFSET=8*60*60*1000;
function cutoffAt(now=Date.now()){
 if(!Number.isFinite(now))throw new TypeError('Invalid record retention clock');
 const local=new Date(now+OFFSET),month=local.getUTCMonth()-MONTHS,year=local.getUTCFullYear();
 const lastDay=new Date(Date.UTC(year,month+1,0)).getUTCDate();
 const rolling=Date.UTC(year,month,Math.min(local.getUTCDate(),lastDay),local.getUTCHours(),local.getUTCMinutes(),local.getUTCSeconds(),local.getUTCMilliseconds())-OFFSET;
 return Math.max(START_AT,rolling);
}
function metadata(now=Date.now()){return {startAt:START_AT,cutoffAt:cutoffAt(now),months:MONTHS,timeZone:'Asia/Kuala_Lumpur',basis:'ENTRY_TIME',policy:'FROM_20261101_TWO_CALENDAR_MONTHS'};}
module.exports={START_AT,MONTHS,cutoffAt,metadata};
