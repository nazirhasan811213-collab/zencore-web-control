'use strict';
const crypto=require('crypto');
const validTime=t=>Number.isFinite(t)&&t>0;
function idFor(e){return crypto.createHash('sha256').update(JSON.stringify([e.symbol,String(e.timeframe),e.setupKey||e.notificationKey||null])).digest('hex');}
function applyEvent(rows,e){
 if(e.telegramDuplicate||e.symbol!=='XAUUSD'||!['2','15'].includes(String(e.timeframe))||!validTime(e.time))return [];
 const tf=String(e.timeframe),id=idFor(e),changed=[];
 if(e.kind==='ENTRY'){
  const p=e.telegramPlan,sign=e.side==='BUY'?1:e.side==='SELL'?-1:0;
  if(!sign||!e.setupKey&&!e.notificationKey||!p||!['entry','sl','tp1','tp2','tp3'].every(k=>Number.isFinite(p[k])&&p[k]>0)||sign*(p.entry-p.sl)<=0||sign*(p.tp1-p.entry)<=0||sign*(p.tp2-p.tp1)<=0||sign*(p.tp3-p.tp2)<=0||rows.has(id))return [];
  for(const old of rows.values())if(old.state==='OPEN'&&old.timeframe===tf&&old.openedAt<=e.time){
   old.state='CLOSED';old.outcome='SUPERSEDED';old.resolvedAt=e.time;old.reason='Pelan diganti signal baharu; hasil exit tidak disahkan';changed.push(old);
  }
  const row={id,symbol:e.symbol,timeframe:tf,setupKey:e.setupKey||null,mode:'NORMAL',side:e.side,entryType:e.telegramSop?.cycleKind==='FOLLOWUP'?'REENTRY':e.entryType||'SOLID_ENTRY',
   state:'OPEN',outcome:'OPEN',openedAt:e.time,resolvedAt:null,lastEventAt:e.time,...p,
   hitTp1:false,hitTp2:false,hitTp3:false,score:e.telegramQuality?.score??null,slLockStage:0,
   source:'PERSISTED_ANALYSIS_EVENTS_NOT_BROKER_PL',reason:'Signal entry diterima; bukan pengesahan order MT5'};
  rows.set(id,row);changed.push(row);return changed;
 }
 let row=rows.get(id);
 if(!row&&e.kind==='CLOSE'&&!e.setupKey){const open=[...rows.values()].filter(r=>r.timeframe===tf&&r.state==='OPEN');if(open.length===1)row=open[0];}
 if(!row||row.state!=='OPEN'||e.time<row.lastEventAt)return [];
 if(e.kind==='TP_HIT'&&[1,2,3].includes(e.targetNumber)){
  const sign=row.side==='BUY'?1:-1;
  if(e.side!==row.side||!Number.isFinite(e.currentPrice)||sign*(e.currentPrice-row['tp'+e.targetNumber])<0)return [];
  for(let i=1;i<=e.targetNumber;i++)row['hitTp'+i]=true;
 }else if(e.kind==='CLOSE'&&e.percent===100){
  row.state='CLOSED';row.resolvedAt=e.time;row.outcome='CLOSE_SIGNAL';row.reason=String(e.message||'Signal close diterima').slice(0,400);
 }else if(e.kind==='CLOSE'&&e.percent===50){row.partialCloseObserved=true;}else return [];
 row.lastEventAt=e.time;changed.push(row);return changed;
}
class CurrentSignalRecords{
 constructor({pool,log=console}={}){this.pool=pool;this.log=log;this.error=null;this.lastSync=null;this.queue=Promise.resolve();}
 async init(){await this.pool.query(`CREATE TABLE IF NOT EXISTS zencore_current_signal_records(
  id CHAR(64) PRIMARY KEY,symbol TEXT NOT NULL,timeframe TEXT NOT NULL,state TEXT NOT NULL,
  opened_at BIGINT NOT NULL,resolved_at BIGINT,data JSONB NOT NULL);
  CREATE INDEX IF NOT EXISTS zencore_current_signal_records_time ON zencore_current_signal_records(opened_at DESC);
  CREATE TABLE IF NOT EXISTS zencore_signal_record_cursor(id INTEGER PRIMARY KEY,last_event_id BIGINT NOT NULL);
  INSERT INTO zencore_signal_record_cursor(id,last_event_id) VALUES(1,0) ON CONFLICT DO NOTHING;`);}
 sync(){const run=this.queue.catch(()=>{}).then(()=>this.drain());this.queue=run;return run;}
 async drain(){let imported=0;
  try{for(let batch=0;batch<10;batch++){
   const c=await this.pool.connect();let count=0;
   try{await c.query('BEGIN');await c.query("SELECT pg_advisory_xact_lock(hashtext('zencore-current-signal-records'))");
    const cursor=(await c.query('SELECT last_event_id FROM zencore_signal_record_cursor WHERE id=1')).rows[0].last_event_id;
    const events=(await c.query('SELECT id,data FROM zencore_analysis_alerts WHERE id>$1 ORDER BY id LIMIT 200',[cursor])).rows;count=events.length;
    if(count){const ids=events.map(r=>idFor(r.data));
     const saved=(await c.query("SELECT data FROM zencore_current_signal_records WHERE state='OPEN' OR id=ANY($1::text[])",[ids])).rows;
     const rows=new Map(saved.map(r=>[r.data.id,r.data])),updates=new Map();
     for(const {data:e} of events)for(const row of applyEvent(rows,e))updates.set(row.id,row);
     for(const row of updates.values())await c.query(`INSERT INTO zencore_current_signal_records(id,symbol,timeframe,state,opened_at,resolved_at,data)
      VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(id) DO UPDATE SET state=EXCLUDED.state,resolved_at=EXCLUDED.resolved_at,data=EXCLUDED.data`,[row.id,row.symbol,row.timeframe,row.state,row.openedAt,row.resolvedAt,row]);
     await c.query('UPDATE zencore_signal_record_cursor SET last_event_id=$1 WHERE id=1',[events.at(-1).id]);imported+=updates.size;
    }
    await c.query('COMMIT');
   }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
   if(count<200)break;
  }this.error=null;this.lastSync=Date.now();return imported;
  }catch(e){this.error='Rekod signal gagal diselaraskan';throw e;}
 }
 start(){if(this.timer)return;const run=()=>this.sync().then(async n=>{if(n){const stats=(await this.pool.query("SELECT COUNT(*)::int AS total,COUNT(*) FILTER(WHERE state='OPEN')::int AS open FROM zencore_current_signal_records")).rows[0];this.log.log?.('Durable TF2/TF15 records synchronized:',JSON.stringify({updated:n,...stats}));}}).catch(()=>this.log.error?.('Durable TF2/TF15 records sync unavailable'));run();this.timer=setInterval(run,15000);this.timer.unref?.();}
 stop(){clearInterval(this.timer);this.timer=null;}
 async read(){
  const records=(await this.pool.query('SELECT data FROM zencore_current_signal_records ORDER BY opened_at DESC LIMIT 500')).rows.map(r=>r.data);
  const totals=(await this.pool.query(`SELECT timeframe,COUNT(*)::int AS sample,
   COUNT(*) FILTER(WHERE state='OPEN')::int AS open,COUNT(*) FILTER(WHERE state='CLOSED')::int AS resolved,
   COUNT(*) FILTER(WHERE data->>'hitTp1'='true')::int AS tp1,
   COUNT(*) FILTER(WHERE data->>'hitTp2'='true')::int AS tp2,
   COUNT(*) FILTER(WHERE data->>'hitTp3'='true')::int AS tp3
   FROM zencore_current_signal_records GROUP BY timeframe ORDER BY timeframe`)).rows;
  return {ok:true,source:'PERSISTED_ANALYSIS_EVENTS_NOT_BROKER_PL',records,totals,lastSync:this.lastSync,lastError:this.error,syncPending:this.lastSync===null,
   note:'TP ialah harga sasaran yang diperhatikan. CLOSE_SIGNAL dan SUPERSEDED tidak mengesahkan hasil untung/rugi. Sejarah dipulihkan hanya daripada event yang masih disimpan.'};
 }
}
module.exports={CurrentSignalRecords,applyEvent,idFor};
