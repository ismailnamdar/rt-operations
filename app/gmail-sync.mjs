import {randomUUID} from 'node:crypto';
import {threadVersion,emailAddress} from './gmail.mjs';
import {fingerprint} from './shipping.mjs';

export const UNREAD_QUERY='is:unread -in:trash -in:sent -in:drafts';
const SAMPLE_QUERY='-in:trash -in:spam -in:sent -in:drafts';
const RECOVERY_QUERY='-in:trash -in:sent -in:drafts';
const header=(m,key)=>m.payload?.headers?.find(h=>h.name.toLowerCase()===key.toLowerCase())?.value||'';
const idOK=id=>typeof id==='string'&&/^[A-Za-z0-9_-]+$/.test(id);
const now=()=>new Date().toISOString();
function incoming(m,mailbox){if((m.labelIds||[]).some(x=>['TRASH','SENT','DRAFT'].includes(x)))return false;const from=header(m,'From'),address=from.match(/<([^<>]+)>/)?.[1]||from.trim();return address.toLowerCase()!==mailbox.toLowerCase();}
function plain(part){if(!part)return '';if(part.mimeType==='text/plain'&&part.body?.data)return Buffer.from(part.body.data,'base64url').toString('utf8');return (part.parts||[]).map(plain).filter(Boolean).join('\n');}
function initialize(s){s.gmailSync||={pending:{},phase:'initial',unread:{complete:false,count:0},sampleComplete:false};s.gmailSync.pending||={};s.gmailCarryover||={};s.gmailConversations||={};return s.gmailSync;}
function enqueue(s,items){const sync=initialize(s);for(const item of items||[]){if(!idOK(item.threadId))throw Error('Gmail returned an invalid thread identity');sync.pending[item.threadId]||={queuedAt:now(),attempts:0};}}

