import {normalizeStage} from './public/order-stages.js';
import {randomUUID} from 'node:crypto';
export function automatedStage(s,order,stage,source,at=new Date().toISOString()){s.orderStages||={};if(s.orderStages[order]?.stage===stage)return false;s.orderStages[order]={stage,updatedAt:at,updatedBy:'automation',source};s.events.push({id:randomUUID(),at,type:'order_stage_automated',order,stage,source});return true;}
export function productionStart(date){if(!/^\d{4}-\d{2}-\d{2}$/.test(date||''))return null;const base=Date.parse(date+'T00:00:00Z');for(let hour=6;hour<=18;hour++){const stamp=base+hour*3600000,parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'}).formatToParts(stamp).map(p=>[p.type,p.value]));if(`${parts.year}-${parts.month}-${parts.day}`===date&&parts.hour==='08')return stamp;}return null;}
export function advanceProductionStages(s,now=Date.now()){
 for(const fact of s.productionFacts||[]){const order=String(fact.order),stage=normalizeStage(s.orderStages?.[order]?.stage);if(['awaiting carrier','in transit','delivered','ready for pickup','picked up'].includes(stage))continue;
  const redos=(s.redoRequests||[]).filter(r=>r.status!=='resolved'&&r.orders.some(n=>String(n)===order));if(redos.length){automatedStage(s,order,'in production','active_redo',new Date(now).toISOString());continue;}
  if(fact.approvalVerified!==true||fact.artworkVerified!==true)continue;
  if(!stage||['awaiting approval','awaiting mockup','in queue for production'].includes(stage))automatedStage(s,order,'awaiting production','approval_and_artwork_verified',new Date(now).toISOString());
  const start=productionStart(fact.productionDate);if(start===null||!fact.runId||now<start)continue;
  const current=s.orderStages[order].stage;if(current==='awaiting production')automatedStage(s,order,'in production','production_day_0800',new Date(now).toISOString());
  if(now>=start+24*3600000&&s.orderStages[order].stage==='in production')automatedStage(s,order,'cutting / stitching / packing','production_24_hours',new Date(now).toISOString());
 }
}
export function stageAfterBooking(s,orders){for(const value of orders){const order=String(value),packages=s.intents.filter(i=>i.approved.orders.some(n=>String(n)===order));if(['ready for pickup','picked up'].includes(s.orderStages?.[order]?.stage))continue;if(packages.some(i=>i.redoHold))automatedStage(s,order,'in production','redo_hold');else if(packages.length&&packages.every(i=>i.booking)&&s.orderStages?.[order]?.stage!=='delivered'&&s.orderStages?.[order]?.stage!=='in transit')automatedStage(s,order,'awaiting carrier','all_labels_booked');}}

// Carrier progress requires fresh, exact-label evidence for every active package.
export function advanceCarrierStages(s,now=Date.now()){
 if(s.parselHistory?.complete!==true||now-Date.parse(s.parselHistory.checkedAt||0)>15*60000)return;
 const orders=new Set((s.intents||[]).flatMap(i=>i.approved.orders.map(String)));
 for(const order of orders){
  const stage=normalizeStage(s.orderStages?.[order]?.stage);if(['delivered','ready for pickup','picked up'].includes(stage))continue;
  const packages=(s.intents||[]).filter(i=>i.approved.orders.map(String).includes(order));
  if(!packages.length||packages.some(i=>!i.booking||i.redoHold||i.sourceChangedHold||i.status==='held')||(s.redoRequests||[]).some(r=>!['resolved','cancelled'].includes(r.status)&&r.orders.map(String).includes(order)))continue;
  const labels=packages.map(i=>s.parselHistory.labels?.[i.booking.id]);
  if(labels.some((l,n)=>!l||/VOID|CANCEL|REFUND|FAIL|RETURN|EXCEPTION/i.test(l.status||'')||l.tracking!==packages[n].booking.tracking))continue;
  const verified=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))&&Date.parse(value)<=now;
  if(labels.every(l=>l.status==='DELIVERED'||verified(l.deliveredAt)))automatedStage(s,order,'delivered','all_packages_delivered',new Date(now).toISOString());
  else if(labels.every(l=>['IN_TRANSIT','OUT_FOR_DELIVERY','DELIVERED'].includes(l.status)||verified(l.firstScanAt)||verified(l.deliveredAt)))automatedStage(s,order,'in transit','all_packages_carrier_accepted',new Date(now).toISOString());
 }
}
