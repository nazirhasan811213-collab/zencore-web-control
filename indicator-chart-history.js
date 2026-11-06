'use strict';
const Core=require('./indicator-chart-core');
// A bounded, read-only projection of accepted Pine feed candles. Never writes
// to a market object, a user setting, a trade decision or an execution queue.
class ChartHistory {
 constructor(){this.rows=new Map();this.dirty=new Map();this.pool=null;this.flushing=false;}
 async init(pool,now=Date.now()){
  this.pool=pool;if(!pool)return;
  await pool.query("CREATE TABLE IF NOT EXISTS zencore_guide_candles(tf TEXT NOT NULL, bar_time BIGINT NOT NULL, data JSONB NOT NULL, PRIMARY KEY(tf,bar_time))");
  const saved=await pool.query("SELECT data FROM zencore_guide_candles WHERE bar_time >= $1 ORDER BY bar_time",[now-Core.MAX_AGE]);
  for(const {data} of saved.rows){if(!data||!['2','15'].includes(data.timeframe)||data.confirmed!==true)continue;this.rows.set(data.timeframe,Core.merge(this.rows.get(data.timeframe),data,data.timeframe,now));}
  if(!this.timer){this.timer=setInterval(()=>this.flush().catch(()=>console.error('Guide candle persistence unavailable')),15000);this.timer.unref?.();}
 }
 async flush(now=Date.now()){
  if(!this.pool||this.flushing)return;this.flushing=true;
  const batch=[...this.dirty.entries()];try{
   if(batch.length){await this.pool.query(`INSERT INTO zencore_guide_candles(tf,bar_time,data) SELECT x.tf,x.bar_time,x.data FROM jsonb_to_recordset($1::jsonb) AS x(tf text,bar_time bigint,data jsonb) ON CONFLICT(tf,bar_time) DO UPDATE SET data=EXCLUDED.data WHERE (EXCLUDED.data->>'observedAt')::bigint >= (zencore_guide_candles.data->>'observedAt')::bigint`,[JSON.stringify(batch.map(([,data])=>({tf:data.timeframe,bar_time:data.time,data})))]);for(const [key,data] of batch)if(this.dirty.get(key)===data)this.dirty.delete(key);}
   await this.pool.query('DELETE FROM zencore_guide_candles WHERE bar_time < $1',[now-Core.MAX_AGE]);
  }finally{this.flushing=false;}
 }
 observe(m,now=Date.now()){
  const p=Core.point(m);if(!p)return;
  this.rows.set(p.timeframe,Core.merge(this.rows.get(p.timeframe),p,p.timeframe,now));
  const retained=this.rows.get(p.timeframe).find(c=>c.time===p.time);
  if(this.pool&&retained?.confirmed===true)this.dirty.set(p.timeframe+'|'+p.time,retained);
  for(const [key,c] of this.dirty)if(c.time<now-Core.MAX_AGE)this.dirty.delete(key);
 }
 status(now=Date.now()){return {persistent:!!this.pool,timeframes:Object.fromEntries(['2','15'].map(tf=>{const rows=this.snapshot(tf,now).candles.filter(c=>c.confirmed===true);return [tf,{confirmedCandles:rows.length,lastClosedAt:rows.at(-1)?rows.at(-1).time+Number(tf)*60000:null}];}))};}
 snapshot(tf,now=Date.now()){
  tf=String(tf);const candles=Core.merge(this.rows.get(tf),null,tf,now);
  this.rows.set(tf,candles);
  return {ok:true,symbol:'XAUUSD',timeframe:tf,source:'PINE_FEED',retentionHours:5,
    historyScope:this.pool?'PERSISTED_CONFIRMED_5H':'SINCE_SERVER_START',candles};
 }
}
module.exports={ChartHistory,history:new ChartHistory()};
