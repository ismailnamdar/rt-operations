import test from 'node:test';import assert from 'node:assert/strict';import {requestRedo,resolveRedo,enqueuePrint} from '../app/shipping.mjs';
test('redo holds every package of the order until every affected rug passes QC and packing',()=>{
 const team={id:'team',role:'warehouse'},s={intents:['A','B'].map(id=>({id,approved:{orders:['100'],units:[{id:'rug-'+id}],productionId:'run'},booking:{id:'label-'+id}})),printJobs:[{intentId:'A',status:'queued'},{intentId:'B',status:'queued'}],events:[]};
 const a=requestRedo(s,team,{id:'A',rugId:'rug-A',reason:'missing'});assert(s.intents.every(i=>i.redoHold));assert(s.printJobs.every(j=>j.status==='cancelled'));assert.throws(()=>enqueuePrint(s,team,s.intents[1],true),/Redo requested/);
 const b=requestRedo(s,team,{id:'B',rugId:'rug-B',reason:'failed quality inspection'});resolveRedo(s,team,{id:a.id,qcPassed:true,packed:true});assert(s.intents.every(i=>i.redoHold));resolveRedo(s,team,{id:b.id,qcPassed:true,packed:true});assert(s.intents.every(i=>!i.redoHold));assert.equal(s.intents[0].booking.id,'label-A');assert.equal(s.intents[1].booking.id,'label-B');
});
