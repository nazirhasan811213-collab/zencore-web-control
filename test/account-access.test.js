'use strict';
const {test}=require('node:test'),a=require('node:assert/strict');
const Access=require('../account-access'),{MemoryAuthStore}=require('../auth-store'),{createAuthService}=require('../auth-service'),{hashPassword}=require('../auth-core');
test('14-day boundary and exemption depend on current role',()=>{
 const u={role:'client',status:'active',access_expires_at:new Date(1000)};
 a.equal(Access.allowed(u,999),true);a.equal(Access.allowed(u,1000),false);
 for(const role of ['ib','admin','viewer']){a.equal(Access.allowed({...u,role},2000),true);a.equal(Access.fields({...u,role}).accessExpiresAt,null);}
 a.equal(Access.allowed({...u,status:'disabled',role:'ib'},0),false);
});
test('expired session/login blocked; only admin renews from now; promotion removes expiry',async()=>{
 const store=new MemoryAuthStore(),service=createAuthService({store,secureCookies:false}),password='TestClient2026!';
 const admin=await store.createUser({displayName:'Admin',email:'a@access.test',role:'admin',passwordHash:await hashPassword(password)});
 const ib=await store.createIbAccount({displayName:'Partner',email:'ib@access.test',code:'access-ib',passwordHash:await hashPassword(password)});
 const user=await store.createUser({displayName:'Client',email:'c@access.test',passwordHash:await hashPassword(password),ibReferrerId:ib.referrer.id});
 const row=store.usersById.get(user.id);a.equal(+row.access_expires_at-(+row.access_activated_at),Access.DURATION_MS);
 const login=await service.login({email:user.email,password}),request={headers:{cookie:service.createCookie(login.token)}};
 a.ok(await service.sessionFromRequest(request));row.access_expires_at=new Date(Date.now()-1);
 a.equal(await service.sessionFromRequest(request),null);await a.rejects(service.login({email:user.email,password}),{code:'ACCOUNT_EXPIRED'});
 await a.rejects(service.setAdminClientActive(ib.user,user.id,true),{code:'FORBIDDEN'});
 await a.rejects(service.setIbClientActive(ib.user,user.id,true));a.equal(await store.setClientActiveForIb(ib.user.id,user.id,true),null);
 const before=Date.now(),renewed=await service.setAdminClientActive(admin,user.id,true);a.equal(renewed.status,'active');a.ok(+row.access_activated_at>=before);a.equal(+row.access_expires_at-(+row.access_activated_at),Access.DURATION_MS);a.equal(store.accessRenewals[0].adminId,admin.id);a.equal(await service.sessionFromRequest(request),null);
 const newLogin=await service.login({email:user.email,password});a.ok(newLogin.token);
 const originalExpiry=+row.access_expires_at;await store.setClientActiveForIb(ib.user.id,user.id,false);await store.setClientActiveForIb(ib.user.id,user.id,true);a.equal(+row.access_expires_at,originalExpiry,'IB enable does not renew');
 row.access_expires_at=new Date(0);const promoted=await service.promoteAdminClientToIb(admin,user.id,{code:'new-access-ib'});a.equal(promoted.user.role,'ib');a.equal(row.access_expires_at,null);a.ok((await service.login({email:user.email,password})).token);
 await store.setUserRole(user.id,'client');a.ok(+row.access_expires_at>Date.now());
});
test('new pending users begin their 14 days only after admin approval',async()=>{
 const store=new MemoryAuthStore(),p=await store.createUser({displayName:'Pending',email:'p@access.test',passwordHash:'test',status:'pending'});
 const row=store.usersById.get(p.id);a.equal(row.access_expires_at,undefined);a.equal(await store.renewClientAccessForAdmin(p.id),null);
 await store.reviewRegistration(p.id,null,'approve','');a.equal(+row.access_expires_at-(+row.access_activated_at),Access.DURATION_MS);
});
test('expired account blocks entry dispatch but leaves management path available',async()=>{
 const {createAutoTradeService}=require('../auto-trade-service');const audits=[];
 const store={listOnProfiles:async()=>[{userId:'test'}],appendAudit:async(...args)=>audits.push(args),listManagedProfiles:async()=>[]};
 const service=createAutoTradeService({store,commandSigningKey:'this-is-a-long-test-signing-key-123456789',allowDemoExecution:true,entryAccessAllowed:async()=>false});
 await service.dispatchMarkets([{symbol:'XAUUSD',timeframe:'2',strategyNormal:{solid:true}}]);a.equal(audits[0][2].reason,'ACCOUNT_ACCESS_EXPIRED_OR_DISABLED');
});
test('editing profile and restarting never renew a client period',async()=>{
 const store=new MemoryAuthStore(),u=await store.createUser({displayName:'Client',email:'edit@access.test',passwordHash:'test'}),row=store.usersById.get(u.id),deadline=+row.access_expires_at;
 await store.updateOwnClientProfile(u.id,{displayName:'Client',email:'edited@access.test',phone:'0123456789',icNumber:null});await store.init();a.equal(+row.access_expires_at,deadline);
});
