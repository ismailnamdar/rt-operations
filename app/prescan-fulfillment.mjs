export const FULFILLMENT_ACCESS_QUERY=`query PrescanAccess{currentAppInstallation{accessScopes{handle}}}`;
export const FULFILLMENT_PLAN_QUERY=`query PrescanFulfillmentPlan($id:ID!){order(id:$id){id fulfillmentOrders(first:100){nodes{id status assignedLocation{location{id}} lineItems(first:100){nodes{id remainingQuantity}pageInfo{hasNextPage}}}pageInfo{hasNextPage}}}}`;
export const FULFILLMENT_CREATE=`mutation PrescanFulfill($fulfillment:FulfillmentInput!){fulfillmentCreate(fulfillment:$fulfillment){fulfillment{id status trackingInfo{number company}}userErrors{field message}}}`;
export async function fulfillmentPlan(client,id,quantity){
 const scopes=(await client.request(FULFILLMENT_ACCESS_QUERY,{}))?.currentAppInstallation?.accessScopes?.map(s=>s.handle)||[];
 if(!scopes.includes('write_merchant_managed_fulfillment_orders'))throw Error('Shopify needs write_merchant_managed_fulfillment_orders permission and app reauthorization before automated booking.');
 const order=(await client.request(FULFILLMENT_PLAN_QUERY,{id}))?.order,c=order?.fulfillmentOrders;
 if(order?.id!==id||!Array.isArray(c?.nodes)||c.pageInfo?.hasNextPage||c.nodes.some(f=>f.lineItems?.pageInfo?.hasNextPage))throw Error('Fulfillment package/line-item coverage is incomplete.');
 const open=c.nodes.filter(f=>f.lineItems.nodes.some(l=>l.remainingQuantity>0));
 if(!open.length||open.some(f=>f.status!=='OPEN')||new Set(open.map(f=>f.assignedLocation?.location?.id)).size!==1||open.some(f=>!f.assignedLocation?.location?.id))throw Error('Fulfillment location or hold needs owner review.');
 if(open.flatMap(f=>f.lineItems.nodes).reduce((n,l)=>n+l.remainingQuantity,0)!==quantity)throw Error('Shopify remaining item count differs from the production rug count; verify exact fulfillment scope.');
 return open.map(f=>({fulfillmentOrderId:f.id,fulfillmentOrderLineItems:f.lineItems.nodes.filter(l=>l.remainingQuantity>0).map(l=>({id:l.id,quantity:l.remainingQuantity}))}));
}
export async function saveFulfillment(client,plan,booking){
 const result=(await client.request(FULFILLMENT_CREATE,{fulfillment:{lineItemsByFulfillmentOrder:plan,notifyCustomer:false,trackingInfo:{company:booking.carrier,number:booking.tracking}}}))?.fulfillmentCreate;
 if(result?.userErrors?.length||!result?.fulfillment?.id||result.fulfillment.status!=='SUCCESS'||!result.fulfillment.trackingInfo?.some(t=>t.number===booking.tracking))throw Error('Shopify fulfillment write needs reconciliation.');
 return result.fulfillment;
}
