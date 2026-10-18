'use strict';
const test=require('node:test'),a=require('node:assert/strict');
const M=require('../admin-user-trade-service'),B=require('../broker-monitor-metadata');
const {MemoryAutoTradeStore}=require('../auto-trade-store'),{MemoryAuthStore}=require('../auth-store');
const {createAutoTradeService,tokenHash}=require('../auto-trade-service');
const DAY=86400000;
test('server reference settings are monitoring only, bounded and reject executable/control text',()=>{
 a.deepEqual(M.settings({inactiveDays:14,referenceServers:['Broker-Live','Broker-Live']}),{inactiveDays:14,referenceServers:['Broker-Live']});
 for(const input of [{inactiveDays:0,referenceServers:[]},{inactiveDays:366,referenceServers:[]},{inactiveDays:7,referenceServers:['x\nsecret']},{inactiveDays:7,referenceServers:['<script>alert(1)</script>']}])a.throws(()=>M.settings(input));
 a.equal(M.settings({inactiveDays:7,referenceServers:[]}).referenceServers.length,0);
});
test('current identity gates full server; stale account reports never identify new account',()=>{
 const now=Date.now(),client={id:'a',displayName:'A',lastLoginAt:now-10*DAY};
 const connection={lastSeenAt:now-31000,connection:{online:true},control:{desiredState:'STOPPED'},tradeMode:'REAL',tradingActivity:{lastTradeAt:now-8*DAY}};
 const detail={podId:'p',accountFingerprint:'f',lastActivationAt:now-9*DAY,brokerRecord:{podId:'p',accountFingerprint:'f',mt5ServerName:'OtherBroker-Live',reportedAt:now-1000}};
 const r=M.row(client,connection,detail,M.defaults(),now);a.equal(r.mt5ServerName,'OtherBroker-Live');a.equal(r.brokerStatus,'OTHER');a.equal(r.online,false);a.equal(r.ibBrokerRelationship,'NOT_VERIFIED_BY_BROKER');a.equal(r.flags.loginInactive,true);a.equal(r.flags.tradeInactive,true);a.equal(r.flags.activationInactive,true);
 a.equal(M.row(client,connection,{...detail,podId:'new'},M.defaults(),now).mt5ServerName,null);
 a.equal(M.row(client,connection,{...detail,accountFingerprint:'new'},M.defaults(),now).brokerStatus,'MISSING');
 a.equal(M.row(client,{...connection,control:{desiredState:'ON'}},detail,M.defaults(),now).flags.activationInactive,false);
 a.equal(M.row(client,connection,detail,{inactiveDays:7,referenceServers:['OtherBroker-Live']},now).brokerStatus,'REFERENCE');
});
test('trade/activation last timestamps count only successful commands, both transports and one user',async()=>{
 const s=new MemoryAutoTradeStore(),now=Date.now();
 s.commands.set('p',[{userId:'a',type:'SYSTEM_ON',status:'EXECUTED',createdAt:now-500},{userId:'a',type:'SYSTEM_ON',status:'REJECTED',createdAt:now},{userId:'b',type:'SYSTEM_ON',status:'EXECUTED',createdAt:now}]);
 s.hostedCommands.set('h',[{userId:'a',type:'SYSTEM_ON',status:'EXECUTED',createdAt:now-100},{userId:'a',type:'SYSTEM_STOP',status:'EXECUTED',createdAt:now-50}]);
 const r=await s.userTradeMonitorDetails('a');a.equal(r.lastActivationAt,now-100);a.equal(r.lastStopAt,now-50);a.equal(r.brokerRecord,null);
});
test('admin-only snapshot coalesces reads; user errors are UNKNOWN, never no-trade flags',async()=>{
 let calls=0;const authStore=new MemoryAuthStore();
 const m=M.createUserTradeMonitoring({auth:{store:authStore,service:{adminClients:async()=>{calls++;return [{id:'a',displayName:'A'},{id:'b',displayName:'B'}];}}},trading:{ready:true,service:{userTradeMonitoring:async id=>{if(id==='b')throw Error('PASSWORD_PRIVATE');return {connection:{control:{},tradingActivity:{}},podId:null};}}}});
 for(const role of ['client','ib'])await a.rejects(()=>m.snapshot({role}),{code:'FORBIDDEN'});a.equal(calls,0);
 const [x,y]=await Promise.all([m.snapshot({role:'admin'}),m.snapshot({role:'admin'})]);a.equal(calls,1);a.equal(x.observedAt,y.observedAt);a.equal(x.summary.unknown,1);a.equal(x.summary.neverTrade,1);a.deepEqual(x.rows[1].flags,{});a.doesNotMatch(JSON.stringify(x),/PASSWORD_PRIVATE/);
 await m.save({role:'admin'},{inactiveDays:30,referenceServers:['Admin-Live']});a.equal((await m.snapshot({role:'admin'})).settings.inactiveDays,30);
});
test('metadata endpoint binds token/fingerprint/current heartbeat and cannot alter trade control',async()=>{
 const s=new MemoryAutoTradeStore(),now=Date.now(),token='zcpod_'+'m'.repeat(48),fp='a'.repeat(64);
 const pod={id:'p',userId:'a',tokenHash:tokenHash(token),ownershipMode:'TRADER_OWNED_EA_LOCAL',accountFingerprint:fp,lastSeenAt:now,tradeMode:'REAL'};
 s.podsByUser.set('a',pod);s.podsByToken.set(pod.tokenHash,pod);
 const svc=createAutoTradeService({store:s,now:()=>now,commandSigningKey:'test-signing-key-at-least-thirty-two-bytes'}),input={version:B.VERSION,mt5ServerName:'AnyBroker-Real',accountFingerprint:fp};
 a.equal((await svc.reportBrokerMetadata(token,input)).updated,true);a.equal((await svc.reportBrokerMetadata(token,input)).updated,false);
 const r=await s.getBrokerMonitorRecord('a');a.equal(r.mt5ServerName,'AnyBroker-Real');a.equal((await s.listAudit('a')).length,1);a.equal(s.commands.size,0);a.equal(await s.getProfile('a'),null);
 await a.rejects(()=>svc.reportBrokerMetadata(token,{...input,accountFingerprint:'b'.repeat(64)}),{code:'BROKER_IDENTITY_NOT_CURRENT'});
 await a.rejects(()=>svc.reportBrokerMetadata(token,{...input,password:'DO_NOT_ACCEPT'}),{code:'INVALID_BROKER_METADATA'});
 pod.lastSeenAt=now-31000;await a.rejects(()=>svc.reportBrokerMetadata(token,input),{code:'BROKER_IDENTITY_NOT_CURRENT'});
 await a.rejects(()=>svc.reportBrokerMetadata('invalid',input),{code:'INVALID_POD_TOKEN'});
});
test('password/server credentials remain forbidden in ordinary execution heartbeat',()=>{
 a.equal(require('../auto-trade-core').normaliseHeartbeat({server:'Broker-Live'}).ok,false);
 a.equal(B.report({version:B.VERSION,mt5ServerName:'Broker-Live',accountFingerprint:'a'.repeat(64),account:'123456'}),null);
});

test('PostgreSQL Date login timestamps retain activity classification',()=>{
 const now=Date.now(),c={id:'pg',lastLoginAt:new Date(now-10*DAY)};
 const r=M.row(c,{control:{},tradingActivity:{}},{},M.defaults(),now);
 a.equal(r.lastLoginAt,now-10*DAY);a.equal(r.flags.neverLogin,false);a.equal(r.flags.loginInactive,true);
});
