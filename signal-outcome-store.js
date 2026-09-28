'use strict';
const {PAIRS}=require('./analysis-v33');
const numeric=v=>v===null||v===undefined||v===''?null:Number.isFinite(Number(v))?Number(v):null;
function cleanClosed(row,symbol){
  if(!row||row.symbol!==symbol||row.mode!=='NORMAL'||row.state!=='CLOSED'||
    typeof row.id!=='string'||row.id.length>180||!/^[A-Za-z0-9:._|+-]+$/.test(row.id)||
    !['BUY','SELL'].includes(row.side)||!Number.isFinite(numeric(row.openedAt))||
    !Number.isFinite(numeric(row.resolvedAt))||row.resolvedAt<row.openedAt||
    row.resolvedAt>Date.now()+60000)return null;
  const keys=['entry','sl','tp1','tp2','tp3','score','openedAt','resolvedAt'];
  const values=Object.fromEntries(keys.map(k=>[k,numeric(row[k])]));
  return {id:row.id,symbol,side:row.side,mode:'NORMAL',state:'CLOSED',outcome:String(row.outcome||'').slice(0,40),
    ...values,hitTp1:row.hitTp1===true,hitTp2:row.hitTp2===true,hitTp3:row.hitTp3===true,
    slLockStage:numeric(row.slLockStage)||0,source:'V17_VALIDATION'};
}
class SignalOutcomeStore{
  constructor({pool,fetchSummary,intervalMs=15000,log=console}={}){this.pool=pool;this.fetchSummary=fetchSummary;this.intervalMs=intervalMs;this.log=log;this.timer=null;this.busy=false;this.lastSync=null;this.lastError=null;}
  async init(){if(!this.pool)throw Error('Durable storage unavailable');
    await this.pool.query(`CREATE TABLE IF NOT EXISTS zencore_signal_outcomes (
      id VARCHAR(180) PRIMARY KEY,symbol VARCHAR(16) NOT NULL,side VARCHAR(4) NOT NULL,
      opened_at BIGINT NOT NULL,resolved_at BIGINT NOT NULL,data JSONB NOT NULL,
      first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    await this.pool.query('CREATE INDEX IF NOT EXISTS zencore_signal_outcomes_symbol_resolved ON zencore_signal_outcomes(symbol,resolved_at DESC)');
  }
  async sync(){if(this.busy)return;this.busy=true;let failures=0;
    try{for(const symbol of PAIRS){try{
      const response=await this.fetchSummary(symbol);
      if(response?.ok!==true||response.symbol!==symbol||response.mode!=='NORMAL'||!Array.isArray(response.summary?.recent))throw Error('Invalid validation response');
      for(const raw of response.summary.recent){const row=cleanClosed(raw,symbol);if(!row)continue;
        await this.pool.query(`INSERT INTO zencore_signal_outcomes(id,symbol,side,opened_at,resolved_at,data)
          VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(id) DO NOTHING`,[row.id,row.symbol,row.side,row.openedAt,row.resolvedAt,row]);
      }
    }catch{failures++;}}
      this.lastSync=Date.now();this.lastError=failures?`${failures} pair tidak dapat diselaraskan`:null;
      if(failures)this.log.warn?.('Signal outcome sync incomplete');
    }finally{this.busy=false;}
  }
  start(){if(this.timer)return;this.sync().catch(()=>{this.lastError='Simpanan hasil tidak tersedia';});
    this.timer=setInterval(()=>this.sync().catch(()=>{this.lastError='Simpanan hasil tidak tersedia';}),this.intervalMs);this.timer.unref?.();}
  stop(){if(this.timer)clearInterval(this.timer);this.timer=null;}
  async read(symbol,limit=100){
    const selected=PAIRS.includes(symbol)?symbol:null;
    const rows=(await this.pool.query(`SELECT data FROM zencore_signal_outcomes
      WHERE ($1::text IS NULL OR symbol=$1) ORDER BY resolved_at DESC LIMIT $2`,[selected,Math.min(200,Math.max(1,limit))])).rows;
    const totals=(await this.pool.query(`SELECT symbol,COUNT(*)::int AS sample,
      COUNT(*) FILTER (WHERE data->>'outcome'='SL')::int AS sl,
      COUNT(*) FILTER (WHERE data->>'outcome' IN ('TP1','TP2','TP3','PROTECTED_WIN','TP2_PROTECTED','TP3_PROTECTED','TP1_MANAGED','TP2_MANAGED','TP3_MANAGED'))::int AS wins
      FROM zencore_signal_outcomes WHERE ($1::text IS NULL OR symbol=$1) GROUP BY symbol ORDER BY symbol`,[selected])).rows;
    return {source:'SIGNAL_VALIDATION_NOT_BROKER_PL',lastSync:this.lastSync,lastError:this.lastError,totals,
      note:'Hanya keputusan V17 yang sempat diselaraskan disimpan. Posisi open boleh terputus selepas restart; sejarah lama sebelum pengaktifan tidak boleh dipulihkan.',
      records:rows.map(r=>r.data)};
  }
  async targetStats(symbol,side){
    if(!PAIRS.includes(symbol)||!['BUY','SELL'].includes(side))return null;
    const result=await this.pool.query(`SELECT COUNT(*)::int AS sample,
      COUNT(*) FILTER (WHERE data->>'hitTp1'='true')::int AS hit_tp1,
      COUNT(*) FILTER (WHERE data->>'hitTp2'='true')::int AS hit_tp2,
      COUNT(*) FILTER (WHERE data->>'hitTp3'='true')::int AS hit_tp3
      FROM zencore_signal_outcomes WHERE symbol=$1 AND side=$2 AND data->>'outcome'<>'AMBIGUOUS'`,[symbol,side]);
    const row=result.rows[0];return row?{sample:Number(row.sample),hitTp1:Number(row.hit_tp1),
      hitTp2:Number(row.hit_tp2),hitTp3:Number(row.hit_tp3)}:null;
  }
}
module.exports={SignalOutcomeStore,cleanClosed};
