import test from 'node:test';import assert from 'node:assert/strict';
import {classifyReviewConversation} from '../app/public/review-routing.js';import {organizeReviewCategories} from '../app/review-routing.mjs';
const proof={id:'proof',date:'2026-11-01T10:00:00Z',from:'info@rugtomize.co',labels:['SENT'],text:'Please review your current mock-up and confirm the size and shape.'};
const item=(text,extra={})=>({id:'gmail-thread',gmailManaged:true,status:'pending',sourceVersion:'current',sourceMessageId:'incoming',responseGroupId:'other',customerQuestion:text,body:'Owner draft unchanged',sendBlocked:true,requiresInput:true,conversation:[proof,{id:'incoming',date:'2026-11-01T11:00:00Z',from:'customer@example.invalid',text}],...extra});
test('current proof approval and approval plus a separate question are different routing groups, not verified releases',()=>{
 const flat=classifyReviewConversation(item('Looks great, thank you!'));assert.equal(flat.group,'customer_approvals');assert.equal(flat.verifiedApproval,false);assert.equal(flat.authority,'routing_only');assert.equal(classifyReviewConversation(item('Looks good! When will it ship?')).group,'approval_needs_reply');
});
test('revision, conditional and obsolete-proof cases never become flat approvals',()=>{
 assert.equal(classifyReviewConversation(item('Looks good but please change the background color.')).group,'color');assert.equal(classifyReviewConversation(item('Looks good if you change the design.')).group,'artwork');assert.equal(classifyReviewConversation(item('Can we do 6x8 instead?')).group,'artwork');
 const newer={...proof,id:'newproof',date:'2026-11-01T12:00:00Z',text:'Here is the updated mock-up.'};const old=item('Approved');old.conversation.push(newer);assert.equal(classifyReviewConversation(old).group,'proof');
 const quoted=item('Please refund my order.\nOn Monday somebody wrote:\nLooks good, approved!');assert.equal(classifyReviewConversation(quoted).group,'billing');
 const noContext=item('Approved',{conversation:[]});assert.equal(classifyReviewConversation(noContext).group,'other');
});
test('all conversations are grouped without dropping read/archived carryover, changing edits or enabling sends',()=>{
 const samples=['Looks good, thank you!','Looks good, can you confirm delivery?','Please refund my order','Where is my order?','Can I get a quote for a custom rug?','We need a delivery date for Friday','I cannot open the proof attachment','Please replace the damaged rug'];
 const review=Array.from({length:276},(_,n)=>item(samples[n%samples.length],{id:'case-'+n,unread:n%2===0,archived:n%3===0,version:'owner-version-'+n}));const s={snapshot:{results:{review}}};const ids=review.map(i=>i.id),versions=review.map(i=>i.version);const result=organizeReviewCategories(s);assert.equal(result.total,276);assert.equal(Object.values(result.counts).reduce((a,b)=>a+b,0),276);assert.deepEqual(review.map(i=>i.id),ids);assert.deepEqual(review.map(i=>i.version),versions);assert.ok(review.every(i=>i.body==='Owner draft unchanged'&&i.sendBlocked===true&&i.requiresInput===true&&i.status==='pending'));assert.ok(result.counts.customer_approvals>0);assert.ok(result.counts.approval_needs_reply>0);assert.equal(organizeReviewCategories(s).total,276);
});
test('existing SHUTTLE verified group identities are preserved',()=>{assert.equal(classifyReviewConversation({id:'old',approvalReviewKind:'flat',responseGroupId:'other'}).group,'customer_approvals');assert.equal(classifyReviewConversation({id:'old',approvalReviewKind:'needs_reply'}).group,'approval_needs_reply');});
