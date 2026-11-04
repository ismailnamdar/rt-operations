import {createHash} from 'node:crypto';
import {requireRole} from './auth.mjs';
import {fail} from './shipping.mjs';
import {ORDER_QUERY,mergeShopifyOrders} from './shopify-orders.mjs';
import {PRESCAN_ORDER_QUERY} from './live-prescan.mjs';
import {normalizeStage,ORDER_STAGES} from './public/order-stages.js';
import {automatedStage,productionStart} from './stage-automation.mjs';
import {syncVerifiedStatusTags} from './shopify-status.mjs';
const OWNERS={'THE FUCKING GOAT':['awaiting mockup','awaiting approval'],'SHUTTLE 2.0':['awaiting production','in production','cutting / stitching / packing'],'Label Booker':['awaiting carrier','in transit','delivered','ready for pickup','picked up']};
const RANK={'awaiting mockup':0,'awaiting approval':1,'awaiting production':2,'in production':3,'cutting / stitching / packing':4,'awaiting carrier':5,'in transit':6,delivered:7,'ready for pickup':6,'picked up':7};
const activeRedo=(s,order)=>(s.redoRequests||[]).some(r=>!['resolved','cancelled'].includes(r.status)&&r.orders?.map(String).includes(order));
const timestamp=(v,now)=>Number.isFinite(Date.parse(v))&&Date.parse(v)<=now;
export function validateStageRequest(r,now=Date.now()){
 if(!r||typeof r!=='object'||typeof r.requestId!=='string'||r.requestId.length>200||!r.requestId||!/^\d+$/.test(String(r.order))||!/^gid:\/\/shopify\/Order\/\d+$/.test(r.shopifyOrderId||''))throw Error('Exact request and Shopify order identity required');
 const stage=normalizeStage(r.stage);if(!ORDER_STAGES.includes(stage)||!OWNERS[r.sourceChat]?.includes(stage))throw Error('Stage is not owned by the reporting chat');
 if(!timestamp(r.observedAt,now)||now-Date.parse(r.observedAt)>6*3600000)throw Error('Stage evidence is stale or has a future timestamp; refresh its sources');
 const e=r.evidence;if(!e||typeof e!=='object')throw Error('Verified source evidence required');
 if(['awaiting mockup','awaiting approval'].includes(stage)){
  if(!e.threadId||e.currentConversationVerified!==true||(stage==='awaiting approval'?e.currentProofSetVerified!==true:e.currentOrderScopeVerified!==true))throw Error('Current conversation and complete proof set must be verified');
  if(stage==='awaiting approval'&&(!e.sentMessageId||!timestamp(e.proofDeliveredAt,now)||e.customerResponseOwed!==true||e.accessFailure))throw Error('Complete delivered current proof and customer-response evidence required');
  if(stage==='awaiting mockup'&&e.mockupOwed!==true)throw Error('Current mockup obligation required');
 }
 if(OWNERS['SHUTTLE 2.0'].includes(stage)){
  if(!e.approvalSourceMessageId||!e.threadId||!Array.isArray(e.completeProductionFiles)||!e.completeProductionFiles.length||e.completeProductionFiles.some(f=>!f.driveFileId||!f.filename||!timestamp(f.verifiedAt,now)))throw Error('Whole-order approval and complete verified production files required');
  if(stage!=='awaiting production'){
   const start=productionStart(r.productionDate);if(!r.runId||start===null||now<start+(stage==='cutting / stitching / packing'?24*3600000:0))throw Error('Verified run and production clock do not support this stage');
  }
 }
 if(['ready for pickup','picked up'].includes(stage)&&(!e.pickupVerified||!e.readinessVerified||(stage==='picked up'&&!e.collectionVerified)))throw Error('Verified pickup readiness/collection required');
 return {...r,stage,order:String(r.order)};
}
export function applyStageRequest(s,r,user,now=Date.now()){
 requireRole(user,['owner']);r=validateStageRequest(r,now);const {order,stage}=r;
 s.stageEvidenceReceipts||={};const fingerprint=createHash('sha256').update(JSON.stringify(r)).digest('hex'),old=s.stageEvidenceReceipts[r.requestId];
 if(old){if(old.fingerprint!==fingerprint)throw Error('Request identity reused with different evidence');return {...old,duplicate:true};}
 const binding=s.shopifyOrderBindings?.[order];if(!binding?.verified||binding.id!==r.shopifyOrderId)throw Error('Current Shopify identity differs from specialist evidence');
 const commerce=s.shopifyOrders?.[order];if(commerce?.cancelledAt)throw Error('Cancelled order requires reconciliation');
 const prior=s.orderStages?.[order];
 if(prior?.stage!==stage){
  if(prior?.updatedAt&&Date.parse(prior.updatedAt)>Date.parse(r.observedAt))throw Error('Newer canonical stage/correction must be reconciled first');
  if(prior?.stage&&RANK[normalizeStage(prior.stage)]>RANK[stage])throw Error('Earlier stage would regress verified progress; reconcile the revision/redo explicitly');
  if(['ready for pickup','picked up'].includes(prior?.stage)&&!['ready for pickup','picked up'].includes(stage))throw Error('Pickup workflow must not be replaced by a shipping/production inference');
 }
 const shipping=['awaiting carrier','in transit','delivered'].includes(stage);
 if(shipping&&(activeRedo(s,order)||(s.intents||[]).some(i=>i.approved?.orders?.map(String).includes(order)&&(i.redoHold||i.sourceChangedHold||i.status==='held'))))throw Error('Active hold/redo requires its existing stage reconciliation');
 if(!shipping&&['FULFILLED','PARTIALLY_FULFILLED'].includes(commerce?.displayFulfillmentStatus)&&!['ready for pickup','picked up'].includes(stage))throw Error('Existing fulfillment needs shipping/redo reconciliation before a proof/production stage');
 const at=new Date(now).toISOString(),changed=automatedStage(s,order,stage,'specialist:'+r.sourceChat,at);
 if(changed){s.orderStages[order].evidenceRequestId=r.requestId;s.orderStages[order].updatedBy='specialist:'+r.sourceChat;}
 // Production dates advance only from this verified approval+file evidence, never from a tag.
 if(stage==='awaiting production'&&productionStart(r.productionDate)!==null){s.productionFacts||=[];let fact=s.productionFacts.find(f=>String(f.order)===order);if(!fact){fact={order};s.productionFacts.push(fact);}Object.assign(fact,{approvalVerified:true,artworkVerified:true,productionDate:r.productionDate,runId:r.runId||'confirmed-production-'+r.productionDate,evidenceRequestId:r.requestId});}
 s.settings||={};s.settings.shopifyTagSyncEnabled=true;s.shopifyStatusSync||={};if(changed||s.shopifyStatusSync[order]?.status!=='synced')s.shopifyStatusSync[order]={...s.shopifyStatusSync[order],status:'pending'};
 const receipt={requestId:r.requestId,order,stage,sourceChat:r.sourceChat,fingerprint,status:changed?'applied':'unchanged',appliedAt:at,submittedBy:user.id,evidence:r.evidence};s.stageEvidenceReceipts[r.requestId]=receipt;return receipt;
}
async function shippingEvidence(r,commerce,parsel,now){
 const e=r.evidence,packages=e.packages;if(!parsel||e.packageCoverageComplete!==true||!Array.isArray(packages)||!packages.length||packages.length>20||packages.some(p=>!p.labelId||!p.tracking))throw Error('Complete exact package/label evidence and Parsel connection required');
 const fulfillments=commerce.fulfillments;if(!Array.isArray(fulfillments)||fulfillments.length>=100)throw Error('Current fulfillment coverage incomplete');
 const tracked=[...new Set(fulfillments.filter(f=>!['CANCELLED','ERROR','FAILURE'].includes(f.status)).flatMap(f=>f.trackingInfo||[]).map(t=>t.number).filter(Boolean))].sort();
 const requested=[...new Set(packages.map(p=>p.tracking))].sort();if(tracked.length!==packages.length||JSON.stringify(tracked)!==JSON.stringify(requested))throw Error('Package set differs from current Shopify tracking; reconcile missing or duplicate shipments');
 if(!commerce.requiresShipping)throw Error('Non-shipping/pickup order needs pickup reconciliation');
 const labels=await Promise.all(packages.map(async p=>{const raw=await parsel.api('/shipping_labels/'+encodeURIComponent(p.labelId));const l=raw.data||raw;if(l.id!==p.labelId||l.tracking_code!==p.tracking||/VOID|CANCEL|REFUND|FAIL/i.test(l.status||'')||!l.shipping_rate?.shipment_id)throw Error('Parsel label is unavailable or mismatched');const shipRaw=await parsel.api('/shipments/'+encodeURIComponent(l.shipping_rate.shipment_id)),ship=shipRaw.data||shipRaw;const ref=String(ship.custom_reference_1||'').trim().match(/^(?:Order\s*#?\s*|#?)(\d+)$/i)?.[1];if(ship.id!==l.shipping_rate.shipment_id||ref!==r.order||ship.shipping_label?.id!==l.id)throw Error('Parsel shipment-to-order link differs');return {labelId:l.id,tracking:l.tracking_code,status:l.status,firstScanAt:l.first_carrier_scan_at||null,deliveredAt:l.delivered_at||null,checkedAt:new Date(now).toISOString()};}));
 const delivered=labels.every(l=>timestamp(l.deliveredAt,now)),accepted=labels.every(l=>timestamp(l.firstScanAt,now)||timestamp(l.deliveredAt,now));
 const actual=delivered?'delivered':accepted?'in transit':'awaiting carrier';if(actual!==r.stage)throw Error('Live carrier progress differs from proposed stage; refresh the audit');return labels;
}
export async function ingestSpecialistStages({store,client,parsel,user,requests,now=Date.now()}){
 requireRole(user,['owner']);if(!client)fail('Shopify is not connected',503);if(!Array.isArray(requests)||!requests.length||requests.length>5)fail('Submit one to five specialist requests at a time',400);
 const results=[];for(const value of requests){let r;try{r=validateStageRequest(value,now);const current=(await client.request(ORDER_QUERY,{id:r.shopifyOrderId}))?.order;if(current?.id!==r.shopifyOrderId||String(current.name).replace(/^#/,'')!==r.order)throw Error('Live Shopify order identity mismatch');let labels=null;
  if(['awaiting carrier','in transit','delivered'].includes(r.stage)){const commerce=(await client.request(PRESCAN_ORDER_QUERY,{id:r.shopifyOrderId}))?.order;if(commerce?.id!==r.shopifyOrderId)throw Error('Current shipment order identity mismatch');labels=await shippingEvidence(r,commerce,parsel,now);}
  const receipt=await store.transaction(s=>{mergeShopifyOrders(s,[current],{trackImport:false});const receipt=applyStageRequest(s,r,user,now);if(labels){s.carrierStageEvidence||={};s.carrierStageEvidence[r.order]={packages:labels,checkedAt:new Date(now).toISOString()};}return receipt;});results.push({requestId:r.requestId,order:r.order,stage:receipt.stage,status:receipt.status,duplicate:!!receipt.duplicate});
 }catch(error){results.push({requestId:value?.requestId,order:String(value?.order||''),status:'needs_attention',error:error.message});}}
 const orders=results.filter(r=>r.status!=='needs_attention').map(r=>r.order);let tagSync=null;if(orders.length)tagSync=await syncVerifiedStatusTags({store,client,orders,limit:orders.length});const final=await store.read();for(const r of results)r.tagStatus=final.shopifyStatusSync?.[r.order]?.status||'not_updated';return {results,tagSync};
}
