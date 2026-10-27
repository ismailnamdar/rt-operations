// Shopify remains authoritative for current commerce facts; preserve workflow/artwork fields.
export const ORDER_FIELDS=`id name email createdAt updatedAt cancelledAt displayFinancialStatus displayFulfillmentStatus tags shippingLines(first: 100) { nodes { id title code isRemoved currentDiscountedPriceSet { shopMoney { amount currencyCode } } } pageInfo { hasNextPage } } lineItems(first: 100) { nodes { id title quantity variantTitle customAttributes { key value } } pageInfo { hasNextPage } }`;
export const ORDERS_QUERY=`query ShuttleOrders($after: String) { orders(first: 50, after: $after, sortKey: CREATED_AT, reverse: true) { nodes { ${ORDER_FIELDS} } pageInfo { hasNextPage endCursor } } }`;
export const ORDER_QUERY=`query ShuttleOrder($id: ID!) { order(id: $id) { ${ORDER_FIELDS} } }`;
export function mergeShopifyOrders(s,orders,{reset=false,cursor=null,complete=false,trackImport=true}={}){
 s.shopifyOrders||={};s.shopifyOrderBindings||={};const now=new Date().toISOString();
 for(const order of orders){
  if(!/^gid:\/\/shopify\/Order\/\d+$/.test(order.id||'')||!/^#?\d+$/.test(order.name||''))throw Error('Order identity requires manual reconciliation');
  const number=order.name.replace(/^#/,'');
  const prior=s.shopifyOrderBindings[number];if(prior&&prior.id!==order.id)throw Error('Conflicting Shopify order identity');
  if(s.shopifyOrders[number]?.updatedAt>order.updatedAt)continue;
  s.shopifyOrders[number]={...order,checkedAt:now};s.shopifyOrderBindings[number]={id:order.id,verified:true,verifiedAt:now};
  mergePaidShipping(s,order,number,now);
  for(const key of ['pipeline','unfulfilled']){
   s.snapshot[key]||={orders:[]};s.snapshot[key].orders||=[];
   const rows=s.snapshot[key].orders,old=rows.find(r=>String(r.order)===number),facts={order:number,id:order.id,shopifyOrderId:order.id,email:order.email,financialStatus:order.displayFinancialStatus,cancelledAt:order.cancelledAt||null,customer:order.customer?.displayName||order.email||'Customer',customerEmail:order.email,createdAt:order.createdAt,shopifyUpdatedAt:order.updatedAt,paymentStatus:order.displayFinancialStatus,fulfillmentStatus:order.displayFulfillmentStatus,shopifyTags:order.tags,shopifyLineItems:order.lineItems.nodes,shopifyLineItemsIncomplete:order.lineItems.pageInfo.hasNextPage,shopifyCheckedAt:now,checkedAt:now,requiredItems:order.lineItems.nodes.map(i=>({id:i.id,title:i.title,variant:i.variantTitle,quantity:i.quantity,attributes:i.customAttributes}))};
   if(old)Object.assign(old,facts);else rows.push(facts);
  }
 }
 s.snapshot.unfulfilled.checkedAt=now;
 s.snapshot.unfulfilled.coverage={limit:'Latest 500 imported orders plus subsequent changes accessible to this app. Older unfulfilled orders and Gmail/Drive workflow evidence have not been fully reconciled.'};
 if(!trackImport)return;
 const old=s.shopifyImport||{};s.shopifyImport={...old,status:complete?'complete':'running',cursor,imported:(reset?0:old.imported||0)+orders.length,updatedAt:now};
}
export async function importLatestOrders({store,client,pages=1}){
 const initial=await store.read();if(initial.shopifyConnection?.revoked)throw Error('Shopify integration has been uninstalled');
 let receipt=initial.shopifyImport;if(receipt?.status==='complete')return receipt;
 for(let page=0;page<pages;page++){
  const remaining=500-(receipt?.imported||0);if(remaining<=0)break;
  const result=await client.request(ORDERS_QUERY,{after:receipt?.cursor||null}),connection=result?.orders;
  if(!connection||!Array.isArray(connection.nodes)||connection.pageInfo.hasNextPage&&!connection.pageInfo.endCursor)throw Error('Incomplete Shopify order page');
  const nodes=connection.nodes.slice(0,remaining),complete=!connection.pageInfo.hasNextPage||(receipt?.imported||0)+nodes.length>=500;
  await store.transaction(s=>{if((s.shopifyImport?.cursor||null)!==(receipt?.cursor||null))throw Error('Import progressed elsewhere; retry');mergeShopifyOrders(s,nodes,{cursor:connection.pageInfo.endCursor,complete});});
  receipt=(await store.read()).shopifyImport;if(complete)break;
 }
 return receipt;
}

export async function processShopifyUpdates({store,client,limit=2}){
 const state=await store.read();if(state.shopifyConnection?.revoked)return;
 const pending=Object.entries(state.shopifyWebhookReceipts||{}).filter(([,r])=>r.status==='pending'&&(!r.retryAfter||r.retryAfter<=Date.now())).slice(0,limit);
 for(const [id,receipt] of pending){
  if(receipt.topic==='app/uninstalled'){await store.transaction(s=>{s.shopifyWebhookReceipts[id].status='complete';});continue;}
  if(!/^gid:\/\/shopify\/Order\/\d+$/.test(receipt.orderId||'')){await store.transaction(s=>{s.shopifyWebhookReceipts[id].status='needs_attention';});continue;}
  try{const result=await client.request(ORDER_QUERY,{id:receipt.orderId});if(!result?.order)throw Error('Updated order unavailable');
  await store.transaction(s=>{const last=s.shopifyOrders?.[result.order.name.replace(/^#/,'')];if(!last||String(last.updatedAt)<=String(result.order.updatedAt))mergeShopifyOrders(s,[result.order],{trackImport:false});s.shopifyWebhookReceipts[id].status='complete';s.shopifyWebhookReceipts[id].processedAt=new Date().toISOString();delete s.shopifyWebhookReceipts[id].error;});
  }catch{await store.transaction(s=>{const r=s.shopifyWebhookReceipts[id];r.attempts=(r.attempts||0)+1;r.retryAfter=Date.now()+Math.min(900000,r.attempts*60000);r.error='Order update needs reconciliation; queued for retry.';});}
 }
}

export async function refreshRecentOrders({store,client}){
 if((await store.read()).shopifyConnection?.revoked)throw Error('Shopify integration has been uninstalled');
 const result=await client.request(ORDERS_QUERY,{after:null});if(!result?.orders?.nodes)throw Error('Shopify refresh incomplete');
 await store.transaction(s=>{mergeShopifyOrders(s,result.orders.nodes,{trackImport:false});s.shopifyLastRefreshAt=new Date().toISOString();});return {refreshed:result.orders.nodes.length};
}

// Fixed bounded windows and durable cursors prevent a busy store from starving older updates.
export const UPDATED_ORDERS_QUERY=`query ShuttleOrderUpdates($after: String, $query: String!) { orders(first: 50, after: $after, query: $query, sortKey: UPDATED_AT) { nodes { ${ORDER_FIELDS} } pageInfo { hasNextPage endCursor } } }`;
export async function syncChangedOrders({store,client,pages=1,now=Date.now()}){
 const {randomUUID}=await import('node:crypto'),lease=randomUUID();
 const claimed=await store.transaction(s=>{
  if(s.shopifyConnection?.revoked)throw Error('Shopify integration has been uninstalled');
  s.shopifySync||={};if(s.shopifySync.leaseUntil>now)return false;
  const sync=s.shopifySync;
  if(!sync.window){
   const dates=Object.values(s.shopifyOrders||{}).map(o=>o.createdAt).filter(v=>Number.isFinite(Date.parse(v))).sort();
   const since=sync.completedThrough||dates[0]||new Date(now-86400000).toISOString();
   const from=new Date(Date.parse(since)-300000).toISOString(),through=new Date(now-5000).toISOString();
   sync.window={query:`updated_at:>='${from}' updated_at:<='${through}'`,through,cursor:null};
  }
  sync.lease=lease;sync.leaseUntil=now+120000;sync.status='syncing';return true;
 });if(!claimed)return {busy:true};
 let refreshed=0;
 try{
  for(let page=0;page<pages;page++){
   const state=await store.read(),window=state.shopifySync.window;
   const result=await client.request(UPDATED_ORDERS_QUERY,{after:window.cursor,query:window.query}),c=result?.orders;
   if(!c||!Array.isArray(c.nodes)||c.pageInfo.hasNextPage&&!c.pageInfo.endCursor)throw Error('Incomplete Shopify update page');
   await store.transaction(s=>{
    const sync=s.shopifySync;if(sync.lease!==lease||sync.window?.cursor!==window.cursor)throw Error('Shopify sync lease changed');
    mergeShopifyOrders(s,c.nodes,{trackImport:false});
    if(c.pageInfo.hasNextPage)sync.window.cursor=c.pageInfo.endCursor;
    else {sync.completedThrough=window.through;sync.lastSuccessAt=new Date().toISOString();delete sync.window;sync.status='current';}
   });refreshed+=c.nodes.length;if(!c.pageInfo.hasNextPage)break;
  }
  return {refreshed,status:(await store.read()).shopifySync.status};
 }catch(error){await store.transaction(s=>{if(s.shopifySync?.lease===lease){s.shopifySync.status='needs_attention';s.shopifySync.error='Shopify synchronization failed; its cursor is retained for retry.';}});throw error;}
 finally{await store.transaction(s=>{if(s.shopifySync?.lease===lease){delete s.shopifySync.lease;delete s.shopifySync.leaseUntil;if(s.shopifySync.status!=='needs_attention')delete s.shopifySync.error;}});}
}

export function mergePaidShipping(s,order,number,now=new Date().toISOString()){
 if(!order.shippingLines?.nodes)return; // Missing scope/data is not evidence of free shipping.
 const active=order.shippingLines.nodes.filter(l=>!l.isRemoved),paid=active.filter(l=>Number.isFinite(Number(l.currentDiscountedPriceSet?.shopMoney?.amount))&&Number(l.currentDiscountedPriceSet.shopMoney.amount)>0);
 s.snapshot.expedited||={orders:[]};const rows=s.snapshot.expedited.orders;let row=rows.find(r=>String(r.order)===number);
 const open=!order.cancelledAt&&order.displayFulfillmentStatus!=='FULFILLED'&&!['REFUNDED','VOIDED','EXPIRED'].includes(order.displayFinancialStatus);
 if(!paid.length&&order.shippingLines.pageInfo?.hasNextPage)return;
 if(!paid.length&&!row)return;
 if(!row){row={order:number,shopifyPaidShippingManaged:true};rows.push(row);}
 const selected=paid.length>0;
 if(row.shopifyPaidShippingManaged)row.expeditedActive=selected&&open;
 const verified=selected&&order.displayFinancialStatus==='PAID';
 Object.assign(row,{customer:row.customer||order.email||'Customer',email:order.email,shopifyOrderId:order.id,fulfillmentStatus:order.displayFulfillmentStatus,cancelledAt:order.cancelledAt||null,shopifyPaidShippingSelected:selected,shopifyShippingCheckedAt:now,shopifyShippingLines:active,shopifyShippingIncomplete:order.shippingLines.pageInfo?.hasNextPage===true});
 if(selected)Object.assign(row,{nextProductionRequired:true,shippingPaymentVerified:verified,shippingPaidCents:Math.round(paid.reduce((n,l)=>n+Number(l.currentDiscountedPriceSet.shopMoney.amount),0)*100),selectedService:paid.map(l=>l.title||l.code).join(' + '),shippingStatus:paid.map(l=>l.title||l.code).join(' + '),paymentStatus:verified?'Paid shipping · '+paid.map(l=>l.currentDiscountedPriceSet.shopMoney.currencyCode+' '+Number(l.currentDiscountedPriceSet.shopMoney.amount).toFixed(2)).join(' + '):'Paid service selected · payment review required',sourceNote:'Shopify shipping lines refreshed '+now+'. Paid selection prioritizes production; it does not establish artwork approval or authorize booking.'});
 if(!row.nextAction||row.shopifyPaidShippingManaged)row.nextAction=selected?(verified?'Verify mock-up approval and artwork for next production':'Review payment and mock-up approval for next production'):'Paid shipping selection removed; review existing obligations';
 s.snapshot.expedited.checkedAt=now;s.snapshot.expedited.partial=s.shopifyExpeditedScan?.status!=='complete';s.snapshot.expedited.coverage='Paid shipping selections from accessible Shopify orders, plus preserved SHUTTLE expedited cases. Artwork and deadlines require their own verified evidence.';
}
export const PAID_SHIPPING_QUERY=`query ShuttlePaidShipping($after:String){orders(first:50,after:$after,query:"-fulfillment_status:fulfilled",sortKey:CREATED_AT,reverse:true){nodes{${ORDER_FIELDS}}pageInfo{hasNextPage endCursor}}}`;
export async function syncPaidShippingOrders({store,client,pages=1}){
 let scan=(await store.read()).shopifyExpeditedScan;if(scan?.status==='complete')return scan;
 for(let n=0;n<pages;n++){
  const c=(await client.request(PAID_SHIPPING_QUERY,{after:scan?.cursor||null}))?.orders;
  if(!c||!Array.isArray(c.nodes)||c.pageInfo.hasNextPage&&!c.pageInfo.endCursor)throw Error('Incomplete Shopify shipping page');
  await store.transaction(s=>{if((s.shopifyExpeditedScan?.cursor||null)!==(scan?.cursor||null))throw Error('Shipping scan progressed elsewhere');mergeShopifyOrders(s,c.nodes,{trackImport:false});s.shopifyExpeditedScan={status:c.pageInfo.hasNextPage?'running':'complete',cursor:c.pageInfo.endCursor,scanned:(scan?.scanned||0)+c.nodes.length,checkedAt:new Date().toISOString()};s.snapshot.expedited||={orders:[]};s.snapshot.expedited.partial=c.pageInfo.hasNextPage;});
  scan=(await store.read()).shopifyExpeditedScan;if(scan.status==='complete')break;
 }return scan;
}
