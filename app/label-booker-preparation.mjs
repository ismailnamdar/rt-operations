import {packing,POLICY_VERSION} from './label-booker-packing.mjs';
import {fingerprint,fail} from './shipping.mjs';
// Packing preparation only. Fresh carrier/commerce checks and owner cost approval
// are independent gates and cannot be inferred from a historically correct box.
export function prepareLabelBookerPacking(s,runId){
 const run=s.snapshot.productionRuns?.runs?.find(r=>r.id===runId);if(!run)fail('Production run not found',404);
 const rows=(run.orders||[]).map(order=>{
  const rugs=order.rugs||[],issues=[];
  if(!rugs.length||rugs.some(r=>!r.sourceFileId))issues.push('Artwork-to-physical-rug scope needs verification.');
  if(rugs.some(r=>r.quantityVerified!==true))issues.push('Final photo must verify each physical rug; quantity suffixes are not multipliers per copy.');
  if(rugs.some(r=>/\.pdf$/i.test(r.fileName||'')))issues.push('Review PDF is not verified production artwork.');
  const intents=(s.intents||[]).filter(i=>i.approved.orders.some(n=>String(n)===String(order.order)));
  if(order.hold||intents.some(i=>i.redoHold||i.approved.hold)||(s.redoRequests||[]).some(r=>r.status!=='resolved'&&r.orders.some(n=>String(n)===String(order.order))))issues.push('Order is held or contains an active redo.');
  let estimate;try{estimate=packing(rugs.map(r=>({size:r.size,quantity:1})),s.labelBookerLearnedBoxes||[]);if(estimate.needsConfirmation||!estimate.box||!Number.isFinite(estimate.lb))issues.push('Exact package combination needs verified dimensions/weight.');if(estimate.over100lb)issues.push('Over 100 lb: compare an eligible split-package plan.');}catch{estimate={box:null,lb:null,needsConfirmation:true};issues.push('Custom or ambiguous dimensions require verification.');}
  const commerce=s.shopifyOrders?.[String(order.order)];
  if(!commerce)issues.push('Current Shopify identity, address, payment and active line items must be retrieved.');
  if(commerce?.displayFulfillmentStatus==='FULFILLED'||intents.some(i=>i.booking))issues.push('Existing fulfillment/label: reconcile and reuse only if current carrier status permits; never repurchase automatically.');
  return {order:String(order.order),rugs:rugs.map(r=>({fileId:r.sourceFileId,size:r.size,quantity:1})),packing:estimate,issues,readyToPurchase:false};
 });
 return {runId,runName:run.name,policyVersion:POLICY_VERSION,sourceFingerprint:fingerprint({run,policyVersion:POLICY_VERSION,learned:s.labelBookerLearnedBoxes||[]}),orders:rows,nonShipping:(run.unmatchedFiles||[]).map(f=>({fileId:f.sourceFileId||f.id,reason:'Unnumbered/UGC artwork: retain production coverage, exclude automatic shipping.'})),requires:['Final photo scope verification','Fresh Parsel and historical-label reconciliation','Current address/payment/hold checks','Actual handoff date/time and customer deadlines','Current cheapest eligible rates','One consolidated owner purchase approval'],readyToPurchase:false,purchases:0};
}
