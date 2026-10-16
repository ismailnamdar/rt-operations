import test from 'node:test';
import assert from 'node:assert/strict';
import {blank} from '../app/store.mjs';
import {MOCK_MAIL,seedUnreadReviewDemo} from '../app/workflow-simulation.mjs';
test('unread samples are normal review records without duplicates or automatic sends',()=>{
 const s=blank();seedUnreadReviewDemo(s);
 assert.equal(s.snapshot.results.review.length,MOCK_MAIL.length);
 assert.ok(s.snapshot.results.review.every(i=>i.status==='pending'&&i.unread&&i.replyDisposition));
 assert.equal(s.snapshot.results.review.find(i=>i.id==='SIM-NEW').category,'new_rug_inquiry');
 s.snapshot.results.review[0].status='deleted';seedUnreadReviewDemo(s);
 assert.equal(s.snapshot.results.review.length,MOCK_MAIL.length);
 assert.equal(s.snapshot.results.review[0].status,'deleted');
 assert.equal(s.jobs.length,0);
});
