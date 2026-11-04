import test from 'node:test';import assert from 'node:assert/strict';import {schedulerStore} from '../app/scheduler-store.mjs';
test('scheduler metadata never rewrites core, honors old leases, skips no-ops and rolls back failures',{skip:!process.env.SHUTTLE_TEST_PGLITE_PATH},async()=>{
 const {PGlite}=await import(process.env.SHUTTLE_TEST_PGLITE_PATH),db=new PGlite(),calls=[];
 const query=(sql,args=[])=>{calls.push(typeof sql==='object'?sql.text:sql);return db.query(typeof sql==='object'?sql.text:sql,typeof sql==='object'?sql.values:args);},client={query,release(){}},pool={query,connect:async()=>client};
 await db.exec('CREATE TABLE shuttle_state(id integer PRIMARY KEY,payload jsonb)');const core={revision:12,gmailConversations:{private:{messages:['unchanged']}},scheduledLease:{id:'old',until:Date.now()+90000}};await db.query('INSERT INTO shuttle_state VALUES(1,$1::jsonb)',[JSON.stringify(core)]);
 const store=await schedulerStore(pool,'shuttle_state');assert.equal(await store.schedulerTransaction(s=>!s.scheduledLease?.until),false);assert.equal(await store.schedulerRevision(),0);
 await db.query("UPDATE shuttle_state SET payload=payload-'scheduledLease' WHERE id=1");delete core.scheduledLease;
 await store.schedulerTransaction(s=>{s.scheduledLease={id:'new',until:Date.now()+90000};});assert.equal(await store.schedulerTransaction(s=>s.scheduledLease.id),'new');assert.equal(await store.schedulerRevision(),0);
 await assert.rejects(store.schedulerTransaction(s=>{s.lastScheduledRun={at:new Date().toISOString()};throw Error('failure');}),/failure/);assert.equal(await store.schedulerRevision(),0);
 await assert.rejects(store.schedulerTransaction(s=>{s.gmailConversations={};}),/Only scheduler/);
 await store.schedulerTransaction(s=>{delete s.scheduledLease;s.lastScheduledRun={at:'2026-11-04T20:00:00Z',status:'complete'};});const s=await store.withScheduler(structuredClone(core));assert.equal(s.lastScheduledRun.status,'complete');await store.schedulerTransaction(s=>{s.lastScheduledRun.at='2026-11-04T21:00:00Z';s.driveFullInventoryAt='2026-11-04T21:00:00Z';});assert.equal(await store.schedulerRevision(),1);assert.equal(s.schedulerStorageRevision,1);assert.equal(Object.keys(s).includes('schedulerStorageRevision'),false);
 assert.deepEqual((await db.query('SELECT payload FROM shuttle_state')).rows[0].payload,core);assert.ok(!calls.some(q=>/^UPDATE shuttle_state SET/.test(q)));assert.equal((await db.query("SELECT relrowsecurity FROM pg_class WHERE relname='shuttle_state_scheduler'")).rows[0].relrowsecurity,true);await db.close();
});

test('integration health uses the small projection instead of loading mailbox bodies',async()=>{
 const {checkIntegrations}=await import('../app/integration-readiness.mjs');let read=0;
 const report=await checkIntegrations({store:{read:async()=>{throw Error('Full mailbox read prohibited');},integrationRead:async()=>{read++;return {gmailSync:{pending:{a:{error:'retry',providerStatus:429}}},driveFullInventoryAt:'2026-11-04T20:00:00Z'};}},user:{role:'owner'}});
 assert.equal(read,1);assert.equal(report.checks.gmail.pending,1);assert.equal(report.checks.drive.lastSuccessAt,'2026-11-04T20:00:00Z');assert.equal(report.writesPerformed,false);
});
