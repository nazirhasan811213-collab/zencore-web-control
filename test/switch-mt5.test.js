'use strict';
const {test}=require('node:test'),a=require('node:assert/strict'),{AccountHandover}=require('../account-handover');
const actor={id:'admin',role:'admin',status:'active'};
test('MT5 switch preserves identity preferences and sizing but stops and revokes old connection',async()=>{
 const seen=[],query=async(sql,args)=>{seen.push([sql,args]);if(sql.includes('FROM zencore_users'))return {rows:[{role:'client',email:'owner@example.com',handover_generation:4}]};if(sql.includes('FROM zencore_autotrade_profiles'))return {rows:[{desired_state:'STOPPED',effective_state:'STOPPED'}]};return {rows:[],rowCount:0};};
 const h=new AccountHandover({pool:{query,connect:async()=>({query,release(){}})},stopTrading:async()=>{}});
 const r=await h.switchMt5(actor,'one',{confirmation:'RESET',closeAllAccount:true,resetPolicy:'MASTER_RESET_RELEASE_V3',allowUnconfirmedDisconnect:true,resetGeneration:4});
 a.equal(r.completed,true);a.equal(r.profilePreserved,true);a.equal(r.brokerCloseConfirmed,false);a.equal('defaultPassword' in r,false);
 const sql=seen.map(x=>x[0]).join('\n');a.doesNotMatch(sql,/DELETE FROM zencore_autotrade_profiles|DELETE FROM zencore_alert_preferences|SET display_name|password_hash=/);a.match(sql,/UPDATE zencore_autotrade_profiles SET desired_state='STOPPED'/);a.match(sql,/handover_state='ADMIN_SETUP'/);a.equal(seen.find(x=>x[0].includes('INSERT INTO zencore_account_resets'))[1].at(-1),'SWITCH_MT5');
});
test('switch requires admin and cannot reuse master reset receipt',async()=>{
 const h=new AccountHandover({pool:{query:async()=>({rows:[{generation:1,operation:'MASTER_RESET'}]})}});
 await a.rejects(h.switchMt5({role:'client',status:'active'},'one',{}),{status:403});await a.rejects(h.switchMt5(actor,'one',{confirmation:'RESET',closeAllAccount:true,resetPolicy:'MASTER_RESET_FORCE_V2',commandId:'12345678-1234-1234-1234-123456789012'}),/Jenis tindakan/);
});
test('onboarding completion remains independent of account-switch preservation',async()=>{
 const seen=[],query=async(sql,args)=>{seen.push(sql);if(sql.includes('SELECT * FROM zencore_users'))return {rows:[{role:'client',status:'active',handover_state:'USER_PROFILE',handover_generation:0}]};if(sql.includes('to_regclass'))return {rows:[{name:null}]};return {rows:[]};};
 const h=new AccountHandover({pool:{connect:async()=>({query,release(){}})}});
 const r=await h.complete('one',{generation:0,displayName:'New Trader',email:'new@example.com',phone:'0123456789',newPassword:'NewTrader2026!',confirmPassword:'NewTrader2026!'});
 a.equal(r.state,'LIVE');a.ok(seen.some(s=>s.includes("handover_state='LIVE'")));a.ok(!seen.some(s=>s.includes("handover_state='ADMIN_SETUP'")));
});
