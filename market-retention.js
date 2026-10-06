'use strict';
const RETENTION_MS=5*60*60*1000;
function receivedAt(d){const n=Number(d?.receivedAt??d?.received_at);return Number.isFinite(n)&&n>0?n:null;}
function retained(d,now=Date.now()){const at=receivedAt(d);return at!==null&&at>=now-RETENTION_MS;}
function recent(rows,now=Date.now()){return rows.filter(d=>retained(d,now));}
async function pruneSnapshots(pool,now=Date.now()){
 if(!pool)return 0;
 const r=await pool.query('DELETE FROM zencore_snapshots WHERE received_at < $1',[now-RETENTION_MS]);
 return r.rowCount||0;
}
module.exports={RETENTION_MS,retained,recent,pruneSnapshots};
