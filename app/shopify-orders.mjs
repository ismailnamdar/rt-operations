// Shopify remains authoritative for current commerce facts; preserve workflow/artwork fields.
export const ORDER_FIELDS=`id name email createdAt updatedAt displayFinancialStatus displayFulfillmentStatus tags customer { displayName } lineItems(first: 100) { nodes { id title quantity variantTitle customAttributes { key value } } pageInfo { hasNextPage } }`;
export const ORDERS_QUERY=`query ShuttleOrders($after: String) { orders(first: 50, after: $after, sortKey: CREATED_AT, reverse: true) { nodes { ${ORDER_FIELDS} } pageInfo { hasNextPage endCursor } } }`;
export const ORDER_QUERY=`query ShuttleOrder($id: ID!) { order(id: $id) { ${ORDER_FIELDS} } }`;
export function mergeShopifyOrders(s,orders,{reset=false,cursor=null,complete=false,trackImport=true}={}){
 s.shopifyOrders||={};s.shopifyOrderBindings||={};const now=new Date().toISOString();
 for(const order of orders){
  if(!/^gid:\/\/shopify\/Order\/\d+$/.test(order.id||'')||!/^#?\d+$/.test(order.name||''))throw Error('Order identity requires manual reconciliation');
  const number=order.name.replace(/^#/,'');
  const prior=s.shopifyOrderBindings[number];if(prior&&prior.id!==order.id)throw Error('Conflicting Shopify order identity');
  s.shopifyOrders[number]={...order,checkedAt:now};s.shopifyOrderBindings[number]={id:order.id,verified:true,verifiedAt:now};
  for(const key of ['pipeline','unfulfilled']){
   s.snapshot[key]||={orders:[]};s.snapshot[key].orders||=[];
   const rows=s.snapshot[key].orders,old=rows.find(r=>String(r.order)===number),facts={order:number,shopifyOrderId:order.id,customer:order.customer?.displayName||order.email||'Customer',customerEmail:order.email,createdAt:order.createdAt,shopifyUpdatedAt:order.updatedAt,paymentStatus:order.displayFinancialStatus,fulfillmentStatus:order.displayFulfillmentStatus,shopifyTags:order.tags,shopifyLineItems:order.lineItems.nodes,shopifyLineItemsIncomplete:order.lineItems.pageInfo.hasNextPage,shopifyCheckedAt:now};
   if(old)Object.assign(old,facts);else rows.push(facts);
  }
 }
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
