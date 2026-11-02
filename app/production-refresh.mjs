import {randomUUID} from 'node:crypto';
import {requireRole} from './auth.mjs';
import {fail} from './shipping.mjs';
import {ORDER_FIELDS,ORDER_QUERY,mergeShopifyOrders} from './shopify-orders.mjs';
import {prepareEarlyPrescan} from './early-prescan.mjs';
export const PRODUCTION_ORDER_LOOKUP=`query ProductionOrderLookup($query:String!){orders(first:10,query:$query){nodes{${ORDER_FIELDS}}pageInfo{hasNextPage}}}`;
export function queueProductionRefresh(s,user,runId){
 requireRole(user,['owner','warehouse']);const run=s.snapshot.productionRuns?.runs?.find(r=>r.id===runId);if(!run)fail('Choose a production run before refreshing',404);
 s.productionRefresh||={};const request={id:randomUUID(),runId,requestedAt:new Date().toISOString(),requestedBy:user.id,status:'queued',remaining:run.orders.map(o=>String(o.order)),refreshed:0,failures:{}};s.productionRefresh[runId]=request;prepareEarlyPrescan(s,runId);
 for(const j of s.prescanJobs||[])if(j.runId===runId&&j.status!=='superseded'&&!j.booking&&!j.ownerApproval)j.nextCheckAt=0;
 return {id:request.id,orders:request.remaining.length};
}
export async function processProductionRefresh({store,client,limit=12,deadline=Date.now()+20000}){
 if(!client)return {unavailable:true};const state=await store.read();let processed=0;
 for(const request of Object.values(state.productionRefresh||{}).filter(r=>r.remaining?.length&&r.status!=='complete')){
  for(let offset=0;offset<request.remaining.length&&processed<limit&&Date.now()<deadline-10000;offset+=4){
   const numbers=request.remaining.slice(offset,offset+Math.min(4,limit-processed));const results=await Promise.all(numbers.map(async number=>{try{const s=await store.read(),binding=s.shopifyOrderBindings?.[number];let order;
    if(binding?.id)order=(await client.request(ORDER_QUERY,{id:binding.id}))?.order;
    else {const c=(await client.request(PRODUCTION_ORDER_LOOKUP,{query:'name:#'+number}))?.orders;if(!c||c.pageInfo?.hasNextPage)throw Error('Shopify order lookup coverage is incomplete');const exact=c.nodes.filter(o=>String(o.name).replace(/^#/,'')===number);if(exact.length!==1)throw Error('Shopify order identity needs reconciliation');order=exact[0];}
    if(!order||String(order.name).replace(/^#/,'')!==number)throw Error('Shopify order identity changed');return {number,order};
   }catch(error){return {number,error:error.message};}}));
   await store.transaction(s=>{const live=s.productionRefresh?.[request.runId];if(live?.id!==request.id)return;const orders=results.filter(r=>r.order).map(r=>r.order);if(orders.length)mergeShopifyOrders(s,orders,{trackImport:false});for(const r of results){live.remaining=live.remaining.filter(n=>n!==r.number);if(r.error)live.failures[r.number]=r.error;else live.refreshed++;}live.status=live.remaining.length?'processing':Object.keys(live.failures).length?'needs_attention':'complete';live.updatedAt=new Date().toISOString();for(const j of s.prescanJobs||[])if(j.runId===request.runId&&!j.booking&&!j.ownerApproval)j.nextCheckAt=0;});processed+=numbers.length;
  }
 }
 return {processed};
}
