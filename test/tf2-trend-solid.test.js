'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const source=fs.readFileSync(require.resolve('../ZenCore_TF2_SOP_V7.pine'),'utf8');

// Evaluate the production Pine gate expressions to cover both trend directions
// and tick timing without maintaining a second signal strategy in JavaScript.
function gate(name,state){
 const expression=source.match(new RegExp('^(?:bool|int) '+name+' = (.+)$','m'))[1]
  .replace(/not na\((\w+)\)/g,'($1 != null)')
  .replace(/na\((\w+)\)/g,'($1 == null)')
  .replace(/\band\b/g,'&&').replace(/\bor\b/g,'||').replace(/\bnot\b/g,'!');
 return Function('state','with(state){return ('+expression+');}')(state);
}
for(const direction of [1,-1]){
 const side=direction===1?'BUY':'SELL',previous=direction===1?'SELL':'BUY';
 test('confirmed trend change replaces '+previous+' with '+side+' once',()=>{
  const context={zc24_chart_ok:true,barstate:{isconfirmed:true},zc_trend_direction:direction,zc_last_trend_direction:-direction};
  assert.equal(gate('zc_trend_solid',context),true);
  context.zc_last_trend_direction=direction;
  assert.equal(gate('zc_trend_solid',context),false);
  context.zc_last_trend_direction=-direction;context.barstate.isconfirmed=false;
  assert.equal(gate('zc_trend_solid',context),false);
  context.barstate.isconfirmed=true;
  Object.assign(context,{zc_hold_active:true,zc_seq_side:previous,is_hema_bull:direction===1,is_hema_bear:direction===-1});
  assert.equal(gate('zc_held_colour_end',context),true);
  context.zc_seq_side=side;
  assert.equal(gate('zc_held_colour_end',context),false);
 });
 test(side+' qualification can occur after the original pulse and waits for active exit delivery',()=>{
  const state={zc_hold_active:true,zc_source_setup_at:1000,zc_seq_trigger:2000,zc_seq_pulse:false};
  assert.equal(gate('zn_initial_solid',state),true);
  Object.assign(state,{zs_pass:true,barstate:{isconfirmed:true},xc_active:false,zc_old_exit_done:true,
   draft_plan_ok:true,zc_seq_completed:null,zc24_tf2:true,zn_entry:true,zc_dashboard_entry_pass:true,zc_new_entry_pass:true,zc_cycle_kind:'INITIAL',zn_reentry_pass:true});
  assert.equal(gate('zc_hold_qualify',state),true);
  for(const change of [{xc_active:true},{zc_old_exit_done:false},{zc_dashboard_entry_pass:false},{zc_new_entry_pass:false},{zc_seq_completed:3000}]){
   assert.equal(gate('zc_hold_qualify',{...state,...change}),false);
  }
 });
}
test('cancelling an old source occurs before replacement capture and active exit state is preserved',()=>{
 assert.ok(source.indexOf('if zc_close_all_pulse or zc_held_colour_end')<source.indexOf('if zc_hold_new_source'));
 assert.match(source,/if zc80_new_solid\n    if not xc_active and zc_old_exit_done\n        xc_full_bar := na/);
 assert.match(source,/zc_pulse_entry := basis/);
 assert.match(source,/zc_last_trend_direction := zc_trend_direction/);
 assert.match(source,/zc_min_entry_score = input.int\(50,/);
 assert.equal((source.match(/\balert\(/g)||[]).length,1);
 assert.equal((source.match(/array.push\(zc24_parts,/g)||[]).length,67);
});

test('native labels and both checklist panels follow the current trend source',()=>{
 assert.match(source,/else if current_condition == 1 and \(curr_isBuy \? is_hema_bull : is_hema_bear\)/);
 assert.doesNotMatch(source,/1\. Signal Solid Buy\/Sell/);
 assert.match(source,/"1\. WT searah:"/);
 assert.match(source,/table.cell\(sop_table, 1, 1, zc24_solid \? zc_seq_side : "WAIT"/);
 assert.match(source,/table.cell\(sop_table, 1, 2, zc24_solid and zn_wt/);
});
