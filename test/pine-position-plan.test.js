'use strict';
const test=require('node:test'),a=require('node:assert/strict'),P=require('../pine-position-plan'),Core=require('../auto-trade-core');
const NOW=1792370000000;
function fixture(tf='3',side='BUY',kind='FOLLOWUP'){
 const sign=side==='BUY'?1:-1,mode=tf==='15'?'TF15_INTRA':'TF2_SCALPING',id='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
 const p={symbol:'XAUUSD',side,strategyMode:mode,entry:4200,sl:4200-sign*4,tp1:4200+sign*4,tp2:4200+sign*8,tp3:4200+sign*12};
 p.analysisSnapshot={...p,executionTimeframe:tf,setupKey:'REENTRY-2',cycleKind:kind,analysisSopVersion:`NORMAL_20261001_TF${tf}_RIBBON_V1`,exitLockVersion:'PINE_STEPLOCK_150_TP3_PLUS3_V1'};
 const command={id,podId:'pod',userId:'u',type:'PLACE_SETUP',status:'EXECUTED',payload:p};
 const position={symbol:p.symbol,side,strategyMode:mode,origin:'ZENCORE',setupId:id.slice(0,20),entry:4200+sign*.1,currentPrice:p.tp1,activeSl:p.sl,openedAt:NOW-1000};
 const market={symbol:p.symbol,timeframe:tf,setupKey:'CHART-CANDIDATE-3',price:4300,receivedAt:NOW,signalObservedAt:NOW,feedChannel:'EXECUTION',strategyNormal:{entrySopVersion:p.analysisSnapshot.analysisSopVersion,side:'SELL',plan:{entry:4300,tp1:4400}},positionManagement:{action:'HOLD'}};
 return {command,position,market,sign,mode};
}
for(const tf of ['3','15'])for(const side of ['BUY','SELL'])for(const kind of ['INITIAL','FOLLOWUP'])test(`TF${tf} ${side} ${kind} protects its own levels after chart advances`,()=>{
 const {command,position,market,sign}=fixture(tf,side,kind),p=command.payload;
 for(const [quote,target] of [[p.tp1,p.entry+sign*1.5],[p.tp2,p.tp1],[p.tp3,p.tp2],[p.tp3+sign*3.01,p.tp3]]){
  position.currentPrice=quote;const out=P.management(market,[position],command,NOW),m=Core.buildManagementCommand(out);
  a.equal(out.setupKey,p.analysisSnapshot.setupKey);a.equal(m.payload.analysisSnapshot.entryCommandId,command.id);
  a.equal(m.payload.analysisSnapshot.entryAnchor,P.ANCHOR);a.equal(m.payload.actions[0].activeSl,target);
  a.equal(out.strategyNormal.plan.entry,4200);a.equal(m.payload.strategyMode,p.strategyMode);
 }
 const v=P.view(command);a.equal(v.entryKind,kind==='FOLLOWUP'?'RE-ENTRY':'ENTRY');a.equal(v.entry,4200);a.equal(v.tp3,p.tp3);
 a.equal(market.setupKey,'CHART-CANDIDATE-3');
});
test('no cross-user, mode, manual, unknown setup or stale quote binding',async()=>{
 const {command,position,market,mode}=fixture();
 const {MemoryAutoTradeStore}=require('../auto-trade-store'),store=new MemoryAutoTradeStore();store.commands.set('pod',[command]);
 a.equal((await P.resolve(store,'u','pod',[position],'XAUUSD',mode)).id,command.id);
 a.equal(await P.resolve(store,'other','pod',[position],'XAUUSD',mode),null);
 a.equal(await P.resolve(store,'u','other',[position],'XAUUSD',mode),null);
 for(const change of [{origin:'MANUAL'},{strategyMode:'TF15_INTRA'},{setupId:'ffffffff-ffff-4fff-8f'},{side:'SELL'}])a.equal(P.management(market,[{...position,...change}],command,NOW),null);
 a.equal(P.management({...market,signalObservedAt:NOW-31000},[position],command,NOW),null);
 a.equal(P.management({...market,timeframe:'15'},[position],command,NOW),null);
});
test('new rejected candidate never replaces the active re-entry plan; lock only tightens',async()=>{
 const {command,position,market,mode}=fixture(),{MemoryAutoTradeStore}=require('../auto-trade-store'),store=new MemoryAutoTradeStore();
 const newer={...command,id:'ffffffff-ffff-4fff-8fff-ffffffffffff',status:'REJECTED',createdAt:NOW+1};store.commands.set('pod',[command,newer]);
 const active=await P.resolve(store,'u','pod',[position],'XAUUSD',mode,newer);a.equal(active.id,command.id);
 position.currentPrice=command.payload.tp2;position.activeSl=command.payload.tp2;
 a.equal(Core.buildManagementCommand(P.management(market,[position],active,NOW)),null);
});
test('native chart partial/full closes active setup only after it opened, dashboard cannot impersonate a native close',()=>{
 const {command,position,market}=fixture();
 for(const action of ['CLOSE_50_NOW','EXIT_ALL']){
  const out=P.management({...market,setupKey:command.payload.analysisSnapshot.setupKey,positionManagement:{action}},[position],command,NOW);
  a.equal(Core.buildManagementCommand(out).payload.actions[0].percent,100);
 }
 const m={...market,nativeChartExitAll:true};a.equal(P.management(m,[position],command,NOW).positionManagement.action,'EXIT_ALL');
 a.equal(P.management({...m,feedChannel:'DASHBOARD'},[position],command,NOW).positionManagement.action,'HOLD');
 a.equal(P.management({...m,signalObservedAt:NOW-2000},[position],command,NOW).positionManagement.action,'HOLD');
});
test('Postgres active plan lookup is parameterized and scopes user, pod, symbol, mode and command prefix',async()=>{
 const {PostgresAutoTradeStore}=require('../auto-trade-store'),store=Object.create(PostgresAutoTradeStore.prototype);
 store.pool={query:async(sql,args)=>{a.match(sql,/user_id=\$1 AND pod_id=\$2/);a.match(sql,/LEFT\(id::text,20\)=\$5/);a.deepEqual(args,['u','pod','XAUUSD','TF2_SCALPING','aaaaaaaa-bbbb-4ccc-8d']);return {rows:[]};}};
 a.equal(await store.setupForPosition('u','pod','XAUUSD','TF2_SCALPING','aaaaaaaa-bbbb-4ccc-8d'),null);
});


