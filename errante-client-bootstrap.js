'use strict';
const {configureErrante}=require('./errante-bootstrap');
const allowed=new Map([['rezalie@example.invalid','Rezalie'],['aron@example.invalid','Aron']]);
async function provisionErranteClients(store,env){
 const value=String(env.ZENCORE_ERRANTE_CLIENT_BOOTSTRAP||'');
 if(!value)return {created:0,existing:0};
 configureErrante(env);
 let rows;try{rows=JSON.parse(value);}catch{throw new Error('ERRANTE_CLIENT_BOOTSTRAP_INVALID');}
 if(!Array.isArray(rows)||rows.length!==2||new Set(rows.map(r=>r?.email)).size!==2||rows.some(r=>!allowed.has(r?.email)||!/^scrypt\$16384\$8\$1\$[\w-]+\$[\w-]+$/.test(r.passwordHash||'')))throw new Error('ERRANTE_CLIENT_BOOTSTRAP_INVALID');
 let created=0,existing=0;
 for(const row of rows){
  const current=await store.findUserForLogin(row.email);
  if(current){if(current.role!=='client')throw new Error('ERRANTE_CLIENT_ACCOUNT_CONFLICT');existing++;continue;}
  try{await store.createUser({displayName:allowed.get(row.email),email:row.email,passwordHash:row.passwordHash,role:'client',status:'active'});created++;}
  catch(error){
   if(error.code!=='EMAIL_EXISTS')throw error;
   const found=await store.findUserForLogin(row.email);
   if(found?.role!=='client')throw new Error('ERRANTE_CLIENT_ACCOUNT_CONFLICT');existing++;
  }
 }
 // Existing accounts are never reset, reactivated or renewed on restart.
 return {created,existing};
}
module.exports={provisionErranteClients};
