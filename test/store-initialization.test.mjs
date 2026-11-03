import test from 'node:test';import assert from 'node:assert/strict';
import {initializeWorkflowTable} from '../app/store.mjs';
test('ordinary cold starts do not take schema/table migration locks or rewrite state',async()=>{
 const calls=[],pool={query:async(sql,args)=>{calls.push({sql,args});return {rows:[{rls:true,seeded:true}]};}};
 assert.equal(await initializeWorkflowTable(pool,'shuttle_hosted'),'shuttle_hosted.shuttle_state');assert.equal(calls.length,1);assert.match(calls[0].sql,/^SELECT/);assert.deepEqual(calls[0].args,['shuttle_hosted.shuttle_state']);
});
test('first use creates and secures the table, while existing disabled RLS is restored',async()=>{
 const calls=[],pool={query:async sql=>{calls.push(sql);if(calls.length===1)throw Object.assign(Error('Missing'),{code:'42P01'});return {rows:[]};}};await initializeWorkflowTable(pool,'shuttle_hosted');assert.ok(calls.some(s=>s.startsWith('CREATE SCHEMA')));assert.ok(calls.some(s=>s.includes('ENABLE ROW LEVEL SECURITY')));assert.ok(calls.some(s=>s.startsWith('INSERT')));
 const repair=[],existing={query:async sql=>{repair.push(sql);return {rows:[{rls:false,seeded:true}]};}};await initializeWorkflowTable(existing,'shuttle_hosted');assert.equal(repair.length,2);assert.match(repair[1],/ENABLE ROW LEVEL SECURITY/);
});
test('startup never conceals database permission/connection failures',async()=>{await assert.rejects(initializeWorkflowTable({query:async()=>{throw Object.assign(Error('Denied'),{code:'42501'});}},'shuttle_hosted'),/Denied/);});

test('database lock waits are bounded and failed transactions roll back without applying state',async()=>{
 const {workflowTransaction}=await import('../app/store.mjs');const calls=[];let released=0,ran=false;
 const client={query:async sql=>{calls.push(sql);if(sql.includes('FOR UPDATE'))throw Object.assign(Error('Lock timeout'),{code:'55P03'});return {rows:[]};},release:()=>released++};
 await assert.rejects(workflowTransaction({connect:async()=>client},'shuttle_hosted.shuttle_state',()=>{ran=true;}),/Lock timeout/);
 assert.equal(ran,false);assert.equal(released,1);assert.ok(calls.includes("SET LOCAL lock_timeout='3s'"));assert.ok(calls.includes("SET LOCAL statement_timeout='8s'"));assert.equal(calls.at(-1),'ROLLBACK');assert.ok(!calls.some(q=>q.startsWith('UPDATE')));
});
