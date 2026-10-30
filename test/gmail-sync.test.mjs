import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {createStore,blank} from '../app/store.mjs';
import {syncGmail,mergeGmailThread,UNREAD_QUERY} from '../app/gmail-sync.mjs';
import {saveReviews} from '../app/reviews.mjs';
import {GmailClient} from '../app/gmail.mjs';
import {runScheduled} from '../api/cron.mjs';
const mailbox='info@rugtomize.co';
const message=(id,threadId,labels=['UNREAD'],text='Could you check my order?')=>({id,threadId,labelIds:labels,internalDate:'1793200000000',payload:{mimeType:'text/plain',headers:[{name:'From',value:'Customer <customer@example.invalid>'},{name:'Subject',value:'Order #16400'},{name:'Message-ID',value:'<'+id+'@example.invalid>'}],body:{data:Buffer.from(text).toString('base64url')}}});
const thread=(id,labels=['UNREAD'])=>({id,messages:[message('m-'+id,id,labels)]});
async function fixture(t){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'shuttle-gmail-')),store=await createStore({file:path.join(dir,'state.json'),databaseUrl:null});t.after(async()=>{await store.close();await fs.rm(dir,{recursive:true,force:true});});return store;}
function client(overrides={}){return {mailbox,configured:()=>true,verifyMailbox:async()=>({emailAddress:mailbox,historyId:'100'}),listMessages:async()=>({messages:[]}),history:async()=>({historyId:'101',history:[]}),getThread:async id=>thread(id),...overrides};}

