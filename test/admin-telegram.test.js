'use strict';const {test}=require('node:test'),a=require('node:assert/strict'),M=require('../admin-telegram-service');
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0'),prefs=chat=>({telegramEnabled:true,verified:true,telegramId:chat});
const ibs=[{id:id(10),user_id:id(1)},{id:id(20),user_id:id(4)}],users=[{id:id(1),role:'ib',prefs:prefs('12345')},{id:id(2),role:'client',ib_referrer_id:id(10),status:'disabled',prefs:prefs('23456')},{id:id(3),role:'client',ib_referrer_id:id(10),prefs:{...prefs('34567'),telegramEnabled:false}},{id:id(4),role:'ib',prefs:prefs('45678')},{id:id(5),role:'client',ib_referrer_id:id(20),prefs:prefs('23456')},{id:id(6),role:'viewer',prefs:prefs('67890')}];
test('all, single, multi and IB scopes resolve exact recipients and deduplicate chats',()=>{
 a.equal(M.resolve(users,ibs,M.selection({mode:'ALL'})).targets.length,3);
 a.deepEqual(M.resolve(users,ibs,M.selection({mode:'SINGLE',userIds:[id(2)]})).targets.map(t=>t.id),[id(2)]);
 a.equal(M.resolve(users,ibs,M.selection({mode:'MULTI',userIds:[id(1),id(4)]})).targets.length,2);
 for(const [scope,expected] of [['IB_ONLY',[id(1)]],['CLIENTS',[id(2)]],['IB_AND_CLIENTS',[id(1),id(2)]]])a.deepEqual(M.resolve(users,ibs,M.selection({mode:'IB',ibId:id(10),ibScope:scope})).targets.map(t=>t.id),expected);
 a.equal(M.eligible(users[1]),true,'disabled account may receive an admin notice');a.equal(M.eligible(users[2]),false,'OFF preference is respected');
});
test('invalid or empty selection never expands to all; message text is bounded and distinct from trading',()=>{
 for(const x of [null,{},[],{mode:'BAD'},{mode:'SINGLE',userIds:[]},{mode:'SINGLE',userIds:[id(1),id(2)]},{mode:'MULTI',userIds:{}},{mode:'IB',ibId:id(10),ibScope:'ALL'}])a.throws(()=>M.selection(x),e=>e.status===400);
 a.throws(()=>M.resolve(users,ibs,M.selection({mode:'SINGLE',userIds:[id(99)]})));
 for(const message of ['', 'x'.repeat(3001),'bad\0text'])a.throws(()=>M.content({message},Date.now(),id(1)));
 const text=M.content({title:'Notis akaun',message:'Sila hubungi admin.'},Date.now(),id(1));a.match(text,/MESEJ ADMIN/);a.match(text,/Sila hubungi admin/);a.ok(text.length<4096);
});
test('only an active admin can use catalog, preview, send or history',async()=>{
 const s=new M.AdminTelegram({pool:{query:()=>{throw Error('must not query');}},alerts:{}});for(const actor of [{role:'client',status:'active'},{role:'ib',status:'active'},{role:'admin',status:'disabled'}])for(const fn of [()=>s.catalog(actor),()=>s.preview(actor,{}),()=>s.send(actor,id(1)),()=>s.history(actor)])await a.rejects(fn,e=>e.status===403);
});
