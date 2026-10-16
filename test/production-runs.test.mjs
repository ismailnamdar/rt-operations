import test from 'node:test';
import assert from 'node:assert/strict';
import {buildProductionRuns} from '../app/public/production-runs.js';
test('carry forward unfulfilled once, preserve original run and exclude fulfilled from queue',()=>{
 const state={schedule:{days:['2026-10-15']},productionRuns:{runs:[{id:'batch1',date:'2026-10-12',orders:[{order:'1',fulfillmentStatus:'FULFILLED',previewUrl:'/one.png'},{order:'2',previewUrl:'/two.png'}]},{id:'batch2',orders:[{order:'2',previewUrl:'/two.png'}]}]}};
 const before=structuredClone(state),runs=buildProductionRuns(state,'2026-10-13');
 assert.deepEqual(runs[0].orders.map(o=>o.order),['2']);assert.equal(runs[0].date,'2026-10-15');assert.equal(runs.find(r=>r.id==='batch1').orders[0].fulfilled,true);assert.deepEqual(state,before);
});
test('label booking does not establish fulfillment and an unscheduled queue stays visible',()=>{
 const runs=buildProductionRuns({productionShipping:{intents:[{booking:{id:'label'},approved:{productionId:'run1',orders:['3'],units:[]}}]}},'2026-10-13');
 assert.equal(runs[0].id,'upcoming:unscheduled');assert.equal(runs[0].orders[0].fulfilled,false);
});
test('cutoff intake contains affected redo rugs and new approvals rather than old unfulfilled orders',()=>{
 const runs=buildProductionRuns({schedule:{days:['2026-10-15']},productionRuns:{runs:[{id:'old',orders:[{order:'99'}]}]},productionShipping:{intents:[{id:'s',approved:{productionId:'old',orders:['1'],units:[{id:'a',previewUrl:'/a.png',size:'3x5'},{id:'b',previewUrl:'/b.png',size:'2x3'}]}}],upcomingIntake:{approvals:[{order:'2',rugs:[{size:'3x3'}]}],redos:[{intentId:'s',rugId:'b',orders:['1']}]}}},'2026-10-13');
 const next=runs.find(r=>r.upcoming);assert.deepEqual(next.orders.map(o=>o.order),['2','1']);assert.equal(next.orders[1].intakeUnits.length,1);assert.equal(next.orders[1].intakeUnits[0].id,'b');assert.equal(next.orders[1].upcomingRedo,true);
});
test('closing production advances to the next scheduled date and keeps an empty intake visible',()=>{const runs=buildProductionRuns({schedule:{days:['2026-10-15','2026-10-19']},productionRuns:{runs:[{id:'closed',date:'2026-10-15',orders:[]}]},productionShipping:{cutoffs:[{runId:'closed'}],intents:[],upcomingIntake:{approvals:[],redos:[]}}},'2026-10-15');assert.equal(runs.find(r=>r.upcoming).date,'2026-10-19');assert.equal(runs.find(r=>r.upcoming).orders.length,0);});
