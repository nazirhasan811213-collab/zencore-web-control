'use strict';
const test=require('node:test'),a=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
for(const tf of ['3','15']) {
 const source=fs.readFileSync(`ZenCore_TF${tf}_${tf==='3'?'Scalp':'Intraday'}.pine`,'utf8');
 const expr=(name,state)=>{
  const m=source.match(new RegExp('bool '+name+' = (.*)'));a.ok(m,name);
  return vm.runInNewContext(m[1].replace(/\band\b/g,'&&').replace(/\bor\b/g,'||').replace(/\bnot\b/g,'!'),{na:x=>x==null,...state});
 };
 test(`TF${tf}: retry opportunity is 0/8/20 seconds, at most three; original window is never renewed`,()=>{
  const base={zc24_ready:true,zc24_bootstrap:false,zc24_setup_at:123,zc24_suppressed_setup:null,zc_seq_completed:1000,zc_seq_now:1000,zc24_entry_attempts:0,zc24_entry_last_sent:0,timenow:1000};
  const event=(s)=>{s={...base,...s};s.zc24_entry_window=expr('zc24_entry_window',s);s.zc24_retry_due=expr('zc24_retry_due',s);return expr('zc24_event',s);};
  a.equal(event({}),true);a.equal(event({zc24_entry_attempts:1,zc24_entry_last_sent:1000,timenow:8999}),false);
  a.equal(event({zc24_entry_attempts:1,zc24_entry_last_sent:1000,timenow:9000}),true);
  a.equal(event({zc24_entry_attempts:2,zc24_entry_last_sent:9000,timenow:21000}),true);
  a.equal(event({zc24_entry_attempts:3,timenow:22000}),false);
  a.equal(event({zc_seq_now:61000}),true);a.equal(event({zc_seq_now:61001}),false);a.equal(event({zc24_ready:false}),false);
  a.equal(event({zc24_suppressed_setup:123}),false);a.equal(event({zc24_bootstrap:true}),false);
  a.match(source,/entryAuthorizedAt\\":.*str.tostring\(zc_seq_completed\)/);
 });
 test(`TF${tf}: reserve alert slots; held SOLID qualification is not timed out`,()=>{
  const s={zc24_channel:'Execution',zc24_count:8,zc24_priority:false,zc_hold_new_source:true,zc80_new_solid:true,zc24_bootstrap:false};
  a.equal(expr('zc24_execution_due',s),false);a.equal(expr('zc24_execution_due',{...s,zc24_priority:true}),true);
  a.equal(expr('zc24_execution_due',{...s,zc24_priority:true,zc24_count:12}),false);
  const qualify=source.match(/bool zc_hold_qualify = (.*)/)[1];a.doesNotMatch(qualify,/30000|zc_seq_trigger|bar_index/);
  a.match(source,/zc_hold_reason := "NATIVE_CLOSE_ALL"/);a.match(source,/zc_hold_reason := "OPPOSITE_RIBBON"/);
 });
}
