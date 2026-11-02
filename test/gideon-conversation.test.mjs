import test from 'node:test';import assert from 'node:assert/strict';
import {blank} from '../app/store.mjs';import {askGideon,claimGideon,answerGideon,gideonConversation} from '../app/gideon-conversation.mjs';
test('Gideon saves idempotent owner requests and claimed AI suggestions without executing operations',()=>{
 const s=blank(),owner={id:'owner',role:'owner'},body={text:'Explain the address flags; do not book yet.',requestId:'request-12345678'};
 const sent=askGideon(s,owner,body);assert.equal(askGideon(s,owner,body).duplicate,true);assert.equal(s.jobs.length,1);assert.equal(gideonConversation(s,owner).workerConnected,false);assert.throws(()=>askGideon(s,{id:'staff',role:'warehouse'},body));
 const {job}=claimGideon(s);assert.equal(job.id,sent.jobId);assert.equal(gideonConversation(s,owner).workerConnected,true);assert.throws(()=>answerGideon(s,{jobId:job.id,claimToken:'bad',text:'Answer'}));answerGideon(s,{jobId:job.id,claimToken:job.claimToken,text:'Review the suite field before approving.',model:'Codex worker'});assert.equal(s.gideonMessages.length,2);assert.equal(s.gideonMessages[0].status,'answered');assert.equal(s.jobs[0].status,'review');assert.equal(s.intents.length,0);assert.equal(s.printJobs.length,0);assert.equal(gideonConversation(s,{id:'staff',role:'warehouse'}),null);
});
