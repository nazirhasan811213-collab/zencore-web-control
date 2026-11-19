'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const sources=Object.fromEntries(['2','15'].map(tf=>[tf,fs.readFileSync(`${__dirname}/../ZenCore_TF${tf}_SOP_V7.pine`,'utf8')]));
// Evaluate production scalar expressions and the production pause state block.
// This is not a Pine compiler or a profitability backtest.
function evaluate(expr,state){
 const js=expr.replace(/\b(close|high|low|open|time_close|he1|wt1)\[1\]/g,'previous.$1')
  .replace(/\band\b/g,'&&').replace(/\bor\b/g,'||').replace(/\bnot\b/g,'!')
  .replace(/\bmath\./g,'Math.');
 return Function('s','with(s){return ('+js+');}')({...state,na:x=>x==null});
}
function gate(src,name,state){return evaluate(src.match(new RegExp('^bool '+name+' = (.*)$','m'))[1],state);}
function pauseStep(src,s){
 const block=src.slice(src.indexOf('var int zn_reset_at ='),src.indexOf('// Break the whole pause'));
 const stack=[{indent:-1,enabled:true}];
 for(const raw of block.split('\n')){
  const text=raw.trim();if(!text||text.startsWith('//'))continue;
  const indent=raw.length-raw.trimStart().length;
  while(stack.length>1&&indent<=stack.at(-1).indent)stack.pop();
  const enabled=stack.at(-1).enabled;
  if(text.startsWith('if ')){stack.push({indent,enabled:enabled&&!!evaluate(text.slice(3),s)});continue;}
  if(!enabled)continue;
  const m=text.match(/^(var )?(?:(?:int|float|bool|string) )?(\w+)\s*(:=|=)\s*(.*)$/);
  assert.ok(m,'unsupported production pause statement: '+text);
  if(m[1]&&Object.hasOwn(s,m[2]))continue;
  s[m[2]]=m[4]==='na'?null:evaluate(m[4],s);
 }
 return s;
}
for(const tf of ['2','15']){
 const src=sources[tf];
 test(`TF${tf}: turning off room checking cannot bypass score or candle`,()=>{
  const base={zc_entry_candle_pass:true,zc_quality_pass:true,zc_structure_entry:false,zc_tp1_blocked:true};
  assert.equal(gate(src,'zc_new_entry_pass',base),true);
  for(const change of [{zc_quality_pass:false},{zc_entry_candle_pass:false},{zc_structure_entry:true}])assert.equal(gate(src,'zc_new_entry_pass',{...base,...change}),false);
 });
 for(const sign of [1,-1]){
  test(`TF${tf} ${sign>0?'BUY':'SELL'}: score 50 cannot bypass choppy or opposite-majority MTF`,()=>{
   const base={zc_quality_score:50,zc_min_entry_score:50,chop_val:45,zc_draft_sign:sign,zc_quality_mtf:sign};
   assert.equal(gate(src,'zc_quality_pass',base),true);
   for(const change of [{zc_quality_score:49},{zc_quality_score:null},{chop_val:60},{zc_quality_mtf:-2*sign}])assert.equal(gate(src,'zc_quality_pass',{...base,...change}),false);
  });
  test(`TF${tf} ${sign>0?'BUY':'SELL'}: weak bodies and rejection wicks fail even above score 50`,()=>{
   const base={zc_entry_candle_pass:true,zn_range:10,zn_body:5,zn_close_location:.8};
   assert.equal(gate(src,'zn_reentry_candle',base),true);
   for(const change of [{zn_body:2},{zn_close_location:.4},{zn_range:0},{zc_entry_candle_pass:false}])assert.equal(gate(src,'zn_reentry_candle',{...base,...change}),false);
  });
  test(`TF${tf} ${sign>0?'BUY':'SELL'}: late extended re-entry is rejected in ATR units`,()=>{
   const base={zc24_buy:sign>0,atr:10,zn_body:5,zn_max_extension:1.5,close:100+sign*10,he1:100,he2:100-sign};
   assert.equal(gate(src,'zn_not_chasing',base),true);
   for(const change of [{close:100+sign*16},{zn_body:16},{atr:0}])assert.equal(gate(src,'zn_not_chasing',{...base,...change}),false);
  });
  test(`TF${tf} ${sign>0?'BUY':'SELL'}: complete pause breakout, expiry and source reset`,()=>{
   const s={zc80_new_solid:false,barstate:{isconfirmed:true},xc_active:false,zc_virtual_closed_at:0,zc_hold_active:true,zc24_buy:sign>0,atr:10,zn_pullback:.25,zn_sideways:.75,zn_max_wait:3};
   const bar=(index,price,lo,hi)=>{
    s.previous={close:s.close,high:s.high,low:s.low,open:s.open,time_close:s.time_close??0};
    Object.assign(s,{bar_index:index,time_close:(index+1)*120000,open:100+sign*(price-2),close:100+sign*price,high:100+(sign>0?hi:-lo),low:100+(sign>0?lo:-hi)});
    pauseStep(src,s);s.zn_break=gate(src,'zn_break',s);return gate(src,'zn_resume',s);
   };
   assert.equal(bar(0,0,-2,1),false); // first bar after close cannot use pre-close history
   assert.equal(bar(1,-3,-4,-1),false); // 0.3 ATR pullback arms a pause
   assert.equal(s.zn_rest,true);
   assert.equal(bar(2,0,-1,.5),false); // beats preceding high/low but not full pause
   assert.equal(bar(3,2,-1,2.5),true);
   // A failed candidate cannot keep a pause alive forever.
   assert.equal(bar(5,0,-5,5),false);
   assert.equal(s.zn_rest,false);
   s.zc80_new_solid=true;pauseStep(src,s);
   assert.equal(s.zn_rest_at,null);assert.equal(s.zn_pause_high,null);
  });
 }
 test(`TF${tf}: one successful follow-up, no stacking, no unconfirmed or pending-exit entry`,()=>{
  const base={zc_followup_used:false,zn_resume:true,zn_reentry_candle:true,zn_not_chasing:true,zn_trend_resume:true,zc_new_entry_pass:true,zc_dashboard_entry_pass:true};
  assert.equal(gate(src,'zn_reentry_pass',base),true);
  for(const name of Object.keys(base))assert.equal(gate(src,'zn_reentry_pass',{...base,[name]:name==='zc_followup_used'}),false,name);
  const qualify={zs_pass:true,barstate:{isconfirmed:true},xc_active:false,zc_old_exit_done:true,draft_plan_ok:true,zc_hold_active:true,zc_seq_completed:null,zc24_tf2:true,zc24_tf15:true,zn_entry:true,zc_dashboard_entry_pass:true,zc_new_entry_pass:true,zc_cycle_kind:'FOLLOWUP',zn_reentry_pass:true};
  assert.equal(gate(src,'zc_hold_qualify',qualify),true);
  for(const change of [{xc_active:true},{zc_old_exit_done:false},{barstate:{isconfirmed:false}},{zn_reentry_pass:false}])assert.equal(gate(src,'zc_hold_qualify',{...qualify,...change}),false);
  assert.match(src,/if zc_hold_qualify\n    if zc_cycle_kind == "FOLLOWUP"\n        zc_followup_used := true/);
  assert.match(src,/if zc_hold_new_source\n    zc_followup_used := false/);
 });
 test(`TF${tf}: quality uses confirmed higher timeframes and alert format stays compatible`,()=>{
  assert.match(src,/f_zc_quality_htf_data\(\) => \[close\[1\], ta.ema\(close, 20\)\[1\]\]/);
  assert.match(src,/f_zc_quality_htf_data\(\),barmerge.gaps_off,barmerge.lookahead_on/);
  assert.equal((src.match(/\balert\(/g)||[]).length,1);
  assert.equal((src.match(/array.push\(zc24_parts,/g)||[]).length,67);
  assert.match(src,/f_bool\(zc_seq_pulse or zn_held_qualification\)/);
  assert.match(src,/table.new\(position.top_left,2,15,/);
 });
}
