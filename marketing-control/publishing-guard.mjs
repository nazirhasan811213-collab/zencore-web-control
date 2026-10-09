// Founder-gated publishing contracts. This module intentionally has NO social HTTP calls.
// A future authenticated adapter must consume only a matching one-time grant and must
// never infer permission from content approval alone.
import crypto from 'node:crypto';
export const channelSet=new Set(['facebook','instagram','tiktok']);
export function fingerprint(item){
 const canon=JSON.stringify({channel:item.channel,title:item.title,caption:item.caption,assetUrl:item.assetUrl||'',scheduledFor:item.scheduledFor||null});
 return crypto.createHash('sha256').update(canon).digest('hex');
}
export function makeGrant(item,actor,{destination,expiresInMinutes=30}={}){
 if(actor!=='founder')throw new Error('Founder required');
 if(item.status!=='APPROVED'||item.approvedBy!=='founder')throw new Error('Content not approved');
 if(!channelSet.has(item.channel)||destination!==item.channel)throw new Error('Channel mismatch');
 if(!Number.isInteger(expiresInMinutes)||expiresInMinutes<1||expiresInMinutes>60)throw new Error('Invalid expiration');
 return {grantId:crypto.randomUUID(),itemId:item.id,destination,contentHash:fingerprint(item),expiresAt:new Date(Date.now()+expiresInMinutes*60000).toISOString(),used:false};
}
export function verifyGrant(grant,item,destination){
 return !!grant&&!grant.used&&grant.itemId===item.id&&item.status==='APPROVED'&&item.approvedBy==='founder'&&grant.destination===destination&&grant.contentHash===fingerprint(item)&&Date.parse(grant.expiresAt)>Date.now();
}
