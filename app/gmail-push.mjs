import {createPublicKey,verify} from 'node:crypto';
import {syncGmail} from './gmail-sync.mjs';
let keyCache,keysUntil=0,keyRequest;
async function googleKeys(fetchImpl){
 if(keyCache&&keysUntil>Date.now())return keyCache;
 if(!keyRequest)keyRequest=(async()=>{const r=await fetchImpl('https://www.googleapis.com/oauth2/v3/certs',{signal:AbortSignal.timeout(5000),redirect:'error'});if(!r.ok)throw Error('Google signing keys unavailable');const d=await r.json();if(!Array.isArray(d.keys))throw Error('Google signing keys unavailable');keyCache=d.keys;keysUntil=Date.now()+Math.min(3600,Number(r.headers.get('cache-control')?.match(/max-age=(\d+)/)?.[1])||300)*1000;return keyCache;})().finally(()=>{keyRequest=null;});
 return keyRequest;
}
export async function verifyPushToken(token,{audience,email,fetchImpl=fetch,keys,now=Date.now()}={}){
 if(!audience||!email||typeof token!=='string'||token.length>16384)return false;
 try{const parts=token.split('.');if(parts.length!==3)return false;const h=JSON.parse(Buffer.from(parts[0],'base64url')),p=JSON.parse(Buffer.from(parts[1],'base64url'));if(h.alg!=='RS256'||typeof h.kid!=='string'||!['accounts.google.com','https://accounts.google.com'].includes(p.iss)||p.aud!==audience||p.email!==email||p.email_verified!==true||!Number.isFinite(p.exp)||p.exp*1000<=now||!Number.isFinite(p.iat)||p.iat*1000>now+30000)return false;const key=(keys||await googleKeys(fetchImpl)).find(k=>k.kid===h.kid&&k.kty==='RSA');return !!key&&verify('RSA-SHA256',Buffer.from(parts[0]+'.'+parts[1]),createPublicKey({key,format:'jwk'}),Buffer.from(parts[2],'base64url'));}catch{return false;}
}
export async function ensureGmailWatch({store,gmail,topic}){
 if(!topic)return {configured:false};if(!/^projects\/[a-z0-9-]+\/topics\/[A-Za-z][A-Za-z0-9._~+%-]*$/.test(topic))throw Error('Invalid Gmail Pub/Sub topic');
 const s=await store.read();if(s.gmailWatch?.topic===topic&&s.gmailWatch.renewedAt>Date.now()-86400000&&Number(s.gmailWatch.expiration)>Date.now()+86400000)return {configured:true};
 await gmail.verifyMailbox();const result=await gmail.request('watch',{method:'POST',body:{topicName:topic}});if(!/^\d+$/.test(result.historyId||'')||!Number.isFinite(Number(result.expiration)))throw Error('Gmail watch receipt incomplete');
 await store.transaction(s=>{s.gmailWatch={topic,historyId:result.historyId,expiration:result.expiration,renewedAt:Date.now()};});return {configured:true};
}
export function createGmailPushHandler({env,getRuntime,verifyToken=verifyPushToken}){return async request=>{
 const respond=(status,body)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
 if(request.method!=='POST')return respond(405,{error:'POST required'});
 if(!env.GMAIL_PUSH_AUDIENCE||!env.GMAIL_PUSH_SERVICE_ACCOUNT||!env.GMAIL_PUSH_SUBSCRIPTION)return respond(503,{error:'Gmail push is not configured'});
 const token=request.headers.get('authorization')?.match(/^Bearer (.+)$/)?.[1];if(!await verifyToken(token,{audience:env.GMAIL_PUSH_AUDIENCE,email:env.GMAIL_PUSH_SERVICE_ACCOUNT}))return respond(401,{error:'Push verification failed'});
 let body,data;try{const chunks=[];let size=0;for await(const chunk of request.body||[]){size+=chunk.length;if(size>65536)return respond(413,{error:'Notification too large'});chunks.push(Buffer.from(chunk));}body=JSON.parse(Buffer.concat(chunks));if(body.subscription!==env.GMAIL_PUSH_SUBSCRIPTION||typeof body.message?.messageId!=='string'||body.message.messageId.length>200||typeof body.message.data!=='string')throw Error();data=JSON.parse(Buffer.from(body.message.data,'base64'));if(data.emailAddress?.toLowerCase()!=='info@rugtomize.co'||!/^\d+$/.test(data.historyId||''))throw Error();}catch{return respond(400,{error:'Invalid notification'});}
 try{const app=await getRuntime();const duplicate=await app.store.transaction(s=>{s.gmailPushReceipts||={};if(s.gmailPushReceipts[body.message.messageId])return true;s.gmailPushReceipts[body.message.messageId]={at:new Date().toISOString(),historyId:data.historyId};const ids=Object.keys(s.gmailPushReceipts);for(const id of ids.slice(0,Math.max(0,ids.length-1000)))delete s.gmailPushReceipts[id];s.gmailPushPending={historyId:data.historyId,receivedAt:new Date().toISOString()};return false;});
  // Work stays in the existing leased Gmail executor. If busy or interrupted,
  // durable history discovery resumes at the normal cron; never skip its cursor.
  if(!duplicate&&app.gmail?.configured())try{await syncGmail({store:app.store,gmail:app.gmail,limit:12,pages:1,deadline:Date.now()+15000,labelSync:app.env.GMAIL_LABEL_SYNC==='1'});}catch{}
  return respond(200,{ok:true});
 }catch{return respond(503,{error:'Push storage unavailable; retry delivery'});}
};}
