import test from 'node:test';import assert from 'node:assert/strict';
test('account controls recover after transient absence and share the authenticated dashboard snapshot',async()=>{
 const {firstLiveState,publishLiveState}=await import('../app/public/live-state.js');let resolved=false;const pending=firstLiveState().then(s=>{resolved=true;return s;});publishLiveState({error:'transient'});await Promise.resolve();assert.equal(resolved,false);const verified={hosted:{user:{role:'owner',email:'owner@example.invalid'}},token:'private-csrf'};publishLiveState(verified);assert.equal(await pending,verified);assert.equal(await firstLiveState(),verified);publishLiveState({hosted:{user:{role:'viewer'}}});assert.equal(await firstLiveState(),verified);
});
