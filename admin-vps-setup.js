'use strict';
const H=require('./account-handover'),M=require('./managed-vps-accounts');
const fail=(message,status=409)=>Object.assign(new Error(message),{status});
function admin(actor){if(actor?.role!=='admin'||actor.status!=='active')throw fail('Admin aktif sahaja.',403);}
async function resolve(actor,store,login){admin(actor);login=String(login||'').trim();if(!login||login.length>254)throw fail('Isi ID ZenCore client yang sah.',400);const u=await M.findUser(store,login);if(!u||u.role!=='client')throw fail('ID client tidak dijumpai.',404);if(u.status!=='active')throw fail('Aktifkan akaun client dahulu.');return {ok:true,client:{id:u.id,loginId:login,state:H.state(u)}};}
async function connect(actor,handover,service,id){admin(actor);const u=await handover.row(id);if(u.status!=='active'||H.state(u)!=='ADMIN_SETUP')throw fail('Pautan baharu hanya dibuka dalam Admin Setup. Kosongkan/reset akaun dahulu.');return service.connectLocalEa(id);}
module.exports={resolve,connect};