test('all unread pagination spans archived and Spam, queues before reads and resumes without replacing work',async t=>{
 const store=await fixture(t),calls=[];
 const gmail=client({listMessages:async args=>{calls.push(args);if(args.query!==UNREAD_QUERY)return {messages:[{id:'sample',threadId:'sample'}]};return args.pageToken?{messages:[{id:'archived',threadId:'archived'}]}:{messages:[{id:'spam',threadId:'spam'}],nextPageToken:'page2'};}});
 await syncGmail({store,gmail,pages:1,limit:0});let s=await store.read();assert.equal(s.gmailSync.unread.complete,false);assert.equal(s.gmailSync.unread.pageToken,'page2');assert.deepEqual(Object.keys(s.gmailSync.pending).sort(),['sample','spam']);
 await syncGmail({store,gmail,pages:1,limit:10});s=await store.read();assert.equal(s.gmailSync.unread.complete,true);assert.equal(s.snapshot.results.review.length,3);assert.ok(calls.some(x=>x.pageToken==='page2'));assert.equal(s.jobs.length,0);assert.ok(s.snapshot.results.review.every(x=>x.sendBlocked&&x.status==='pending'));
});
test('read/archive changes preserve obligations, whole conversations and owner edits without duplicate cards',()=>{
 const s=blank();mergeGmailThread(s,thread('one'),mailbox);let row=s.snapshot.results.review[0];
 saveReviews(s,{id:'owner',role:'owner'},[{id:row.id,version:row.version,text:'My exact private draft'}]);assert.equal(row.body,'My exact private draft');const savedVersion=row.version;
 mergeGmailThread(s,thread('one'),mailbox);assert.equal(row.version,savedVersion);
 mergeGmailThread(s,thread('one',[]),mailbox);assert.equal(s.snapshot.results.review.length,1);assert.equal(row.body,'My exact private draft');assert.equal(row.unread,false);assert.equal(s.gmailCarryover['m-one'].status,'unresolved');
 const current=thread('one',[]);current.messages.push(message('new-question','one',['UNREAD'],'A new unanswered question'));mergeGmailThread(s,current,mailbox);assert.equal(Object.keys(s.gmailCarryover).length,2);assert.equal(row.conversation.length,2);assert.equal(row.sourceMessageId,'new-question');
});
test('Trash is excluded while removed source obligations remain visible, without invented resolution',()=>{
 const s=blank();mergeGmailThread(s,thread('one'),mailbox);mergeGmailThread(s,thread('one',['TRASH']),mailbox);assert.match(s.gmailCarryover['m-one'].blocker,/Trash/);assert.equal(s.snapshot.results.review[0].status,'pending');
 const clean=blank();mergeGmailThread(clean,thread('trash',['TRASH']),mailbox);assert.equal(clean.snapshot.results.review.length,0);
});
test('expired history recovers unread discovery and retains prior records; provider failures preserve cursor',async t=>{
 const store=await fixture(t);await syncGmail({store,gmail:client(),limit:0});await store.transaction(s=>{mergeGmailThread(s,thread('old'),mailbox);});
 await syncGmail({store,gmail:client({history:async()=>{throw Object.assign(Error('expired'),{providerStatus:404});}}),limit:0});let s=await store.read();assert.equal(s.gmailSync.unread.complete,false);assert.equal(s.gmailSync.sampleComplete,false);assert.ok(s.gmailCarryover['m-old']);
 await assert.rejects(syncGmail({store,gmail:client({listMessages:async()=>{throw Error('network failure');}})}));s=await store.read();assert.equal(s.gmailSync.status,'needs_attention');assert.ok(s.gmailCarryover['m-old']);assert.equal(s.gmailSync.lease,undefined);
});
test('history pagination commits cursor only after durable enumeration and never drops failed thread reads',async t=>{
 const store=await fixture(t);let reads=0;const gmail=client({history:async({pageToken,startHistoryId})=>{assert.equal(startHistoryId,'100');return pageToken?{historyId:'103',history:[{messagesAdded:[{message:{id:'m2',threadId:'two'}}]}]}:{historyId:'102',nextPageToken:'h2',history:[{messages:[{id:'m1',threadId:'one'}]}]};},getThread:async id=>{reads++;throw Error('temporary');}});
 await syncGmail({store,gmail,pages:1,limit:1});let s=await store.read();assert.equal(s.gmailSync.historyId,'100');assert.equal(s.gmailSync.historyPageToken,'h2');assert.ok(s.gmailSync.pending.one.error);
 await syncGmail({store,gmail,pages:1,limit:0});s=await store.read();assert.equal(s.gmailSync.historyId,'103');assert.ok(s.gmailSync.pending.one);assert.ok(s.gmailSync.pending.two);assert.equal(reads,1);
});
test('simultaneous Gmail workers share one durable lease',async t=>{
 const store=await fixture(t);let enter,release;const entered=new Promise(r=>enter=r),gate=new Promise(r=>release=r);
 const first=syncGmail({store,gmail:client({verifyMailbox:async()=>{enter();await gate;return {emailAddress:mailbox,historyId:'100'};}})});await entered;assert.deepEqual(await syncGmail({store,gmail:client()}),{busy:true});release();await first;
});
test('new history changes are hydrated before the older initial backlog',async t=>{
 const store=await fixture(t);await store.transaction(s=>{s.gmailSync={pending:{old:{queuedAt:'2020-01-01',attempts:0}},unread:{complete:true,count:0},sampleComplete:true,historyId:'100'};});
 const reads=[];await syncGmail({store,gmail:client({history:async()=>({historyId:'101',history:[{messagesAdded:[{message:{id:'fresh-message',threadId:'fresh'}}]}]}),getThread:async id=>{reads.push(id);return thread(id);}}),limit:1});
 assert.deepEqual(reads,['fresh']);assert.ok((await store.read()).gmailSync.pending.old);
});
test('optional label writes occur only after inquiry persistence and stay off by default',async t=>{
 const store=await fixture(t);let labeled=0;const gmail=client({listMessages:async()=>({messages:[{id:'m-one',threadId:'one'}]}),applyReviewLabel:async()=>{assert.ok((await store.read()).gmailCarryover['m-one']);labeled++;return {labelId:'Label1',messageIds:['m-one']};}});
 await syncGmail({store,gmail});assert.equal(labeled,0);await store.transaction(s=>{s.gmailSync.pending.one={attempts:0};});await syncGmail({store,gmail,labelSync:true});assert.equal(labeled,1);assert.equal((await store.read()).gmailConversations.one.labelReceipt.operation,'add-label-only');
});
test('Gmail list explicitly includes Spam; batch label changes never remove UNREAD and verify readback',async()=>{
 const requests=[],g=new GmailClient({clientId:'id',clientSecret:'secret',refreshToken:'refresh',mailbox,fetchImpl:async(url,options={})=>{requests.push({url,options});if(url.includes('oauth2'))return Response.json({access_token:'token',expires_in:3600});if(url.includes('messages?'))return Response.json({messages:[]});if(url.endsWith('/labels'))return Response.json({labels:[{id:'Label1',name:'SHUTTLE/Review'}]});if(url.endsWith('batchModify'))return new Response(null,{status:204});if(url.includes('/threads/'))return Response.json(thread('one',['UNREAD','Label1']));throw Error('Unexpected request');}});
 await g.listMessages({query:UNREAD_QUERY});assert.match(requests[1].url,/includeSpamTrash=true/);await g.applyReviewLabel(thread('one'));const write=requests.find(x=>x.url.endsWith('batchModify'));assert.deepEqual(JSON.parse(write.options.body),{ids:['m-one'],addLabelIds:['Label1']});
});
test('Drive failure does not prevent Gmail work and sources retain separate outcomes',async t=>{
 const store=await fixture(t),app={store,gmail:client(),drive:{sync:async()=>{throw Error('Drive unavailable');}},env:{}};
 const result=await runScheduled(app);assert.equal(result.ok,false);assert.equal(result.sources.gmail.status,'complete');assert.equal(result.sources.drive.status,'needs_attention');assert.ok((await store.read()).gmailSync.lastSuccessAt);assert.equal((await store.read()).scheduledLease,undefined);
});
test('a retained Gmail read failure is not reported as a healthy completed scheduled source',async t=>{
 const store=await fixture(t);const result=await runScheduled({store,env:{},gmail:client({listMessages:async()=>({messages:[{id:'m-one',threadId:'one'}]}),getThread:async()=>{throw Object.assign(Error('denied'),{providerStatus:403});}})});
 assert.equal(result.ok,false);assert.equal(result.sources.gmail.status,'needs_attention');assert.equal((await store.read()).snapshot.gmailSync.failedByProviderStatus['403'],1);
});
