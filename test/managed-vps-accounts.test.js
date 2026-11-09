'use strict';
const {test}=require('node:test'),a=require('node:assert/strict'),M=require('../managed-vps-accounts'),{MemoryAuthStore}=require('../auth-store'),{createAuthService}=require('../auth-service'),{hashPassword}=require('../auth-core');
test('reserved managed IDs normalize narrowly; email login and existing password rules stay intact',async()=>{
 for(let i=1;i<=40;i++){a.equal(M.loginEmail(' ZCuser '+i+' '),'zcuser'+i+'@managed.zencore.invalid');a.equal(M.loginId(M.loginEmail('zcuser'+i)),'ZCuser '+i);}
 for(const id of ['ZCuser 0','ZCuser 41','ZCuser 01','ZCuser 1 extra','admin'])a.equal(M.number(id),null);
 const store=new MemoryAuthStore();await store.init();await store.createUser({displayName:'ZCuser 1',email:M.loginEmail('zcuser1'),passwordHash:await hashPassword('zc123')});
 const auth=createAuthService({store});const session=await auth.login({email:'ZCuser 1',password:'zc123'});a.equal(session.user.loginId,'ZCuser 1');a.equal(session.user.role,'client');
 await a.rejects(auth.login({email:'ZCuser 2',password:'zc123'}),{code:'INVALID_CREDENTIALS'});
 a.deepEqual(await M.bootstrap(null,{batch:'not-authorized'}),{enabled:false,count:0,created:0});
});
