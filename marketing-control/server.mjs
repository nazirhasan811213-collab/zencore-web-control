import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const port=Number(process.env.MARKETING_PORT||8099);
const storePath=process.env.MARKETING_STORE||path.resolve('marketing-control-data.json');
const founderKey=process.env.MARKETING_FOUNDER_KEY||'';
const agentKey=process.env.MARKETING_AGENT_KEY||'';
const MAX_BODY=256*1024;
const validChannels=new Set(['facebook','instagram','tiktok']);
let state={items:[],audit:[],settings:{publishingEnabled:false}};
let queue=Promise.resolve();
const now=()=>new Date().toISOString();
const id=()=>crypto.randomUUID();
function safeEq(a,b){if(!a||!b)return false;const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&crypto.timingSafeEqual(x,y);}
const role=req=>{const h=req.headers.authorization||'';const token=h.startsWith('Bearer ')?h.slice(7):'';return safeEq(token,founderKey)?'founder':safeEq(token,agentKey)?'agent':null;};
async function initialize(){try{const obj=JSON.parse(await fs.readFile(storePath,'utf8'));if(Array.isArray(obj.items)&&Array.isArray(obj.audit))state={...state,...obj,settings:{publishingEnabled:false}};}catch(e){if(e.code!=='ENOENT')throw e;}}
async function persist(){const temp=storePath+'.tmp';await fs.mkdir(path.dirname(storePath),{recursive:true});await fs.writeFile(temp,JSON.stringify(state,null,2),{mode:0o600});await fs.rename(temp,storePath);}
function transaction(fn){const p=queue.then(async()=>{const result=fn();await persist();return result;});queue=p.catch(()=>{});return p;}
function send(res,status,data){res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(JSON.stringify(data));}
function audit(action,actor,target){state.audit.push({id:id(),at:now(),action,actor,target});if(state.audit.length>10000)state.audit=state.audit.slice(-10000);}
async function body(req){let raw='';for await (const chunk of req){raw+=chunk;if(raw.length>MAX_BODY)throw Object.assign(new Error('body too large'),{status:413});}try{return JSON.parse(raw||'{}');}catch{throw Object.assign(new Error('Invalid JSON'),{status:400});}}
function requireFounder(actor){if(actor!=='founder')throw Object.assign(new Error('Founder authorization required'),{status:403});}
function cleanText(x,max){return typeof x==='string'?x.trim().slice(0,max):'';}
export function createApp(){return http.createServer(async(req,res)=>{
 try{
  if(!founderKey||!agentKey||founderKey===agentKey){return send(res,503,{error:'Set distinct MARKETING_FOUNDER_KEY and MARKETING_AGENT_KEY'});}
  if(req.method==='GET'&&(req.url==='/'||req.url==='/dashboard')){const html=await fs.readFile(new URL('./dashboard.html',import.meta.url));res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store','content-security-policy':"default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; object-src 'none'; frame-ancestors 'none'",'x-frame-options':'DENY','x-content-type-options':'nosniff'});return res.end(html);}
  const actor=role(req);if(!actor)return send(res,401,{error:'Unauthorized'});
  const url=new URL(req.url,'http://localhost');
  if(req.method==='GET'&&url.pathname==='/health')return send(res,200,{ok:true,mode:'DRAFT_ONLY',publisherConnected:false});
  if(req.method==='GET'&&url.pathname==='/api/marketing/items')return send(res,200,{items:state.items});
  if(req.method==='GET'&&url.pathname==='/api/marketing/audit'){requireFounder(actor);return send(res,200,{audit:state.audit});}
  if(req.method==='GET'&&url.pathname==='/api/marketing/settings')return send(res,200,{publishingEnabled:false,requiresFounderApproval:true,publisherConnected:false});
  if(req.method==='POST'&&url.pathname==='/api/marketing/drafts'){
   const b=await body(req);const title=cleanText(b.title,160),caption=cleanText(b.caption,5000),channel=cleanText(b.channel,30);
   if(!title||!caption||!validChannels.has(channel))return send(res,400,{error:'title, caption and valid channel required'});
   const item=await transaction(()=>{const x={id:id(),title,caption,channel,assetUrl:cleanText(b.assetUrl,1500),status:'DRAFT',createdAt:now(),updatedAt:now(),approvedBy:null,approvedAt:null};state.items.push(x);audit('DRAFT_CREATED',actor,x.id);return x;});
   return send(res,201,{item});
  }
  const match=url.pathname.match(/^\/api\/marketing\/items\/([0-9a-f-]+)\/(submit|approve|reject|publish)$/);
  if(req.method==='POST'&&match){
   const [,itemId,action]=match;
   if(action!=='submit')requireFounder(actor);
   if(action==='publish')return send(res,423,{error:'Publishing locked: no live publisher connected. Founder approval alone does not publish.'});
   const result=await transaction(()=>{
    const x=state.items.find(x=>x.id===itemId);if(!x)throw Object.assign(new Error('Not found'),{status:404});
    const allowed={submit:['DRAFT'],approve:['PENDING_APPROVAL'],reject:['PENDING_APPROVAL']};
    if(!allowed[action].includes(x.status))throw Object.assign(new Error('Invalid status transition'),{status:409});
    x.status=action==='submit'?'PENDING_APPROVAL':action==='approve'?'APPROVED':'REJECTED';
    x.updatedAt=now();
    if(action==='approve'){x.approvedAt=now();x.approvedBy='founder';}
    audit(action.toUpperCase(),actor,x.id);return x;
   });
   return send(res,200,{item:result});
  }
  send(res,404,{error:'Not found'});
 }catch(e){send(res,e.status||500,{error:e.status?e.message:'Internal error'});}
});}
if(process.argv[1]&&path.resolve(process.argv[1])===path.resolve(new URL(import.meta.url).pathname)){await initialize();createApp().listen(port,'127.0.0.1',()=>console.log('ZenCore Marketing DRAFT ONLY on 127.0.0.1:'+port));}
export {initialize};
