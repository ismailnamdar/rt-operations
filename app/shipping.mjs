import {automatedStage,stageAfterBooking} from './stage-automation.mjs';
import {randomUUID,createHash} from 'node:crypto';
import {requireRole} from './auth.mjs';
export const fail=(message,status=409)=>{throw Object.assign(Error(message),{status});};
const stable=x=>JSON.stringify(x,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))):v);
export const fingerprint=x=>createHash('sha256').update(stable(x)).digest('hex');
export function record(s,type,user,detail){s.events.push({id:randomUUID(),at:new Date().toISOString(),type,actor:user.id,...detail});}
export function validatePrescan(p){
 if(!p?.id||!/^S-[A-Za-z0-9-]{4,80}$/.test(p.id)||!p.productionId||!p.proofHash||!p.sourceVersion)fail('Prescan needs shipment, production, proof and source identities',400);
 if(!Array.isArray(p.orders)||!p.orders.length||new Set(p.orders).size!==p.orders.length)fail('Order mapping is missing or duplicated',400);
 if(!Array.isArray(p.units)||!p.units.length||new Set(p.units.map(u=>u.id)).size!==p.units.length||p.units.some(u=>!u.id||!u.size||!u.design))fail('Every physical rug needs a unique ID, design and size',400);
 if(!['UPS','FedEx'].includes(p.carrier)||!p.service||!p.shipmentId||!p.rateId)fail('Select an exact carrier service and Parsel rate',400);
 if(!p.shipDate||!/^\d{4}-\d{2}-\d{2}$/.test(p.shipDate)||!Number.isSafeInteger(p.maxCostCents)||p.maxCostCents<1||p.currency!=='USD')fail('Ship date and approved USD spending limit required',400);
 if(!p.destination||!p.package||!['length','width','height','weight'].every(k=>Number.isFinite(p.package[k])&&p.package[k]>0)||p.package.length_unit!=='IN'||p.package.weight_unit!=='LB')fail('Verified address and positive package measurements in IN/LB required',400);
 if(!['name','street1','city','state','zip','country'].every(k=>typeof p.destination[k]==='string'&&p.destination[k].trim()))fail('Recipient address incomplete',400);
 if(!p.evidence||!['orders','address','package','payment','priorLabels','sourceCoverage'].every(k=>p.evidence[k]?.verified===true&&typeof p.evidence[k]?.reference==='string'&&p.evidence[k].reference.trim()))fail('Complete prescan evidence required; do not infer checks',400);
 if(p.hold||p.pickup||p.excluded||p.paymentVerified!==true)fail('Held, pickup, excluded or unpaid shipment cannot be released',400);
 if(!Number.isFinite(Date.parse(p.validUntil))||Date.parse(p.validUntil)<=Date.now())fail('Prescan validity expired',400);
}
export function importIntent(s,user,p){requireRole(user,['owner']);validatePrescan(p);if(s.intents.some(x=>x.id===p.id||x.approved.shipmentId===p.shipmentId))fail('Shipment ID or carrier reference already exists; reconcile it before importing another version');
 const value=structuredClone(p),intent={id:p.id,approved:value,approvalHash:fingerprint(value),packed:[],status:'approved',booking:null,createdAt:new Date().toISOString(),approvedBy:user.id};
 s.intents.push(intent);record(s,'prescan_approved',user,{intentId:p.id,approvalHash:intent.approvalHash});return intent;
}
export function pack(s,user,id,rugId){requireRole(user,['owner','warehouse']);const i=s.intents.find(x=>x.id===id);if(!i||i.status!=='approved')fail('Shipment is not open for packing');if(!i.approved.units.some(u=>u.id===rugId))fail('Rug does not belong in this shipment');if(!i.packed.includes(rugId)){i.packed.push(rugId);record(s,'rug_packed',user,{intentId:id,rugId});}return i;}
function checkReady(i){if(!i)fail('Unknown shipment',404);if(i.redoHold)fail('Redo requested; the whole order is on hold');if(fingerprint(i.approved)!==i.approvalHash)fail('Prescan changed; owner must approve a new version');validatePrescan(i.approved);if(i.approved.units.some(u=>u.qcPassed!==true)||i.packed.length!==i.approved.units.length)fail('Every expected rug must pass QC and be packed');}
export async function scanAndBook({store,provider,user,id,queuePrint=true}){
 requireRole(user,['owner','warehouse']);
 const intent=await store.transaction(s=>{const i=s.intents.find(x=>x.id===id);if(i?.booking)return {existing:true,...i};checkReady(i);if(i.status!=='approved')fail('Booking already started or requires reconciliation');i.status='checking';record(s,'booking_check_started',user,{intentId:id});return i;});
 if(intent.existing)return {intent,duplicate:true};
 let purchasing=false;
 try{
  const live=await provider.preflight(intent.approved);
  if(live.sourceVersion!==intent.approved.sourceVersion||live.approvalHash!==intent.approvalHash||live.hold||live.paymentVerified!==true||live.qcPassed!==true)fail('Current order, proof, payment or QC differs from prescan');
  if(live.existingBooking)fail('Existing carrier booking requires reconciliation');
  const rate=live.rates.find(r=>r.id===intent.approved.rateId);
  if(!rate||rate.carrier!==intent.approved.carrier||rate.service!==intent.approved.service||rate.currency!==intent.approved.currency||!Number.isSafeInteger(rate.costCents)||rate.costCents>intent.approved.maxCostCents)fail('Selected service or approved price is unavailable');
  await store.transaction(s=>{const i=s.intents.find(x=>x.id===id);if(i.status!=='checking'||i.approvalHash!==intent.approvalHash)fail('Shipment changed during final check');checkReady(i);i.status='booking_pending';record(s,'purchase_started',user,{intentId:id,shipmentId:i.approved.shipmentId,rateId:i.approved.rateId});});
  purchasing=true;const booking=await provider.buy(intent.approved);
  if(!booking?.id||!booking.tracking||booking.carrier!==intent.approved.carrier||booking.service!==intent.approved.service)fail('Carrier purchase response needs reconciliation');
  return await store.transaction(s=>{const i=s.intents.find(x=>x.id===id);if(s.intents.some(x=>x.id!==id&&x.booking?.id===booking.id))fail('Booking belongs to another shipment');i.booking=booking;i.status='booked';stageAfterBooking(s,i.approved.orders);record(s,'label_booked',user,{intentId:id,bookingId:booking.id,tracking:booking.tracking});const j=queuePrint?enqueuePrint(s,user,i,false):null;return {intent:i,printJob:j};});
 }catch(e){await store.transaction(s=>{const i=s.intents.find(x=>x.id===id);if(!i.booking){i.status=purchasing?'booking_uncertain':'needs_attention';i.error=e.message;record(s,i.status,user,{intentId:id});}return i;});throw e;}
}
export async function approveProductionAndBook({store,provider,user,id}){
 requireRole(user,['owner']);
 await store.transaction(s=>{const i=s.intents.find(i=>i.id===id);if(!i)fail('Prescanned shipment not found',404);if(i.booking)return i;checkReady(i);if(i.status!=='approved')fail('Booking is already running or requires reconciliation');if(!i.productionApprovedAt){i.productionApprovedAt=new Date().toISOString();i.productionApprovedBy=user.id;record(s,'owner_booking_approved',user,{intentId:id,productionId:i.approved.productionId});}return i;});
 return scanAndBook({store,provider,user,id,queuePrint:false});
}
export function enqueuePrint(s,user,i,reprint){
 if(i.redoHold)fail('Redo requested; resolve the affected rugs before printing labels');
 if(!i.booking)fail('No booked label to print');if(!reprint&&s.printJobs.some(j=>j.intentId===i.id&&['queued','claimed','spooled','uncertain'].includes(j.status)))return null;
 const job={id:randomUUID(),intentId:i.id,bookingId:i.booking.id,carrier:i.booking.carrier,format:i.booking.format||'PDF',status:i.booking.format==='ZPL'?'queued':'manual_required',isTest:i.booking.isTest===true,reprint,createdAt:new Date().toISOString()};s.printJobs.push(job);record(s,reprint?'reprint_requested':'print_queued',user,{intentId:i.id,printJobId:job.id});return job;
}
export function requestRedo(s,user,{id,rugId,reason}){
 requireRole(user,['owner','warehouse']);
 if(!['missing','failed quality inspection','sublimation issue'].includes(reason))fail('Choose a supported redo reason',400);
 const i=s.intents.find(i=>i.id===id);if(!i||!i.approved.units.some(u=>u.id===rugId))fail('Rug not found in this shipment',404);
 s.redoRequests||=[];const existing=s.redoRequests.find(r=>r.intentId===id&&r.rugId===rugId&&r.status!=='resolved');if(existing)return existing;
 const request={id:randomUUID(),intentId:id,rugId,orders:i.approved.orders,productionId:i.approved.productionId,reason,status:'queued',flaggedForOwner:true,requestedBy:user.id,requestedAt:new Date().toISOString()};s.redoRequests.push(request);refreshRedoHolds(s);for(const order of request.orders)automatedStage(s,String(order),'in production','redo_requested');
 for(const job of s.printJobs.filter(j=>s.intents.some(x=>x.id===j.intentId&&x.redoHold)&&j.status==='queued')){job.status='cancelled';job.error='Redo requested before printing';}
 record(s,'redo_requested',user,{intentId:id,rugId,reason,redoId:request.id});return request;
}
export function resolveRedo(s,user,{id,qcPassed,packed}){
 requireRole(user,['owner','warehouse']);if(qcPassed!==true||packed!==true)fail('Confirm redo passed QC and was packed',400);
 const r=(s.redoRequests||[]).find(r=>r.id===id);if(!r)fail('Redo not found',404);if(r.status==='resolved')return r;
 r.status='resolved';r.flaggedForOwner=false;r.resolvedAt=new Date().toISOString();r.resolvedBy=user.id;
 const i=s.intents.find(i=>i.id===r.intentId);refreshRedoHolds(s);stageAfterBooking(s,r.orders);record(s,'redo_completed_checked_and_packed',user,{intentId:i.id,redoId:id});return r;
}
function refreshRedoHolds(s){const active=(s.redoRequests||[]).filter(r=>r.status!=='resolved');for(const intent of s.intents)intent.redoHold=active.some(r=>r.orders.some(n=>intent.approved.orders.some(m=>String(m)===String(n))));}
export function reprint(s,user,id){requireRole(user,['owner','warehouse']);const i=s.intents.find(x=>x.id===id);if(!i?.booking)fail('No existing booking');if(s.printJobs.some(j=>j.intentId===id&&['queued','claimed'].includes(j.status)))fail('A print request is already queued or in progress');return enqueuePrint(s,user,i,true);}
export function claimPrint(s,station){const j=s.printJobs.find(j=>j.status==='queued');if(!j)return null;j.status='claimed';j.station=station;j.claimToken=randomUUID();j.claimedAt=new Date().toISOString();return j;}
export function completePrint(s,station,input){const j=s.printJobs.find(j=>j.id===input.id);if(!j||j.status!=='claimed'||j.station!==station||j.claimToken!==input.claimToken)fail('Print claim does not match');if(!['spooled','failed','uncertain'].includes(input.outcome))fail('Invalid print outcome',400);j.status=input.outcome;j.completedAt=new Date().toISOString();j.error=String(input.error||'').slice(0,300);record(s,'print_'+input.outcome,{id:station},{intentId:j.intentId,printJobId:j.id});return j;}
export function verifyApplied(s,user,id,tracking){requireRole(user,['owner','warehouse']);const i=s.intents.find(x=>x.id===id);if(!i?.booking||i.booking.tracking!==tracking)fail('Tracking barcode does not match this package');i.labelAppliedAt=new Date().toISOString();record(s,'label_applied',user,{intentId:id,tracking});return i;}
export async function reconcileBooking({store,provider,user,id}){requireRole(user,['owner']);const before=(await store.read()).intents.find(i=>i.id===id);if(!before||!['booking_uncertain','booking_pending','checking','needs_attention'].includes(before.status))fail('No unresolved booking to reconcile');const booking=await provider.lookup(before.approved);if(!booking)fail('No verified booking found; keep the shipment locked for carrier review');if(booking.carrier!==before.approved.carrier||booking.service!==before.approved.service||!booking.id||!booking.tracking)fail('Existing booking differs from selected service');return store.transaction(s=>{const i=s.intents.find(i=>i.id===id);if(i.approvalHash!==before.approvalHash||i.booking)fail('Shipment changed during reconciliation');if(s.intents.some(x=>x.id!==id&&x.booking?.id===booking.id))fail('Booking already belongs to another shipment');i.booking=booking;i.status='booked';delete i.error;record(s,'booking_reconciled',user,{intentId:id,bookingId:booking.id});return {intent:i,printJob:enqueuePrint(s,user,i,false)};});}
