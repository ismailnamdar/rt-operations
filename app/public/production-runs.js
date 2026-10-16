import {rugShapes} from './rug-shapes.js';
const orderNumber=o=>String(typeof o==='object'?(o.order??o.orderNumber??o.number??''):o).replace(/^#/,'');
const isFulfilled=o=>String(o?.fulfillmentStatus||'').toUpperCase()==='FULFILLED';
const previews=o=>[o?.previewUrl,...(o?.previewUrls||[]),o?.proof?.previewUrl].filter(u=>typeof u==='string'&&(/^(https?:\/\/|\/)/.test(u))&&!u.startsWith('//'));
// Derived queue: preserves historical membership and never changes payment,
// fulfillment or carrier approval records when carrying an order forward.
export function buildProductionRuns(state,today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Los_Angeles'}).format(new Date())){
 const inventory=new Map([...(state.pipeline?.orders||[]),...(state.unfulfilled?.orders||[])].map(o=>[orderNumber(o),o]));
 const runs=new Map();
 for(const run of state.productionRuns?.runs||state.productionArchive?.runs||[]){if(!run.id)continue;runs.set(run.id,{id:run.id,name:run.name||run.title||run.id,date:run.date||run.productionDate,orders:new Map()});for(const row of run.orders||[]){const n=orderNumber(row);if(!n)continue;const o={...(typeof row==='object'?row:{}),...inventory.get(n)};runs.get(run.id).orders.set(n,{order:n,productionStage:o.productionStage,productionCategory:o.productionCategory,intakeUnits:o.intakeUnits,hold:o.hold,fulfilled:isFulfilled(o),rugs: Array.isArray(o.rugs)?o.rugs:[],previews:previews(o)});}}
 for(const intent of state.productionShipping?.intents||[]){const a=intent.approved,id=a.productionId;if(!runs.has(id))runs.set(id,{id,name:id,date:a.productionDate,orders:new Map()});for(const n0 of a.orders){const n=orderNumber(n0),o=inventory.get(n)||{},prior=runs.get(id).orders.get(n);runs.get(id).orders.set(n,{order:n,productionStage:o.productionStage,productionCategory:o.productionCategory,intakeUnits:o.intakeUnits,hold:o.hold,fulfilled:isFulfilled(o)||prior?.fulfilled===true,rugs:prior?.rugs?.length?prior.rugs:a.units.filter(u=>u.order?orderNumber(u)===n:a.orders.length===1),previews:[...new Set([...(prior?.previews||[]),...previews(o),...a.units.flatMap(previews)])]});}}
 const closedDates=new Set((state.productionShipping?.cutoffs||[]).map(c=>state.productionRuns?.runs?.find(r=>r.id===c.runId)?.date).filter(Boolean));
 const next=[...(state.schedule?.days||[])].filter(d=>d>=today&&!closedDates.has(d)).sort()[0];
 const queueId=next?'upcoming:'+next:'upcoming:unscheduled';const queue={id:queueId,name:next?'Upcoming production':'Upcoming production · date needed',date:next,upcoming:true,orders:new Map()};
 const intake=state.productionShipping?.upcomingIntake;
 if(intake){for(const approval of intake.approvals||[]){const n=orderNumber(approval);if(!n)continue;const o={...inventory.get(n),...approval};queue.orders.set(n,{order:n,productionStage:'awaiting production',rugs:structuredClone(o.rugs||[]),intakeUnits:structuredClone(o.rugs||[]),previews:previews(o),fulfilled:false});}for(const redo of intake.redos||[]){const intent=state.productionShipping.intents.find(i=>i.id===redo.intentId),unit=intent?.approved.units.find(u=>u.id===redo.rugId);if(!unit)continue;for(const n0 of redo.orders){const n=orderNumber(n0),prior=queue.orders.get(n)||{order:n,productionStage:'awaiting production',fulfilled:false,rugs:[],previews:[],intakeUnits:[]};prior.rugs.push(unit);prior.intakeUnits.push(unit);prior.previews.push(...previews(unit));prior.upcomingRedo=true;prior.hold=true;queue.orders.set(n,prior);}}}
 else{ for(const run of runs.values())for(const o of run.orders.values())if(!o.fulfilled){const prev=queue.orders.get(o.order);queue.orders.set(o.order,{...o,previews:[...new Set([...(prev?.previews||[]),...o.previews])]});}}

 runs.set(queueId,queue);
 return [...runs.values()].map(r=>({...r,orders:[...r.orders.values()].map(o=>({...o,shapeCounts:rugShapes(o.rugs)}))})).sort((a,b)=>Number(!!b.upcoming)-Number(!!a.upcoming)||(b.date||'').localeCompare(a.date||''));
}
