'use strict';
const {test}=require('node:test'),a=require('node:assert/strict'),fs=require('node:fs');
const prefix=fs.readFileSync(__dirname+'/sop-v6.test.js','utf8').split("\nfor(const tf of ['2','15'])for(const side")[0];
const {fixture}=new Function('require','__dirname',prefix+';return {fixture};')(require,__dirname);
const C=require('../analysis-execution-contract');
function native(tf,side){const {f,ingest}=fixture(tf,side),sign=side==='BUY'?1:-1;Object.assign(f.row[66],{entryPolicyVersion:'PINE_NATIVE_SOLID_ENTRY_V7',nativeSolid:{version:'NATIVE_SOLID_LABEL_V1',barTime:f.row[1],pulse:true,basis:4100-sign,rsi:50}});return {f,ingest,sign};}
for(const tf of ['2','15'])for(const side of ['BUY','SELL']) {
 test(`Native V7 TF${tf} ${side} accepts opposite HEMA and candle, low checklist, blocked ATR telemetry`,()=>{
 const {f,ingest,sign}=native(tf,side);f.row[65]['tf'+tf].fast=4100-sign;f.row[3]=4100+sign*.5;f.row[40]=false;
 if(tf==='2')Object.assign(f.row[66].entrySafety,{flips:3,atr:5,chopBlocked:true});
 const m=ingest();a.equal(m.strategyNormal.state,'READY',m.strategyNormal.reason);a.ok(C.createEntryDecision(m));
 });
 for(const bad of ['wt','basis','rsi','pulse','bar','confirmed','price'])test(`Native V7 TF${tf} ${side} rejects ${bad}`,()=>{
 const {f,ingest,sign}=native(tf,side),e=f.row[66].nativeSolid;
 if(bad==='wt')f.row[13]=-sign*2;if(bad==='basis')e.basis=4100+sign;if(bad==='rsi')e.rsi=side==='BUY'?75:25;if(bad==='pulse')e.pulse=false;if(bad==='bar')e.barTime--;if(bad==='confirmed')f.batch.confirmed=false;if(bad==='price')f.row[66].sourceEntry=4100+sign;
 const m=ingest();a.equal(m.strategyNormal.state,'WAIT');a.equal(C.createEntryDecision({...m,strategyNormal:{...m.strategyNormal,state:'READY'}}),null);
 });
}
const Exit=require('../native-chart-exit');
for(const tf of ['2','15'])for(const side of ['BUY','SELL'])test(`V7 yellow closes actual ${side} TF${tf} without partial/profit gate`,()=>{
 const now=Date.now(),step=Number(tf)*60000,sign=side==='BUY'?1:-1;
 const y={version:'BJ_OPPOSITE_YELLOW_V1',barTime:now-step,fast:100+sign,slow:100,close:100-sign,confirmed:true};
 const market={symbol:'XAUUSD',timeframe:tf,time:now-step,signalObservedAt:now,confirmed:true,feedChannel:'EXECUTION',setupMeta:{entryPolicyVersion:'PINE_NATIVE_SOLID_ENTRY_V7',yellowExit:y},strategyNormal:{}};
 const latest={status:'EXECUTED',payload:{analysisSnapshot:{side,entryPolicyVersion:'PINE_SOLID_PRICE_WT_HEMA_V6',executionTimeframe:tf,setupKey:'actual',analysisSopVersion:'existing'}}},mode=tf==='2'?'TF2_SCALPING':'TF15_INTRA',pos=[{symbol:'XAUUSD',strategyMode:mode}];
 const close=Exit.forActiveSetup(market,latest,pos,mode,now);a.equal(close.positionManagement.action,'EXIT_ALL');a.equal(close.setupKey,'actual');
 for(const e of [{...y,confirmed:false},{...y,fast:100},{...y,barTime:now}])a.equal(Exit.forActiveSetup({...market,setupMeta:{...market.setupMeta,yellowExit:e}},latest,pos,mode,now).positionManagement,undefined);
 a.equal(Exit.forActiveSetup(market,latest,[{...pos[0],origin:'MANUAL'}],mode,now).positionManagement,undefined);
});
test('V7 scripts preserve risk/re-entry, use one structured alert and unconditional confirmed yellow exit',()=>{
 for(const tf of ['2','15']){const s=fs.readFileSync(`${__dirname}/../ZenCore_TF${tf}_SOP_V7.pine`,'utf8');a.equal((s.match(/\balert\(/g)||[]).length,1);a.match(s,/CLOSED_PAUSE_RESUME_V2/);a.match(s,/bool xc_yellow_exit = xc_buy \? \(v2_dr and not v2_dc\) : \(v2_ur and not v2_uc\)/);a.match(s,/if xc_yellow_exit or xc_stop/);a.match(s,/nativeSolid/);a.match(s,/NATIVE_SOLID_LABEL_V1/);a.match(s,/zc24_closed_entry_packet := zc24_payload/);if(tf==='2')a.match(s,/bool zs_pass = true/);}
});