// Every incoming message retains its own obligation. Read/archive changes cannot resolve it.
export function mergeGmailThread(s,thread,mailbox){
 if(!idOK(thread?.id)||!Array.isArray(thread.messages)||thread.messages.some(m=>!idOK(m.id)||m.threadId!==thread.id))throw Error('Gmail conversation is incomplete');
 initialize(s);const messages=thread.messages.filter(m=>incoming(m,mailbox));
 for(const m of messages)s.gmailCarryover[m.id]||={messageId:m.id,threadId:thread.id,status:'unresolved',discoveredAt:now(),obligation:'Review incoming inquiry',nextAction:'Review the full current conversation; no automated send or production action.'};
 const unresolved=Object.values(s.gmailCarryover).filter(x=>x.threadId===thread.id&&x.status==='unresolved');
 const sourceVersion=threadVersion(thread);const prior=s.gmailConversations[thread.id];
 s.gmailConversations[thread.id]={id:thread.id,sourceVersion,checkedAt:now(),messages:thread.messages.filter(m=>!(m.labelIds||[]).includes('TRASH')).map(m=>({id:m.id,date:new Date(Number(m.internalDate)||0).toISOString(),from:header(m,'From'),to:header(m,'To'),subject:header(m,'Subject'),labels:m.labelIds||[],text:(plain(m.payload)||m.snippet||'').slice(0,100000)}))};
 if(!unresolved.length)return;
 const latest=messages.at(-1);if(!latest){for(const entry of unresolved)entry.blocker='Source was removed or moved to Trash; owner review required.';return;}
 const source=header(latest,'From'),recipient=source.match(/<([^<>]+)>/)?.[1]||source.trim();let validRecipient;try{validRecipient=emailAddress(recipient);}catch{}
 const subject=header(latest,'Subject'),reviewId='gmail-'+thread.id,existing=s.snapshot.results.review.find(x=>x.id===reviewId);
 const orderMatch=subject.match(/(?:#|order\s*#?\s*)(\d{4,8})\b/i);
 const item={...existing,id:reviewId,type:'reply',status:'pending',isTest:false,threadId:thread.id,sourceMessageId:latest.id,sourceVersion,recipient:validRecipient||'',customerEmail:validRecipient||'',customer:source.replace(/<[^>]+>/,'').replace(/^"|"$/g,'').trim()||recipient,title:subject||'(No subject)',customerQuestion:plain(latest.payload)||latest.snippet||'(Open the conversation to inspect non-text content)',order:orderMatch?.[1],unread:messages.some(m=>(m.labelIds||[]).includes('UNREAD')),gmailManaged:true,category:'needs_review',responseGroupId:'other',body:existing?.body||'',sendBlocked:true,requiresInput:true,replyDisposition:{reason:'Live Gmail inquiry. Review the full conversation and prepare an exact reply; sending is disabled.'},receivedAt:new Date(Number(latest.internalDate)||0).toISOString(),conversation:s.gmailConversations[thread.id].messages};
 // An unchanged source must not invalidate an owner's saved edits on every polling pass.
 item.version=existing&&prior?.sourceVersion===sourceVersion?existing.version:fingerprint({threadId:thread.id,sourceVersion,body:item.body});
 if(existing)Object.assign(existing,item);else s.snapshot.results.review.push(item);
 for(const entry of unresolved){entry.reviewId=reviewId;entry.lastVerifiedAt=now();entry.blocker=validRecipient?null:'Sender address needs owner verification';}
 s.snapshot.results.updatedAt=now();s.snapshot.results.sourceLabel='Live Gmail — sending disabled';
}

export async function syncGmail({store,gmail,limit=5,pages=2,deadline=Date.now()+45000,labelSync=false}){
 if(!gmail?.configured())return {configured:false};const lease=randomUUID();
 const claimed=await store.transaction(s=>{const sync=initialize(s);if(sync.leaseUntil>Date.now())return false;sync.lease=lease;sync.leaseUntil=Date.now()+120000;return true;});if(!claimed)return {busy:true};
 const mutate=fn=>store.transaction(s=>{if(s.gmailSync?.lease!==lease)throw Error('Gmail synchronization lease changed');return fn(s);});
 try{
  const profile=await gmail.verifyMailbox();if(!/^\d+$/.test(profile.historyId||''))throw Error('Gmail history identity unavailable');
  await mutate(s=>{const sync=initialize(s);sync.mailbox=profile.emailAddress;sync.startedAt||=now();sync.historyId||=profile.historyId;
   // Existing review/action receipts remain discoverable even when Gmail read state changes.
   if(!sync.nextCarryoverCheck||sync.nextCarryoverCheck<=Date.now()){
    for(const item of [...s.snapshot.results.review,...s.jobs.filter(j=>['queued','processing','uncertain'].includes(j.status)).flatMap(j=>j.items||[])])if(item.status!=='sent'&&idOK(item.threadId))enqueue(s,[{threadId:item.threadId}]);
    sync.nextCarryoverCheck=Date.now()+15*60000;
   }
  });
  let state=await store.read();
  if(!state.gmailSync.sampleComplete&&Date.now()<deadline){const page=await gmail.listMessages({query:SAMPLE_QUERY,maxResults:50});if(!Array.isArray(page.messages||[]))throw Error('Invalid Gmail sample');await mutate(s=>{enqueue(s,page.messages);s.gmailSync.sampleComplete=true;});}
  for(let p=0;p<pages&&Date.now()<deadline;p++){
   state=await store.read();const recovery=state.gmailSync.recoveryScan;if(!recovery||recovery.complete)break;
   const page=await gmail.listMessages({query:RECOVERY_QUERY,pageToken:recovery.pageToken,maxResults:200});
   if(!Array.isArray(page.messages||[])||page.nextPageToken===recovery.pageToken&&page.nextPageToken)throw Error('Incomplete Gmail recovery pagination');
   await mutate(s=>{enqueue(s,page.messages);s.gmailSync.recoveryScan={pageToken:page.nextPageToken||null,complete:!page.nextPageToken};});
  }
  for(let p=0;p<pages&&Date.now()<deadline;p++){
   state=await store.read();const scan=state.gmailSync.unread;if(scan.complete)break;
   const page=await gmail.listMessages({query:UNREAD_QUERY,pageToken:scan.pageToken,maxResults:200});
   if(!Array.isArray(page.messages||[])||page.nextPageToken===scan.pageToken&&page.nextPageToken)throw Error('Incomplete Gmail pagination');
   await mutate(s=>{enqueue(s,page.messages);const u=s.gmailSync.unread;u.pageToken=page.nextPageToken||null;u.count+=(page.messages||[]).length;u.complete=!page.nextPageToken;if(u.complete)u.completedAt=now();});
  }
  // History pages are durably queued before committing their cursor. Hydration may resume later.
  for(let p=0;p<pages&&Date.now()<deadline;p++){
   state=await store.read();const sync=state.gmailSync;if(!sync.unread.complete||sync.recoveryScan?.complete===false)break;
   let page;try{page=await gmail.history({startHistoryId:sync.historyId,pageToken:sync.historyPageToken});}catch(e){if(e.providerStatus!==404)throw e;await mutate(s=>{s.gmailSync.historyId=profile.historyId;s.gmailSync.historyPageToken=null;s.gmailSync.sampleComplete=false;s.gmailSync.unread={complete:false,count:0};s.gmailSync.recoveryScan={complete:false,pageToken:null};s.gmailSync.recovery='History expired: full incoming-mail recovery queued, including archived and Spam; existing inquiries retained.';});break;}
   if(!/^\d+$/.test(page.historyId||'')||page.nextPageToken===sync.historyPageToken&&page.nextPageToken)throw Error('Incomplete Gmail history');
   const changed=(page.history||[]).flatMap(h=>[...(h.messages||[]),...['messagesAdded','messagesDeleted','labelsAdded','labelsRemoved'].flatMap(key=>(h[key]||[]).map(x=>x.message))]);
   await mutate(s=>{enqueue(s,changed);s.gmailSync.historyPageToken=page.nextPageToken||null;if(!page.nextPageToken)s.gmailSync.historyId=page.historyId;});if(!page.nextPageToken)break;
  }
  let hydrated=0;
  while(hydrated<limit&&Date.now()<deadline){state=await store.read();const entry=Object.entries(state.gmailSync.pending).find(([,x])=>!x.nextEligibleAt||x.nextEligibleAt<=Date.now());if(!entry)break;const [id]=entry;
   try{const thread=await gmail.getThread(id);if(thread.id!==id)throw Error('Gmail returned a different conversation');await mutate(s=>{mergeGmailThread(s,thread,gmail.mailbox);});
    if(labelSync){const receipt=await gmail.applyReviewLabel(thread);await mutate(s=>{s.gmailConversations[id].labelReceipt={...receipt,verifiedAt:now(),operation:'add-label-only'};});}
    await mutate(s=>{delete s.gmailSync.pending[id];});hydrated++;}
   catch(e){await mutate(s=>{const pending=s.gmailSync.pending[id];pending.attempts++;pending.nextEligibleAt=Date.now()+Math.min(120000,30000*2**Math.min(pending.attempts-1,2));pending.error=e.providerStatus===404?'Conversation unavailable; inquiry retained for owner review.':'Conversation read failed; retry retained.';});hydrated++;}
  }
  return await mutate(s=>{const sync=s.gmailSync,failed=Object.values(sync.pending).some(x=>x.error);sync.status=failed?'needs_attention':sync.unread.complete&&sync.recoveryScan?.complete!==false&&!Object.keys(sync.pending).length&&!sync.historyPageToken?'current':'syncing';sync.lastSuccessAt=now();delete sync.error;s.snapshot.gmailSync={status:sync.status,lastSuccessAt:sync.lastSuccessAt,mailbox:sync.mailbox,pendingThreads:Object.keys(sync.pending).length,unreadEnumerationComplete:sync.unread.complete,unreadMessagesEnumerated:sync.unread.count,recovery:sync.recovery||null,sendingEnabled:false};return s.snapshot.gmailSync;});
 }catch(error){await mutate(s=>{s.gmailSync.status='needs_attention';s.gmailSync.error='Google synchronization failed; current inquiries and pagination are retained.';s.snapshot.gmailSync={...s.snapshot.gmailSync,status:'needs_attention',error:s.gmailSync.error,sendingEnabled:false};});throw Error('Google synchronization needs attention; pending work is retained.');}
 finally{await store.transaction(s=>{if(s.gmailSync?.lease===lease){delete s.gmailSync.lease;delete s.gmailSync.leaseUntil;}});}
}
