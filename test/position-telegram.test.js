'use strict';
const {test}=require('node:test'),a=require('node:assert/strict'),{groups,message,privateChat}=require('../position-telegram');
const at=1793800000000,setupId='11111111-1111-4111-8';
const p=(edit={})=>({ticket:'123',positionId:'456',symbol:'XAUUSD',side:'BUY',origin:'ZENCORE',strategyMode:'TF2_SCALPING',setupId,entry:4104,volume:.01,activeSl:4100,tp1:4105.5,tp2:4106.5,tp3:4107.5,openedAt:at-1000,...edit});
test('confirmed positions group by actual setup, TF and side; duplicate tickets and stale snapshots excluded',()=>{
 const g=groups([p(),p(),p({ticket:'124',positionId:'457',entry:4105}),p({ticket:'125',positionId:'458',strategyMode:'TF15_INTRA'})],at);
 a.equal(g.length,2);a.equal(g[0].positions.length,2);
 for(const bad of [{setupId:null},{entry:0},{openedAt:at-121000},{openedAt:at+6000},{symbol:'EURUSD'}])a.equal(groups([p(bad)],at).length,0);
 const m=groups([p({origin:'MANUAL',setupId:null})],at);a.equal(m.length,1);a.equal(m[0].manual,true);
});
test('one concise private Telegram message uses actual weighted fill and observed protection',()=>{
 const ps=[p(),p({positionId:'457',entry:4106,volume:.02})],g=groups(ps,at)[0];g.expected=3;
 const text=message(g,ps,at,'a'.repeat(64));a.match(text,/POSISI SUDAH DIBUKA/);a.match(text,/4,105\.333/);a.match(text,/2 • 0\.03 lot/);a.match(text,/Pelan: 3 layer/);a.match(text,/SL: 4,100\.00/);a.match(text,/MYT/);a.doesNotMatch(text,/Sudah lihat|callback|ringtone/);
 a.equal(privateChat('123456'),true);a.equal(privateChat('-100123456'),false);a.equal(privateChat('@publicgroup'),false);
});
test('heartbeat observation is authenticated, full, connected, owner scoped and cannot break execution',async()=>{
 const {MemoryAutoTradeStore}=require('../auto-trade-store'),{createAutoTradeService}=require('../auto-trade-service');const store=new MemoryAutoTradeStore(),observed=[];
 const service=createAutoTradeService({store,commandSigningKey:'test-signing-key-longer-than-thirty-two-characters',scalpingTimeframe:'2',now:()=>at,onConfirmedPositions:async s=>{observed.push(s);if(observed.length===2)throw Error('queue unavailable');}}),user='11111111-1111-4111-8111-111111111111';
 const c=await service.connectLocalEa(user),hb={accountMask:'****1234',serverMask:'****Demo',brokerMask:'****MT5',tradeMode:'DEMO',terminalTradeAllowed:true,accountTradeAllowed:true,expertTradeAllowed:true,connectorVersion:'1.4.0-ea-local',accountFingerprint:'a'.repeat(64),terminalConnected:true,positions:[p()]};
 await service.heartbeat(c.podToken,hb);a.equal(observed.length,1);a.equal(observed[0].userId,user);a.equal(observed[0].podId,c.podId);a.equal(observed[0].positions[0].setupId,setupId);
 await service.heartbeat(c.podToken,hb);a.equal(observed.length,2,'notification queue failure does not reject MT5 heartbeat');
 await service.heartbeat(c.podToken,{...hb,terminalConnected:false});await service.heartbeat(c.podToken,{...hb,positions:[p(),{ticket:'bad'}]});a.equal(observed.length,2);
 await a.rejects(service.heartbeat(c.podToken,{...hb,accountFingerprint:'b'.repeat(64)}));a.equal(observed.length,2);
});
