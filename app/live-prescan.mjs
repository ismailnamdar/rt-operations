import {randomUUID} from 'node:crypto';
import {fingerprint,fail,record} from './shipping.mjs';
import {requireRole} from './auth.mjs';
import {prepareEarlyPrescan,artworkFingerprint} from './early-prescan.mjs';
import {stageAfterBooking,advanceCarrierStages} from './stage-automation.mjs';
import {fulfillmentPlan,saveFulfillment} from './prescan-fulfillment.mjs';

export const PRESCAN_ORDER_QUERY=`query PrescanOrder($id: ID!){order(id:$id){id name email updatedAt cancelledAt displayFinancialStatus displayFulfillmentStatus requiresShipping tags shippingAddress{name company address1 address2 city provinceCode zip countryCodeV2 phone} shippingLines(first:100){nodes{title code isRemoved currentDiscountedPriceSet{shopMoney{amount currencyCode}}}pageInfo{hasNextPage}} fulfillments(first:100){id status trackingInfo{number company}}}}`;
const date=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v+'T12:00:00Z'))&&new Date(v+'T12:00:00Z').toISOString().slice(0,10)===v;
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Los_Angeles'}).format(new Date());
const orderRef=v=>String(v||'').trim().match(/^(?:Order\s*#?\s*|#?)(\d{4,6})$/i)?.[1];
const active=s=>(s.prescanJobs||[]).filter(j=>j.kind==='early_intake'&&j.status!=='superseded');
export function productionHandoff(s,run){return s.productionPrescan?.[run.id]?.productionDate||run.productionDate||run.date||null;}
export function shippingExclusion(s,run,order,commerce){
 const decision=s.productionPrescan?.[run.id]?.orders?.[order.order]||{};
 if(decision.disposition==='pickup'||order.pickup||commerce?.requiresShipping===false||commerce?.tags?.some(t=>/^pickup$|^shuttle:\s*pickup$/i.test(t)))return 'Pickup — no label purchase';
 if(decision.disposition==='hold'||order.hold||commerce?.tags?.some(t=>/^hold$|^shuttle:\s*hold$/i.test(t))||(s.intents||[]).some(i=>i.approved.orders.map(String).includes(String(order.order))&&(i.redoHold||i.status==='held'))||(s.redoRequests||[]).some(r=>r.status!=='resolved'&&r.orders.map(String).includes(String(order.order))))return 'Order is on hold';
 return null;
}
const clean=v=>String(v||'').trim().replace(/\s+/g,' ');
const suppliedAddress=a=>Object.fromEntries(['name','company','street1','street2','city','state','zip','country','phone','email'].filter(k=>typeof a?.[k]==='string'&&a[k].trim()).map(k=>[k,clean(a[k])]));
export function shippingAddress(order){const a=order.shippingAddress||{};return Object.fromEntries(Object.entries({name:clean(a.name),company:clean(a.company),street1:clean(a.address1),street2:clean(a.address2),city:clean(a.city),state:clean(a.provinceCode),zip:clean(a.zip),country:clean(a.countryCodeV2),phone:clean(a.phone),email:clean(order.email)}).filter(([,v])=>v));}
function completeAddress(a){return ['name','street1','city','state','zip','country'].every(k=>typeof a?.[k]==='string'&&a[k].trim());}
export function chooseRate(rates,{deadline,paidShipping=false}={}){
 let eligible=(rates||[]).filter(r=>r.id&&['UPS','OnTrac'].includes(r.carrier)&&r.service&&r.price?.currency==='USD'&&Number.isFinite(Number(r.price.amount))&&Number(r.price.amount)>0);
 if(paidShipping&&deadline){eligible=eligible.filter(r=>{const at=r.estimated_delivery_date;if(typeof at!=='string'||!Number.isFinite(Date.parse(at)))return false;if(/^\d{4}-\d{2}-\d{2}$/.test(deadline))return at.slice(0,10)<=deadline;return /T\d{2}:\d{2}.*(?:Z|[+-]\d{2}:\d{2})$/.test(at)&&Date.parse(at)<=Date.parse(deadline);});}
 // Paid expedited service needs a verified deadline. A remembered service is insufficient.
 if(paidShipping&&!deadline)return {selected:null,reason:'Paid shipping needs a verified arrival deadline before service selection.'};
 eligible.sort((a,b)=>Number(a.price.amount)-Number(b.price.amount));return {selected:eligible[0]||null,reason:eligible.length?null:paidShipping?'No verified deadline-compatible UPS or OnTrac rate is available.':'No eligible UPS or OnTrac rate is available.'};
}
export function prescanReport(s,runId){
 const run=s.snapshot.productionRuns?.runs?.find(r=>r.id===runId);if(!run)fail('Production run not found',404);
 const config=s.productionPrescan?.[runId]||{},jobs=active(s).filter(j=>j.runId===runId),rows=jobs.map(j=>({id:j.id,order:j.order,status:j.liveStatus||j.status,packing:j.packing,issues:j.liveIssues||j.issues||[],addressWarnings:[...(j.live?.addressWarnings||[]),...(j.addressWarnings||[])],shipDate:j.live?.shipDate,rate:j.live?.selectedRate?{id:j.live.selectedRate.id,carrier:j.live.selectedRate.carrier,service:j.live.selectedRate.service,costCents:Math.round(Number(j.live.selectedRate.price.amount)*100),currency:j.live.selectedRate.price.currency,arrival:j.live.selectedRate.estimated_delivery_date}:null,existingLabels:j.live?.existingLabels||[],destination:j.live?.destination,addressStatus:j.addressCheck?.facts?.status||'Pending',verifiedAt:j.live?.checkedAt,approval:j.ownerApproval||null,addressOverrideApplied:!!config.orders?.[j.order]?.destination,disposition:config.orders?.[j.order]?.disposition||'include',deadline:config.orders?.[j.order]?.deadline||'',note:config.orders?.[j.order]?.note||'',booking:j.booking?{id:j.booking.id,tracking:j.booking.tracking,carrier:j.booking.carrier,service:j.booking.service}:null}));
 const revision=fingerprint(rows.map(r=>({id:r.id,status:r.status,rate:r.rate,verifiedAt:r.verifiedAt,issues:r.issues,addressWarnings:r.addressWarnings,disposition:r.disposition,deadline:r.deadline})));return {runId,runName:run.name,phase:config.phase||'prescanning',productionDate:productionHandoff(s,run),sender:s.prescanSender||null,senderConfigured:completeAddress(s.prescanSender),historyComplete:s.parselHistory?.complete===true,historyCheckedAt:s.parselHistory?.checkedAt,rows,revision,totalCents:rows.filter(r=>r.status==='ready_for_owner').reduce((n,r)=>n+(r.rate?.costCents||0),0)};
}
export function respondPrescan(s,user,b){
 requireRole(user,['owner']);const report=prescanReport(s,b.runId);s.productionPrescan||={};const config=s.productionPrescan[b.runId]||={orders:{}};config.orders||={};
 if(b.action==='configure'){
  if(active(s).some(j=>j.runId===b.runId&&['purchasing','booking_uncertain'].includes(j.liveStatus)))fail('A purchase is in progress or uncertain; reconcile its receipt before changing this run.');
  if(!date(b.productionDate))fail('Set the production date in YYYY-MM-DD format',400);if(b.note!==undefined&&(typeof b.note!=='string'||b.note.length>4000))fail('Response is too long',400);
  config.productionDate=b.productionDate;config.note=b.note||'';config.updatedAt=new Date().toISOString();config.updatedBy=user.id;
  if(b.sender){if(!completeAddress(b.sender))fail('Sender address is incomplete',400);s.prescanSender=Object.fromEntries(['name','company','street1','street2','city','state','zip','country','phone','email'].filter(k=>b.sender[k]).map(k=>[k,clean(b.sender[k])]));}
  if(b.orders){if(!Array.isArray(b.orders))fail('Order corrections must be a list',400);for(const row of b.orders){if(!report.rows.some(j=>j.order===String(row.order)))fail('Order is outside this run',400);if(!['include','hold','pickup'].includes(row.disposition))fail('Unknown shipping disposition',400);if(row.deadline&&!date(row.deadline)&&!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}.*(?:Z|[+-]\d{2}:\d{2})$/.test(row.deadline))fail('Deadline needs a date or a timestamp with timezone',400);const patch={disposition:row.disposition,deadline:row.deadline||'',note:String(row.note||'').slice(0,2000)};if(row.package){if(!['length','width','height','weight'].every(k=>Number.isFinite(row.package[k])&&row.package[k]>0))fail('Package dimensions/weight must be positive',400);patch.package={...Object.fromEntries(['length','width','height','weight'].map(k=>[k,row.package[k]])),length_unit:'IN',weight_unit:'LB'};}if(row.applyAddressOverride===true){if(!completeAddress(row.destination))fail('Corrected recipient address is incomplete',400);const job=active(s).find(j=>j.runId===b.runId&&j.order===String(row.order));if(!job?.commerceAddressHash)fail('Refresh this order before overriding its address');patch.destination=Object.fromEntries(['name','company','street1','street2','city','state','zip','country','phone','email'].filter(k=>row.destination[k]).map(k=>[k,clean(row.destination[k])]));patch.destinationSourceHash=job.commerceAddressHash;}config.orders[String(row.order)]={...config.orders[String(row.order)],...patch};if(row.applyAddressOverride===false){delete config.orders[String(row.order)].destination;delete config.orders[String(row.order)].destinationSourceHash;}}}
  for(const j of active(s).filter(j=>j.runId===b.runId&&!j.booking)){delete j.ownerApproval;j.nextCheckAt=0;j.liveStatus='queued';}
  record(s,'prescan_owner_response',user,{runId:b.runId,note:config.note});return {ok:true};
 }
 if(['approve','proceed'].includes(b.action)){
  if(b.action==='proceed'&&report.rows.some(r=>['queued','awaiting_live_verification'].includes(r.status)))fail('Prescan is still running. Review its progress in Gideon before proceeding.');
  if(b.revision!==report.revision)fail('Prescan changed; review the current report before approving');if(b.scopeVerified!==true)fail('Verify the complete production artwork and physical rug scope before approving');
  const ready=report.rows.filter(r=>r.status==='ready_for_owner'&&r.rate);if(!ready.length)fail('No verified shipments are ready for purchase');
  for(const row of ready){const j=s.prescanJobs.find(j=>j.id===row.id);if(Date.now()-Date.parse(j.live.checkedAt)>15*60000)fail('Prescan expired; refresh its rates before approving');j.ownerApproval={actor:user.id,at:new Date().toISOString(),inputHash:j.live.inputHash,rateId:row.rate.id,maxCostCents:row.rate.costCents,scopeVerified:true,addressWarnings:structuredClone(row.addressWarnings||[]),note:String(b.note||'').slice(0,4000)};j.liveStatus='purchase_approved';}
  config.phase='booking';config.addressWarningPolicy='use_supplied_unless_provider_blocks';config.prescanClosedAt=new Date().toISOString();config.closedBy=user.id;
  record(s,'prescan_batch_purchase_approved',user,{runId:b.runId,jobIds:ready.map(r=>r.id),totalCents:ready.reduce((n,r)=>n+r.rate.costCents,0),revision:report.revision});return {ok:true,approved:ready.length};
 }
 fail('Unknown prescan action',400);
}

export class LivePrescan{
 constructor({store,client,carrier,now=()=>Date.now()}){Object.assign(this,{store,client,carrier,now});}
 async api(route,{method='GET',body}={}){const response=await this.carrier.fetchImpl(this.carrier.baseUrl+route,{method,headers:{Authorization:'Bearer '+this.carrier.token,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,redirect:'error',signal:AbortSignal.timeout(8000)});let value;try{value=await response.json();}catch{throw Error('Parsel response could not be verified');}if(!response.ok){const errors=Array.isArray(value.errors)?value.errors:value.errors?.reasons||[];const reason=errors.map(e=>[e.source?.pointer||e.carrier,e.detail||e.message||e.title].filter(Boolean).join(' ')).join('; ').slice(0,1500);const e=Error('Parsel '+method+' '+route.split('?')[0]+' returned '+response.status+(reason?': '+reason:''));e.providerStatus=response.status;throw e;}if(value?.errors&&!Array.isArray(value.errors))throw Error('Parsel returned a validation error');return value;}
 async syncHistory(limit=24,force=false){
  let state=await this.store.read(),history=state.parselHistory;
  if(force||!history?.listingComplete||this.now()-Date.parse(history.checkedAt||0)>300000){const page=history?.listingComplete?1:history?.nextPage||1,result=await this.api('/shipping_labels?page='+page+'&page_size=100');if(!Array.isArray(result.data))throw Error('Parsel label pagination is incomplete');const meta=result.metadata||{},numbered=Number.isInteger(meta.current_page)&&meta.current_page===page&&Number.isInteger(meta.total_pages)&&meta.total_pages>=page,hasNext=numbered?meta.current_page<meta.total_pages:meta.has_next_page;if(typeof hasNext!=='boolean'||(numbered&&typeof meta.has_next_page==='boolean'&&meta.has_next_page!==hasNext))throw Error('Parsel label pagination is incomplete');
   await this.store.transaction(s=>{s.parselHistory||={labels:{},shipments:{}};const h=s.parselHistory;if(page===1){h.complete=false;h.listingComplete=false;}for(const label of result.data){if(!label.id||!label.shipping_rate?.shipment_id)throw Error('Label-to-shipment link is missing');h.labels[label.id]={id:label.id,shipmentId:label.shipping_rate.shipment_id,tracking:label.tracking_code,carrier:label.shipping_rate.carrier,service:label.shipping_rate.service,status:label.status,createdAt:label.created_at,firstScanAt:label.first_carrier_scan_at,deliveredAt:label.delivered_at};}h.nextPage=hasNext?page+1:1;h.listingComplete=!hasNext;h.checkedAt=new Date(this.now()).toISOString();});
  }
  state=await this.store.read();const h=state.parselHistory,pending=[...new Set(Object.values(h.labels).map(l=>l.shipmentId))].filter(id=>!h.shipments[id]).slice(0,limit);
  // Small concurrent groups avoid one HTTP call per label on every later prescan.
  const stopAt=this.now()+20000;
  for(let at=0;at<pending.length&&this.now()<stopAt-8000;at+=4){
   const results=await Promise.allSettled(pending.slice(at,at+4).map(async id=>{
    const ship=(await this.api('/shipments/'+encodeURIComponent(id))).data;
    if(ship?.id!==id)throw Error('Shipment identity mismatch');
    return {id,order:orderRef(ship.custom_reference_1),destination:ship.destination,parcel:ship.parcel,labelId:ship.shipping_label?.id,origin:ship.origin,returnAddress:ship.return_address};
   }));
   const verified=results.filter(r=>r.status==='fulfilled').map(r=>r.value);
   // Persist verified reads together; a failed sibling remains pending, not lost.
   if(verified.length)await this.store.transaction(s=>{for(const ship of verified){s.parselHistory.shipments[ship.id]=ship;if(!s.prescanSender&&completeAddress(ship.origin)&&/^\+?1?949/.test(String(ship.origin.phone||'').replace(/\D/g,'')))s.prescanSender=suppliedAddress(ship.origin);}});
   const failed=results.find(r=>r.status==='rejected');if(failed)throw failed.reason;
  }
  await this.store.transaction(s=>{const h=s.parselHistory;h.complete=h.listingComplete&&Object.values(h.labels).every(l=>h.shipments[l.shipmentId]);advanceCarrierStages(s,this.now());});
 }
 async commerce(order){const s=await this.store.read(),id=s.shopifyOrderBindings?.[order]?.id;if(!id||s.shopifyConnection?.revoked)throw Error('Current Shopify order binding is unavailable');const value=(await this.client.request(PRESCAN_ORDER_QUERY,{id}))?.order;if(value?.id!==id||String(value.name).replace(/^#/,'')!==order)throw Error('Shopify order identity does not match');if(!value.shippingLines||value.shippingLines.pageInfo.hasNextPage||!Array.isArray(value.fulfillments)||value.fulfillments.length>=100)throw Error('Shopify shipping/fulfillment coverage is incomplete');return value;}
 async inspect(job){
  const commerce=await this.commerce(job.order),s=await this.store.read(),run=s.snapshot.productionRuns.runs.find(r=>r.id===job.runId),order=run?.orders.find(o=>String(o.order)===job.order);if(!order)throw Error('Artwork was removed from the run');
  const config=s.productionPrescan?.[job.runId]?.orders?.[job.order]||{},exclusion=shippingExclusion(s,run,order,commerce),shipDate=productionHandoff(s,run),originalDestination=shippingAddress(commerce),destination=config.destination||originalDestination,paidShipping=commerce.shippingLines.nodes.some(l=>!l.isRemoved&&Number(l.currentDiscountedPriceSet?.shopMoney?.amount)>0),issues=[];
  const commerceAddressHash=fingerprint(originalDestination);await this.store.transaction(state=>{const j=state.prescanJobs.find(j=>j.id===job.id);if(j)j.commerceAddressHash=commerceAddressHash;});if(config.destination&&config.destinationSourceHash!==commerceAddressHash)issues.push('Shopify address changed after the manual correction; review the destination again.');
  const source=active(s).find(j=>j.id===job.id);if(!source||job.sourceFingerprint!==artworkFingerprint(order))throw Error('Prescan source was superseded');
  const pack=config.package||(job.packing?.box&&Number.isFinite(job.packing.lb)&&!job.packing.needsConfirmation?{length:job.packing.box[0],width:job.packing.box[1],height:job.packing.box[2],weight:job.packing.lb,length_unit:'IN',weight_unit:'LB'}:null);
  if(exclusion)return {status:'excluded',issues:[exclusion],shipDate,addressWarnings:job.live?.addressWarnings||[]};
  if(!date(shipDate))issues.push('Assign this Pro folder its production date; handoff uses that same date.');else if(shipDate<today())issues.push('Production/handoff date has passed; refresh the actual handoff date.');
  if(commerce.cancelledAt)issues.push('Order is cancelled.');if(commerce.displayFinancialStatus!=='PAID')issues.push('Payment is not verified PAID.');
  if(!pack||pack.weight>100)issues.push('Confirm an exact package/split plan and weight.');
  if(!destination.phone)issues.push('Verified recipient phone is missing.');if(!destination.email||/^info@rugtomize\.(co|com)$/i.test(destination.email))issues.push('Verified customer notification email is missing.');
  if(!completeAddress(destination))issues.push('Recipient address is incomplete.');if(!completeAddress(s.prescanSender))issues.push('Verified Parsel sender address is missing.');
  const historical=Object.values(s.parselHistory?.shipments||{}).filter(x=>x.labelId&&(x.order===job.order||!x.order&&['name','street1','street2','zip','country'].every(k=>clean(x.destination?.[k]).toUpperCase()===clean(destination[k]).toUpperCase()))),known=historical.map(x=>s.parselHistory.labels[x.labelId]).filter(Boolean),tracking=commerce.fulfillments.filter(f=>!['CANCELLED','ERROR','FAILURE'].includes(f.status)).flatMap(f=>f.trackingInfo||[]).filter(t=>t.number);
  if(known.length||tracking.length||s.intents.some(i=>i.approved.orders.map(String).includes(job.order)&&i.booking)){return {status:'existing_label_review',issues:['Existing shipment/label found. Verify current carrier status, destination and complete package coverage; no new label is purchased.'],shipDate,destination,existingLabels:[...known,...tracking.map(t=>({tracking:t.number,carrier:t.company,source:'shopify'}))]};}
  if(commerce.displayFulfillmentStatus==='FULFILLED')issues.push('Order is already fulfilled; owner replacement-shipment decision required.');
  if(s.parselHistory?.complete!==true)issues.push('Parsel label-history reconciliation is still running.');
  if((s.redoRequests||[]).some(r=>r.orders.map(String).includes(job.order)))issues.push('Redo/replacement shipment requires review of its existing label and shipping scope.');
  if(paidShipping&&!config.deadline)issues.push('Paid expedited shipping requires a verified arrival deadline.');
  const inputHash=fingerprint({source:job.sourceFingerprint,commerce,config,shipDate,pack,sender:s.prescanSender});
  const addressWarnings=[];let v=null;const addressHash=fingerprint(destination);if(completeAddress(destination)){const cache=job.addressCheck;if(cache?.sourceHash===addressHash&&Date.now()-Date.parse(cache.at)<4*3600000)v=cache.facts;else{try{const validation=await this.api('/addresses/verify',{method:'POST',body:{address:destination}});v=validation.data||validation;}catch(error){v={status:'UNVERIFIED',warning:'Address validation service could not confirm the supplied address.'};}await this.store.transaction(state=>{const j=state.prescanJobs.find(j=>j.id===job.id);if(j)j.addressCheck={sourceHash:addressHash,facts:v,at:new Date().toISOString()};});}}
  if(v?.status!=='VALID')addressWarnings.push({message:'Address validation '+(v?.status||'UNVERIFIED')+'. The supplied address will be used if Parsel accepts the shipment.',staffMessage:'Address validation warning. The supplied address is retained.',blocking:false});
  const normalized={...destination,...v?.validated_address};for(const key of ['street1','street2','zip','country']){const normalize=x=>String(x||'').toUpperCase().replace(/[^A-Z0-9]/g,'');if(normalize(normalized[key])!==normalize(destination[key]))addressWarnings.push({message:'Parsel suggests a change to '+key+'. The supplied address is retained for booking.',staffMessage:'Parsel suggested an address-field correction ('+key+'); the supplied address was retained.',blocking:false});}
  if(issues.length){for(const message of issues.filter(i=>/address|recipient|phone|notification email|company/i.test(i)))addressWarnings.push({message,staffMessage:'A required shipping-address field or correction needs owner attention.',blocking:true});return {status:'needs_attention',issues,shipDate,destination,inputHash,addressValidation:v,addressWarnings};}
  let shipment=job.live?.inputHash===inputHash&&job.live?.shipmentId?(await this.api('/shipments/'+encodeURIComponent(job.live.shipmentId))).data:null;
  if(!shipment){await this.store.transaction(state=>{const j=state.prescanJobs.find(j=>j.id===job.id);if(['uncertain','started'].includes(j.quoteAttempt?.status))fail('Prior draft creation needs reconciliation');j.quoteAttempt={status:'started',reference:'SHUTTLE:'+job.id,at:new Date().toISOString()};});
   try{shipment=(await this.api('/shipments',{method:'POST',body:{origin:suppliedAddress(s.prescanSender),return_address:suppliedAddress(s.prescanSender),destination,parcel:pack,ship_date:shipDate,custom_reference_1:job.order,custom_reference_2:'SHUTTLE:'+job.id,buy_cheapest_rate:false,label_format:'PDF',rate_shopping_strategy:'ALL'}})).data;if(!shipment?.id||shipment.shipping_label)throw Error('Unexpected shipment/label response');await this.store.transaction(state=>{const j=state.prescanJobs.find(j=>j.id===job.id);j.quoteAttempt={...j.quoteAttempt,status:'verified',shipmentId:shipment.id};j.live={...j.live,inputHash,shipmentId:shipment.id};});}catch(error){await this.store.transaction(state=>{state.prescanJobs.find(j=>j.id===job.id).quoteAttempt.status=[400,401,403,404,422].includes(error.providerStatus)?'rejected':'uncertain';});throw error;}}
  if(shipment.shipping_label)return {status:'existing_label_review',issues:['This draft already has a label; reconcile it before any further purchase.'],shipDate,destination,inputHash,shipmentId:shipment.id};
  const fieldEqual=(a,b)=>String(a||'').toUpperCase().replace(/[^A-Z0-9]/g,'')===String(b||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
  if(!['name','company','street1','street2','city','state','zip','country','phone'].every(k=>fieldEqual(shipment.destination?.[k],destination[k]))||(shipment.ship_date&&shipment.ship_date!==shipDate))throw Error('Parsel draft address or handoff date differs from the current prescan');
  const actual=shipment.parcel||{},weight=actual.weight_unit==='OZ'?Number(actual.weight)/16:Number(actual.weight);if(actual.length_unit!=='IN'||!['length','width','height'].every(k=>Number(actual[k])===pack[k])||weight!==pack.weight)throw Error('Parsel draft package differs from the verified packing plan');
  const selected=chooseRate(shipment.shipping_rates,{deadline:config.deadline,paidShipping}),rate=selected.selected;
  if(selected.reason)issues.push(selected.reason);if(rate?.carrier==='UPS'&&String(destination.company||'').length>34){const message='UPS company field exceeds its verified 34-character limit.';issues.push(message);addressWarnings.push({message,staffMessage:message,blocking:true});}
  try{await fulfillmentPlan(this.client,commerce.id,order.rugs.length);}catch(error){issues.push(error.message);}
  const units=order.rugs.map(r=>({id:r.sourceFileId,design:r.fileName,size:r.size,previewUrl:r.previewUrl,qcPassed:false}));
  return {units,addressWarnings,status:rate&&!issues.some(x=>!x.startsWith('Standing over-$100'))?'ready_for_owner':'needs_attention',issues,shipDate,destination,inputHash,shipmentId:shipment.id,selectedRate:rate,package:pack,paidShipping,addressValidation:{status:v?.status||'UNVERIFIED'},checkedAt:new Date().toISOString(),sourceFingerprint:job.sourceFingerprint};
 }
 async run({limit=6,runId=null}={}){
  await this.store.transaction(s=>prepareEarlyPrescan(s));const before=await this.store.read();await this.syncHistory(24,active(before).some(j=>j.ownerApproval&&!j.booking));const s=await this.store.read();const jobs=active(s).filter(j=>j.runId===(runId||s.settings.upcomingProductionRunId)&&!j.booking&&!j.ownerApproval&&(!j.leaseUntil||j.leaseUntil<this.now())&&(!j.nextCheckAt||j.nextCheckAt<=this.now())).sort((a,b)=>(a.lastLiveCheckAt||'').localeCompare(b.lastLiveCheckAt||'')).slice(0,limit);
  const finishBy=this.now()+50000;for(let at=0;at<jobs.length&&this.now()<finishBy-20000;at+=2)await Promise.all(jobs.slice(at,at+2).map(async job=>{const lease=randomUUID(),claim=await this.store.transaction(s=>{const j=s.prescanJobs.find(j=>j.id===job.id);if(j.status==='superseded'||j.ownerApproval||j.leaseUntil>this.now())return false;j.lease=lease;j.leaseUntil=this.now()+120000;return true;});if(!claim)return;
   try{const live=await this.inspect(job);await this.store.transaction(s=>{const j=s.prescanJobs.find(j=>j.id===job.id);if(j.lease!==lease||j.status==='superseded')return;j.live=live;j.addressWarnings=[];j.liveStatus=live.status;j.liveIssues=live.issues;j.lastLiveCheckAt=new Date().toISOString();j.nextCheckAt=this.now()+(live.status==='ready_for_owner'?10:5)*60000;});}
   catch(error){await this.store.transaction(s=>{const j=s.prescanJobs.find(j=>j.id===job.id);j.liveStatus='needs_attention';j.liveIssues=[error.message];if(/address|destination|street|zip|postal|recipient|company/i.test(error.message))j.addressWarnings=[{message:error.message,staffMessage:'Parsel could not accept the supplied address fields. Owner correction is required.',blocking:true}];j.nextCheckAt=this.now()+300000;});}
   finally{await this.store.transaction(s=>{const j=s.prescanJobs.find(j=>j.id===job.id);if(j.lease===lease){delete j.lease;delete j.leaseUntil;}});}
  }));await this.bookApproved(8);return {checked:jobs.length,historyComplete:(await this.store.read()).parselHistory?.complete===true};
 }
 async bookApproved(limit=8){
  const s=await this.store.read();if(s.parselHistory?.complete!==true)return;
  const jobs=active(s).filter(j=>j.ownerApproval&&!j.booking&&['purchase_approved','purchasing','booking_uncertain'].includes(j.liveStatus)).slice(0,limit);
  const finishBy=this.now()+45000;for(const job of jobs){if(this.now()>finishBy-15000)break;
   const lease=randomUUID(),claimed=await this.store.transaction(s=>{const j=s.prescanJobs.find(j=>j.id===job.id);if(j.booking||j.leaseUntil>this.now()||j.status==='superseded')return false;j.lease=lease;j.leaseUntil=this.now()+120000;return true;});if(!claimed)continue;
   let purchased=false;
   try{
    if(job.ownerApproval.scopeVerified!==true)throw Error('Owner production-scope verification is missing.');
    const prior=(await this.api('/shipments/'+encodeURIComponent(job.live.shipmentId))).data;
    if(prior?.shipping_label){await this.storeBooking(job,prior.shipping_label);continue;}
    if(['purchasing','booking_uncertain'].includes(job.liveStatus))throw Error('Uncertain purchase has no verified label yet; carrier reconciliation required.');
    const live=await this.inspect(job),approval=job.ownerApproval;
    if(live.status!=='ready_for_owner'||live.inputHash!==approval.inputHash||live.selectedRate?.id!==approval.rateId||Math.round(Number(live.selectedRate.price.amount)*100)>approval.maxCostCents)throw Error('Address, artwork, payment, handoff date or approved rate changed; review the refreshed prescan.');
    const commerce=await this.commerce(job.order),state=await this.store.read(),run=state.snapshot.productionRuns.runs.find(r=>r.id===job.runId),order=run?.orders.find(o=>String(o.order)===job.order);
    if(!order||shippingExclusion(state,run,order,commerce))throw Error('Order became held, pickup or unavailable.');
    const plan=await fulfillmentPlan(this.client,commerce.id,order.rugs.length);
    await this.store.transaction(s=>{const j=s.prescanJobs.find(j=>j.id===job.id);if(j.lease!==lease||j.status==='superseded'||!j.ownerApproval||j.ownerApproval.inputHash!==approval.inputHash)fail('Approval changed before purchase');j.liveStatus='purchasing';j.fulfillmentPlan=plan;j.purchaseStartedAt=new Date().toISOString();record(s,'prescan_purchase_started',{id:approval.actor},{jobId:j.id,shipmentId:live.shipmentId,rateId:approval.rateId,maxCostCents:approval.maxCostCents});});
    purchased=true;const ship=(await this.api('/shipments/'+encodeURIComponent(live.shipmentId)+'/rates/'+encodeURIComponent(approval.rateId),{method:'POST',body:{}})).data;
    if(ship?.id!==live.shipmentId)throw Error('Purchase shipment identity needs reconciliation');await this.storeBooking(job,ship.shipping_label);
   }catch(error){await this.store.transaction(s=>{const j=s.prescanJobs.find(j=>j.id===job.id);if(j.booking)return;j.liveStatus=purchased||['purchasing','booking_uncertain'].includes(job.liveStatus)?'booking_uncertain':'needs_attention';j.liveIssues=[error.message];if(/address|destination|street|zip|postal|recipient|company/i.test(error.message))j.addressWarnings=[{message:error.message,staffMessage:'Parsel reported an address issue while booking. Owner reconciliation is required.',blocking:true}];if(j.liveStatus==='needs_attention')delete j.ownerApproval;});}
   finally{await this.store.transaction(s=>{const j=s.prescanJobs.find(j=>j.id===job.id);if(j.lease===lease){delete j.lease;delete j.leaseUntil;}});}
  }
  await this.reconcileFulfillments();
 }
 async storeBooking(job,label){
  const rate=label?.shipping_rate;if(!job.ownerApproval||!label?.id||!label.tracking_code||rate?.id!==job.ownerApproval.rateId||rate.carrier!==job.live.selectedRate.carrier||rate.service!==job.live.selectedRate.service)throw Error('Purchased label differs from the exact approved service.');
  await this.store.transaction(s=>{const j=s.prescanJobs.find(j=>j.id===job.id);if(j.booking)return;if(s.intents.some(i=>i.booking?.id===label.id))fail('Label already belongs to another shipment');const order=s.snapshot.productionRuns.runs.find(r=>r.id===job.runId)?.orders.find(o=>String(o.order)===job.order);if(!order)fail('Booked label source changed; reconcile before release');
   const booking={id:label.id,tracking:label.tracking_code,carrier:rate.carrier,service:rate.service,format:'PDF',isTest:false,bookedAt:label.created_at||new Date().toISOString()};j.booking=booking;j.liveStatus='booked_pending_shopify';j.liveIssues=['Label booked; Shopify fulfillment/tracking readback is pending.'];
   const approved={id:'S-'+j.id,addressWarnings:structuredClone(j.live.addressWarnings||[]),orders:[j.order],productionId:j.runId,proofHash:j.sourceFingerprint,sourceVersion:j.live.inputHash,units:job.live.units||order.rugs.map(r=>({id:r.sourceFileId,design:r.fileName,size:r.size,previewUrl:r.previewUrl,qcPassed:false})),carrier:booking.carrier,service:booking.service,shipDate:j.live.shipDate,shipmentId:j.live.shipmentId,rateId:rate.id,maxCostCents:j.ownerApproval.maxCostCents,currency:'USD',destination:j.live.destination,package:j.live.package,paymentVerified:true};
   s.intents.push({id:approved.id,approved,approvalHash:fingerprint(approved),packed:[],status:j.sourceChanged?'held':'booked',sourceChangedHold:!!j.sourceChanged,booking,bookedAt:booking.bookedAt,approvedBy:j.ownerApproval.actor,productionApprovedAt:j.ownerApproval.at,productionApprovedBy:j.ownerApproval.actor,fulfillmentPending:true});record(s,'label_booked',{id:j.ownerApproval.actor},{intentId:approved.id,bookingId:booking.id,tracking:booking.tracking});stageAfterBooking(s,[j.order]);
  });
 }
 async reconcileFulfillments(){
  const s=await this.store.read();for(const job of active(s).filter(j=>j.booking&&j.liveStatus==='booked_pending_shopify').slice(0,8)){
   try{if(job.sourceChanged)throw Error('Artwork changed during purchase. The saved label is held for source/scope reconciliation.');let order=await this.commerce(job.order);let matching=order.fulfillments.filter(f=>f.status==='SUCCESS'&&f.trackingInfo.some(t=>t.number===job.booking.tracking));
    if(!matching.length){if(job.fulfillmentAttemptedAt)throw Error('Prior Shopify write needs current-provider reconciliation before retry.');if(!job.fulfillmentPlan)throw Error('Verified fulfillment plan is missing.');await this.store.transaction(s=>{const j=s.prescanJobs.find(j=>j.id===job.id);if(j.fulfillmentAttemptedAt)fail('Fulfillment reconciliation already started');j.fulfillmentAttemptedAt=new Date().toISOString();});await saveFulfillment(this.client,job.fulfillmentPlan,job.booking);order=await this.commerce(job.order);matching=order.fulfillments.filter(f=>f.status==='SUCCESS'&&f.trackingInfo.some(t=>t.number===job.booking.tracking));}
    if(matching.length!==1||order.displayFulfillmentStatus!=='FULFILLED')throw Error('Shopify fulfillment/tracking is not fully verified.');await this.store.transaction(s=>{const j=s.prescanJobs.find(j=>j.id===job.id);j.liveStatus='booked';j.liveIssues=[];j.fulfillmentReceipt={id:matching[0].id,tracking:job.booking.tracking,verifiedAt:new Date().toISOString()};const i=s.intents.find(i=>i.id==='S-'+j.id);if(i)i.fulfillmentPending=false;});
   }catch(error){await this.store.transaction(s=>{s.prescanJobs.find(j=>j.id===job.id).liveIssues=[error.message];});}
  }
 }
}
