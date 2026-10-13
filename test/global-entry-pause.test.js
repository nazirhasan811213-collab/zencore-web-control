'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const C=require('../analysis-execution-contract'),T=require('../analysis-telegram');
test('global pause rejects every entry version and Telegram while retaining management decisions',()=>{
 const old=process.env.ZENCORE_ENTRY_SIGNALS_PAUSED;process.env.ZENCORE_ENTRY_SIGNALS_PAUSED='true';
 try{for(const version of ['NORMAL_20261001_TF2_CURRENT_SOLID_HEMAPRICE_V7','NORMAL_20261001_TF2_SEP24_HEMA5_V8','NORMAL_20261001_TF15_V2']){assert.equal(C.createEntryDecision({symbol:'XAUUSD',receivedAt:Date.now(),strategyNormal:{state:'READY',side:'BUY',solid:true,entrySopVersion:version,plan:{entry:100,sl:99,tp1:101,tp2:102,tp3:103}}}),null);assert.equal(T.entrySopAllowed({telegramSop:{version},kind:'ENTRY'}),false);}
 const src=fs.readFileSync(require.resolve('../analysis-execution-contract'),'utf8');const manage=src.slice(src.indexOf('function createManagementDecision'));assert.doesNotMatch(manage,/ZENCORE_ENTRY_SIGNALS_PAUSED/);
 }finally{if(old===undefined)delete process.env.ZENCORE_ENTRY_SIGNALS_PAUSED;else process.env.ZENCORE_ENTRY_SIGNALS_PAUSED=old;}
});
