'use strict';
const DURATION_MS=14*24*60*60*1000;
const deadline=u=>u?.accessExpiresAt??u?.access_expires_at;
function expired(u,now=Date.now()){
 return (u?.role||'client')==='client'&&deadline(u)!=null&&new Date(deadline(u)).getTime()<=now;
}
function allowed(u,now=Date.now()){return !!u&&u.status==='active'&&!expired(u,now);}
function fields(u,now=Date.now()){
 const limited=(u.role||'client')==='client';
 return {accessActivatedAt:limited?(u.accessActivatedAt??u.access_activated_at??null):null,
  accessExpiresAt:limited?(deadline(u)??null):null,accessExpired:expired(u,now),accessDurationDays:limited?14:null};
}
function activate(u,now=Date.now()){
 u.access_activated_at=new Date(now);u.access_expires_at=new Date(now+DURATION_MS);
}
function roleChanged(u,oldRole){
 if(u.role!=='client'){u.access_activated_at=null;u.access_expires_at=null;}
 else if(oldRole!=='client'&&u.status==='active')activate(u);
}
module.exports={DURATION_MS,expired,allowed,fields,activate,roleChanged};
