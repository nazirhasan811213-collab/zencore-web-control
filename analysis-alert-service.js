'use strict';
const crypto = require('crypto');
const {signals,transitions,defaults} = require('./analysis-alert-core');
const {prepareTelegram,messageQuality,telegramMessage} = require('./analysis-telegram');
const fail = message => Object.assign(new Error(message), {status:400});
class AnalysisAlerts {
  constructor({pool=null,token='',botName='',fetchFn=fetch}={}) {
    this.pool=pool; this.token=token; this.botName=/^[A-Za-z0-9_]+$/.test(botName)?botName:''; this.fetch=fetchFn;
    this.prefs=new Map(); this.states=new Map(); this.events=[]; this.sequence=0; this.queue=Promise.resolve(); this.ready=false;
  }
  async init() {
    if(this.pool) await this.pool.query(`
      CREATE TABLE IF NOT EXISTS zencore_alert_preferences(user_id UUID PRIMARY KEY REFERENCES zencore_users(id) ON DELETE CASCADE, data JSONB NOT NULL);
      CREATE TABLE IF NOT EXISTS zencore_alert_states(symbol TEXT PRIMARY KEY, data JSONB NOT NULL);
      CREATE TABLE IF NOT EXISTS zencore_analysis_alerts(id BIGSERIAL PRIMARY KEY, data JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
      CREATE TABLE IF NOT EXISTS zencore_telegram_deliveries(id BIGSERIAL PRIMARY KEY, event_id BIGINT REFERENCES zencore_analysis_alerts(id) ON DELETE CASCADE, user_id UUID REFERENCES zencore_users(id) ON DELETE CASCADE, status TEXT NOT NULL DEFAULT 'pending', UNIQUE(event_id,user_id));
      CREATE TABLE IF NOT EXISTS zencore_telegram_chat_claims(event_id BIGINT REFERENCES zencore_analysis_alerts(id) ON DELETE CASCADE, chat_id TEXT NOT NULL, PRIMARY KEY(event_id,chat_id));
    `);
    this.ready=true;
    if(this.pool && this.token) { this.timer=setInterval(()=>this.deliver().catch(()=>console.error('Telegram delivery unavailable')),2000); this.timer.unref?.(); }
    this.cleanupTimer=setInterval(()=>this.pool?.query("DELETE FROM zencore_analysis_alerts WHERE created_at < NOW()-INTERVAL '7 days'").catch(()=>{}),3600000); this.cleanupTimer.unref?.();
  }
  async withUserLock(user, method, argument) {
    // Serialise code attempts and ID changes across concurrent requests/instances.
    if (!this.pool) {
      this.userLocks ||= new Map();
      const previous=this.userLocks.get(user)||Promise.resolve();
      const pending=previous.catch(()=>{}).then(()=>this[method](user,argument));
      this.userLocks.set(user,pending);
      try{return await pending;}finally{if(this.userLocks.get(user)===pending)this.userLocks.delete(user);}
    }
    const c=await this.pool.connect();
    let result,error;
    try {
      await c.query('BEGIN');
      await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',['alert-user:'+user]);
      const scoped=Object.create(this);scoped.pool=c;
      try {result=await scoped[method](user,argument);}catch(e){error=e;}
      // Failed verification still persists its attempt count / request cooldown.
      await c.query('COMMIT');
      if(error)throw error;
      return result;
    }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
  }
  async get(user) {
    const data=this.pool?(await this.pool.query('SELECT data FROM zencore_alert_preferences WHERE user_id=$1',[user])).rows[0]?.data:this.prefs.get(user);
    return {...defaults(),...data};
  }
  async put(user,data) {
    if(this.pool) await this.pool.query('INSERT INTO zencore_alert_preferences(user_id,data) VALUES($1,$2) ON CONFLICT(user_id) DO UPDATE SET data=$2',[user,data]);
    else this.prefs.set(user,data);
  }
  publicPrefs(p) { return {popup:p.popup,sound:p.sound,telegramEnabled:p.telegramEnabled,telegramId:p.telegramId,verified:p.verified,telegramAvailable:!!this.token,botName:this.botName}; }
  async save(user,body) {
    const p=await this.get(user);
    for(const k of ['popup','sound','telegramEnabled']) if(typeof body[k]!=='boolean') throw fail('Tetapan alert tidak sah.');
    const id=String(body.telegramId||'').trim();
    if(id && !/^[1-9][0-9]{4,15}$/.test(id)) throw fail('Masukkan Telegram ID nombor untuk akaun peribadi.');
    if(id!==p.telegramId) {p.verified=false;delete p.code;delete p.expires;}
    if(body.telegramEnabled && (!this.token || !p.verified || id!==p.telegramId)) throw fail('Sahkan Telegram ID sebelum mengaktifkan alert.');
    Object.assign(p,{popup:body.popup,sound:body.sound,telegramEnabled:body.telegramEnabled,telegramId:id});
    await this.put(user,p); return this.publicPrefs(p);
  }
  async telegram(chat,text) {
    if(!this.token) throw fail('Telegram belum dikonfigurasi oleh pentadbir.');
    let r,j;
    try { r=await this.fetch(`https://api.telegram.org/bot${this.token}/sendMessage`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:chat,text}),signal:AbortSignal.timeout(8000)}); j=await r.json(); }
    catch {throw fail('Telegram tidak dapat dihubungi. Cuba lagi.');}
    if(!r.ok || !j.ok) throw fail('Telegram gagal dihantar. Semak ID dan tekan Start pada bot ZenCore.');
  }
  async requestCode(user) {
    const p=await this.get(user);
    if(!p.telegramId) throw fail('Simpan Telegram ID dahulu.');
    if(Date.now()-(p.requestedAt||0)<60000) throw fail('Tunggu 60 saat sebelum meminta kod baharu.');
    const code=String(crypto.randomInt(100000,1000000));
    p.requestedAt=Date.now();p.code=crypto.createHash('sha256').update(user+code).digest('hex');p.expires=Date.now()+600000;p.attempts=0;
    await this.put(user,p);
    await this.telegram(p.telegramId,`ZenCore: kod pengesahan alert anda ialah ${code}. Sah 10 minit. Abaikan jika anda tidak meminta kod ini.`);
  }
  async verify(user,code) {
    const p=await this.get(user);
    if(!p.code || p.expires<Date.now() || p.attempts>=5) throw fail('Kod tamat atau terlalu banyak percubaan. Minta kod baharu.');
    p.attempts++;
    const match=crypto.createHash('sha256').update(user+String(code)).digest('hex')===p.code;
    if(match){p.verified=true;delete p.code;delete p.expires;}
    await this.put(user,p);
    if(!match) throw fail('Kod tidak sepadan.');
    return this.publicPrefs(p);
  }
  ingest(m) {
    // Preserve feed order; a failure cannot poison later signals.
    this.queue=this.queue.then(()=>this.record(m)).catch(()=>console.error('Analysis alert persistence unavailable'));
    return this.queue;
  }
  async record(m) {
    const next=signals(m);if(!this.ready||!next)return;
    const notificationEvents=prev=>prepareTelegram(prev,next,transitions(prev,next)).map(e=>e.kind==='ENTRY'?{
      ...e,telegramQuality:messageQuality(m),telegramPlan:Object.fromEntries(['entry','sl','tp1','tp2','tp3'].map(k=>[k,m.strategyNormal.plan[k]]))
    }:e);
    if(!this.pool){
      const prev=this.states.get(next.symbol);if(prev&&next.time<=prev.time)return;
      const events=notificationEvents(prev);
      this.states.set(next.symbol,next);
      for(const e of events) this.events.push({...e,id:++this.sequence});
      this.events=this.events.slice(-500);return;
    }
    const c=await this.pool.connect();
    try {
      await c.query('BEGIN');
      await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',['analysis-alert:'+next.symbol]);
      const prev=(await c.query('SELECT data FROM zencore_alert_states WHERE symbol=$1',[next.symbol])).rows[0]?.data;
      if(!prev||next.time>prev.time){
        const events=notificationEvents(prev);
        await c.query('INSERT INTO zencore_alert_states(symbol,data) VALUES($1,$2) ON CONFLICT(symbol) DO UPDATE SET data=$2',[next.symbol,next]);
        for(const e of events){
          const row=(await c.query('INSERT INTO zencore_analysis_alerts(data) VALUES($1) RETURNING id',[e])).rows[0];
          if(e.telegramDuplicate)continue;
          await c.query(`INSERT INTO zencore_telegram_deliveries(event_id,user_id)
            SELECT $1,p.user_id FROM zencore_alert_preferences p JOIN zencore_users u ON u.id=p.user_id
            WHERE u.status='active' AND u.role<>'viewer' AND p.data->>'telegramEnabled'='true' AND p.data->>'verified'='true'`,[row.id]);
        }
      }
      await c.query('COMMIT');
    }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
  }
  async feed(after) {
    if(after===null){const id=this.pool?(await this.pool.query('SELECT COALESCE(MAX(id),0) AS id FROM zencore_analysis_alerts')).rows[0].id:this.sequence;return {events:[],cursor:String(id)};}
    if(!/^\d{1,18}$/.test(after))throw fail('Cursor tidak sah.');
    const rows=this.pool?(await this.pool.query('SELECT id,data FROM zencore_analysis_alerts WHERE id>$1 ORDER BY id LIMIT 100',[after])).rows.map(r=>({...r.data,id:String(r.id)})):this.events.filter(x=>x.id>Number(after)).slice(0,100);
    return {events:rows,cursor:rows.length?String(rows.at(-1).id):after};
  }
  async deliver() {
    if(this.delivering)return;this.delivering=true;
    try{
      // Claim once before sending: never duplicate an ambiguous Telegram timeout.
      const rows=(await this.pool.query(`UPDATE zencore_telegram_deliveries SET status='sending' WHERE id IN
        (SELECT id FROM zencore_telegram_deliveries WHERE status='pending' ORDER BY id LIMIT 10 FOR UPDATE SKIP LOCKED) RETURNING *`)).rows;
      for(const row of rows){
        let status='skipped';
        try{
          const p=await this.get(row.user_id);
          const u=(await this.pool.query('SELECT status,role FROM zencore_users WHERE id=$1',[row.user_id])).rows[0];
          const e=(await this.pool.query('SELECT data FROM zencore_analysis_alerts WHERE id=$1',[row.event_id])).rows[0]?.data;
          if(p.telegramEnabled&&p.verified&&u?.status==='active'&&u.role!=='viewer'&&e&&Date.now()-e.time<180000&&
             (e.kind!=='ENTRY'||(e.telegramVersion===1&&!e.telegramDuplicate))){
            const claim=await this.pool.query('INSERT INTO zencore_telegram_chat_claims(event_id,chat_id) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING event_id',[row.event_id,p.telegramId]);
            if(claim.rows.length){
              await this.telegram(p.telegramId,telegramMessage({...e,id:String(row.event_id)}));status='sent';
            }
          }
        }catch{status='failed';}
        await this.pool.query('UPDATE zencore_telegram_deliveries SET status=$2 WHERE id=$1',[row.id,status]);
      }
    }finally{this.delivering=false;}
  }
}
module.exports={AnalysisAlerts};
