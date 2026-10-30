import test from 'node:test';import assert from 'node:assert/strict';
import {checkIntegrations} from '../app/integration-readiness.mjs';
import {blank} from '../app/store.mjs';
test('readiness is owner-only and probes never buy, send or return provider customer data',async()=>{
 const s=blank();s.gmailSync={pending:{one:{error:'failed',providerStatus:403}}};s.lastScheduledRun={status:'needs_attention',sources:{gmail:{status:'needs_attention',secret:'DO_NOT_RETURN'}}};
 const store={read:async()=>s};const calls=[];const gmail={configured:()=>true,verifyMailbox:async()=>{calls.push('profile');return {emailAddress:'private@example.invalid'};},send:()=>{throw Error('Never send');}};
 const provider={token:'SECRET',liveBooking:false,request:async route=>{calls.push(route);return [{address:'PRIVATE'}];},buy:()=>{throw Error('Never buy');}};
 await assert.rejects(checkIntegrations({store,user:{role:'warehouse'},gmail,provider}));assert.deepEqual(calls,[]);
 const result=await checkIntegrations({store,user:{role:'owner'},gmail,provider});assert.equal(result.checks.parsel.authenticatedRead,true);assert.equal(result.checks.gmail.failedByProviderStatus['403'],1);assert.equal(result.writesPerformed,false);assert.doesNotMatch(JSON.stringify(result),/SECRET|PRIVATE|private@example|DO_NOT_RETURN/);
});
test('provider failures produce actionable safe diagnostics and preserve independent results',async()=>{
 const result=await checkIntegrations({store:{read:async()=>blank()},user:{role:'owner'},gmail:{configured:()=>true,verifyMailbox:async()=>{throw Error('credential detail');}},provider:{disabled:true}});assert.equal(result.checks.gmail.authenticatedRead,false);assert.equal(result.checks.parsel.configured,false);assert.doesNotMatch(JSON.stringify(result),/credential detail/);
});
