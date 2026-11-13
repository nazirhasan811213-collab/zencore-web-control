'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
const prefix=fs.readFileSync(__dirname+'/sop-v6.test.js','utf8').split("\nfor(const tf of ['2','15'])for(const side")[0];
const {fixture}=new Function('require','__dirname',prefix+';return {fixture};')(require,__dirname);
const {MemoryAutoTradeStore}=require('../auto-trade-store');
const {createAutoTradeService,tokenHash}=require('../auto-trade-service');
const python=`import json,sys,tempfile
from pathlib import Path
sys.path.insert(0,'ea-local-connector')
from connector import Runner
from protocol import atomic_write,encode_fields,read_fields
from test_protocol import local_heartbeat
from unittest.mock import patch
x=json.load(sys.stdin)
with tempfile.TemporaryDirectory() as folder:
 cfg={**x['identity'],'channel':folder,'podToken':'offline-test','commandSigningKey':x['key']}
 hb={**local_heartbeat(),**x['identity'],'writtenAt':x['now'],'strategyExecutionVersion':'TF2_TF15_V1','fillRiskVersion':'FILL_PRICE_ATR_V1','directEntryPolicy':'PINE_DIRECT_FILL_GAP4_V1'}
 atomic_write(Path(folder)/'heartbeat.tsv',encode_fields(hb))
 runner=Runner(cfg,lambda _:None,background_lease=False)
 fetches=[]
 class Api:
  def request(self,url,data=None,token=None):
   if url.endswith('/heartbeat'):return {'desiredState':'ON'}
   if url.endswith('/next'):
    fetches.append(1)
    return {'command':x['command'],'serverTime':x['now']}
   raise RuntimeError('unexpected ACK: '+str(data))
 runner.api=Api()
 with patch('protocol.time.time',return_value=x['now']/1000),patch('connector.time.time',return_value=x['now']/1000):
  runner.cycle()
  runner.cycle()
 assert len(fetches)==1, 'pending EA command must not be fetched or replaced twice'
 print(json.dumps({'fields':read_fields(Path(folder)/'command.tsv'),'lease':read_fields(Path(folder)/'lease.tsv')}))
`;
for(const delayed of [false,true])for(const tf of ['2','15'])for(const side of ['BUY','SELL'])test(`native V7 delayed=${delayed} TF${tf} ${side} reaches real Connector mailbox with unchanged plan and account binding`,async()=>{
 const {f,ingest}=fixture(tf,side),sign=side==='BUY'?1:-1;
 Object.assign(f.row[66],{entryPolicyVersion:'PINE_NATIVE_SOLID_ENTRY_V7',nativeSolid:{version:'NATIVE_SOLID_LABEL_V1',barTime:f.row[1],pulse:true,basis:4100-sign,rsi:50}});
 const symbol=delayed?'US500.CASH':'XAUUSD', layers=delayed?12:3;
 f.row[0]=symbol;
 const market=ingest();assert.ok(market);
 if(delayed){f.now+=5*60*1000;market.strategyNormal.state='WAIT';market.strategyNormal.sop.gates=[];}
 const store=new MemoryAutoTradeStore(),id=crypto.randomUUID(),podId=crypto.randomUUID(),token='zcpod_'+'x'.repeat(48),hash=tokenHash(token);
 const identity={account:'12345678',server:'InterStellarFinancial-Demo',tradeMode:'DEMO',podId,eaSession:'1'.repeat(32)};
 const pod={id:podId,userId:id,tokenHash:hash,ownershipMode:'TRADER_OWNED_EA_LOCAL',accountFingerprint:crypto.createHash('sha256').update(JSON.stringify([identity.server,identity.account,identity.tradeMode])).digest('hex'),lastSeenAt:f.now,tradeMode:'DEMO',terminalTradeAllowed:true,accountTradeAllowed:true,expertTradeAllowed:true,demoExecutionUnlocked:true,connectorVersion:'1.4.0-ea-local',symbolSpecs:{}};
 store.podsByUser.set(id,pod);store.podsByToken.set(hash,pod);
 const svc=createAutoTradeService({store,now:()=>f.now,scalpingTimeframe:'2',allowMt5Symbols:true,localEaExecutionUserIds:[id],commandSigningKey:'test-only-handoff-key-longer-than-thirty-two-bytes',getLatestMarket:()=>market});
 await svc.saveSettings(id,{capitalUsd:1000,lotPerLayer:.02,layers,symbols:[symbol],strategyMode:tf==='15'?'TF15_INTRA':'TF2_SCALPING',modeSettings:{TF2_SCALPING:{gold:{enabled:true,lotPerLayer:.02,layers},fx:{enabled:true,lotPerLayer:.02,layers}},TF15_INTRA:{gold:{enabled:true,lotPerLayer:.02,layers},fx:{enabled:true,lotPerLayer:.02,layers}}},riskAcknowledged:true});
 await svc.heartbeat(token,{accountFingerprint:pod.accountFingerprint,accountBindingVersion:'ACCOUNT_SESSION_V1',accountExecutionVersion:'REAL_DEMO_V1',eaSession:identity.eaSession,accountMask:'****5678',serverMask:'****Demo',brokerMask:'****MT5',tradeMode:'DEMO',terminalConnected:true,terminalTradeAllowed:true,accountTradeAllowed:true,expertTradeAllowed:true,demoExecutionUnlocked:true,connectorVersion:'1.4.0-ea-local',positions:[],symbolSpecs:[],directEntryPolicy:'PINE_DIRECT_FILL_GAP4_V1',expandedEntryPolicy:true});
 await store.setControl(id,{desiredState:'ON',effectiveState:'ON'});
 const read=store.nextCommandForPod.bind(store);
 let checked;
 const checkedEmpty=new Promise(resolve=>{checked=resolve;});
 store.nextCommandForPod=async (...args)=>{
  const result=await read(...args);
  if(!result)checked();
  return result;
 };
 const pending=svc.nextCommand(token,500);
 await checkedEmpty;
 assert.equal((await svc.dispatchMarkets([market])).queued,1);
 assert.equal((await svc.dispatchMarkets([market])).queued,0);
 const {command}=await pending;assert.equal(command.payload.analysisSnapshot.executionPolicy,'PINE_DIRECT_FILL_GAP4_V1');assert.ok(command.expiresAt>f.now+86400000);assert.ok(command,'a waiting Connector must receive the newly queued entry');
 const envelope=JSON.parse(Buffer.from(command.signedEnvelope,'base64url'));for(const k of ['id','type','payload','createdAt','expiresAt'])assert.deepEqual(JSON.parse(JSON.stringify(command[k])),envelope[k],k);
 const result=spawnSync('python3',['-c',python],{input:JSON.stringify({identity,key:svc.commandSigningKeyForPod(podId),command,now:f.now}),encoding:'utf8'});
 assert.equal(result.status,0,result.stderr);
 const {fields,lease}=JSON.parse(result.stdout);
 assert.equal(fields.id,command.id);assert.equal(fields.side,side);assert.equal(fields.executionTimeframe,tf);
 assert.equal(Number(fields.lot),.02);assert.equal(Number(fields.layers),layers);assert.equal(fields.symbol,symbol);
 for(const k of ['entry','sl','tp1','tp2','tp3'])assert.equal(Number(fields[k]),command.payload[k]);
 for(const k of ['account','server','tradeMode','podId','eaSession']){assert.equal(fields[k],identity[k]);assert.equal(lease[k],identity[k]);}
 assert.equal(lease.desiredState,'ON');assert.ok(Number(fields.expiresAt)<=command.expiresAt);
});