test('restored TF15 BE exit keeps TP2/TP3 locks, full close, no extension, and rejects use by TF2',()=>{
 for(const side of ['BUY','SELL'])for(const kind of ['INITIAL','FOLLOWUP']){
  const {command,position,market,sign}=fixture('15',side,kind),p=command.payload;
  p.analysisSnapshot.exitLockVersion='PINE_STEPLOCK_BE_TF15_V1';
  for(const [quote,target] of [[p.tp1,p.entry],[p.tp2,p.tp1],[p.tp3,p.tp2],[p.tp3+sign*10,p.tp2]]){
   position.currentPrice=quote;
   const out=P.management(market,[position],command,NOW);
   a.equal(Core.buildManagementCommand(out).payload.actions[0].activeSl,target);
  }
  position.activeSl=p.tp2;position.currentPrice=p.tp1;
  a.equal(Core.buildManagementCommand(P.management(market,[position],command,NOW)),null);
  for(const action of ['CLOSE_50_NOW','EXIT_ALL']){
   const out=P.management({...market,setupKey:p.analysisSnapshot.setupKey,positionManagement:{action}},[position],command,NOW);
   a.equal(Core.buildManagementCommand(out).payload.actions[0].percent,100);
  }
  p.strategyMode='TF2_SCALPING';p.analysisSnapshot.executionTimeframe='2';p.analysisSnapshot.analysisSopVersion='NORMAL_20261001_TF2_RIBBON_V1';
  a.equal(P.valid(command),false);
 }
});
