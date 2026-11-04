import {FULFILLMENT_ACCESS_QUERY} from './prescan-fulfillment.mjs';
import {randomUUID} from 'node:crypto';
import {ORDER_STAGES,normalizeStage,stageLabel} from './public/order-stages.js';
export const MANAGED_TAGS=[...ORDER_STAGES.map(s=>'SHUTTLE: '+stageLabel(s)),'SHUTTLE: Awaiting ups','SHUTTLE: Awaiting UPS','SHUTTLE: Hold','SHUTTLE: Redo','SHUTTLE: In queue for production','SHUTTLE: Cutting','SHUTTLE: Stitching','SHUTTLE: Packing'];
export function desiredStatusTags(s,order){
 const stage=normalizeStage(s.orderStages?.[order]?.stage);
 if(!ORDER_STAGES.includes(stage))return null;
 const packages=(s.intents||[]).filter(i=>i.approved.orders.some(n=>String(n)===String(order)));
 const redo=(s.redoRequests||[]).some(r=>r.status!=='resolved'&&r.status!=='cancelled'&&r.orders.some(n=>String(n)===String(order)));
 return ['SHUTTLE: '+stageLabel(stage),...(packages.some(i=>i.redoHold||i.status==='held')||(s.snapshot.productionRuns?.runs||[]).some(r=>r.orders?.some(o=>String(o.order)===String(order)&&o.hold))||Object.values(s.productionPrescan||{}).some(r=>r.orders?.[order]?.disposition==='hold')?['SHUTTLE: Hold']:[]),...(redo?['SHUTTLE: Redo']:[])];
}
export class ShopifyStatusClient{
 constructor({shop,token,version='2026-10',fetchImpl=fetch}){if(!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop||''))throw Error('Use the canonical myshopify.com store hostname');this.url=`https://${shop}/admin/api/${version}/graphql.json`;this.token=token;this.fetch=fetchImpl;}
 async request(query,variables){const res=await this.fetch(this.url,{method:'POST',headers:{'Content-Type':'application/json','X-Shopify-Access-Token':this.accessToken?await this.accessToken():this.token},body:JSON.stringify({query,variables}),signal:AbortSignal.timeout(10000),redirect:'error'});if(!res.ok)throw Error('Shopify request failed');const result=await res.json();if(result.errors?.length)throw Error('Shopify rejected the request');return result.data;}
 async order(id){const data=await this.request('query StatusOrder($id: ID!) { order(id: $id) { id name tags } }',{id});if(!data?.order)throw Error('Shopify order unavailable');return data.order;}
 async change(operation,id,tags){if(!tags.length)return;const data=await this.request(`mutation StatusTags($id: ID!, $tags: [String!]!) { ${operation}(id: $id, tags: $tags) { node { id } userErrors { message } } }`,{id,tags});if(!data?.[operation]||data[operation].userErrors?.length)throw Error('Shopify tag update rejected');}
}
// One durable lease per order; retries reconcile current remote tags after uncertain responses.
export async function syncShopifyStatuses({store,client,limit=20,deadline=Infinity,orders=null}){
 const snapshot=await store.read();let count=0;
 for(const order of Object.keys(snapshot.orderStages||{}).filter(order=>!orders||orders.map(String).includes(order)).sort((a,b)=>String(snapshot.shopifyStatusSync?.[a]?.verifiedAt||'').localeCompare(String(snapshot.shopifyStatusSync?.[b]?.verifiedAt||'')))){
  if(count>=limit||Date.now()>=deadline)break;
  const lease=randomUUID();
  const work=await store.transaction(s=>{
   const binding=s.shopifyOrderBindings?.[order],tags=desiredStatusTags(s,order);s.shopifyStatusSync||={};const old=s.shopifyStatusSync[order];
   if(!tags||binding?.verified!==true||!/^gid:\/\/shopify\/Order\/\d+$/.test(binding.id||'')||!binding.verifiedAt)return null;
   if(old?.leaseUntil>Date.now())return null;if(!orders&&old?.status==='synced'&&JSON.stringify(old.tags)===JSON.stringify(tags)&&Date.now()-Date.parse(old.verifiedAt)<15*60000)return null;
   s.shopifyStatusSync[order]={...old,status:'syncing',lease,leaseUntil:Date.now()+180000};return {id:binding.id,tags};
  });
  if(!work)continue;count++;
  try{
   const current=await client.order(work.id);
   if(current.id!==work.id||String(current.name).replace(/^#/,'')!==String(order).replace(/^#/,''))throw Error('Order identity mismatch');
   const add=work.tags.filter(t=>!current.tags.includes(t)),remove=current.tags.filter(t=>MANAGED_TAGS.includes(t)&&!work.tags.includes(t));
   if(add.length)await client.change('tagsAdd',work.id,add);
   if(remove.length)await client.change('tagsRemove',work.id,remove);
   const verified=await client.order(work.id);
   if(verified.id!==work.id||!work.tags.every(t=>verified.tags.includes(t))||verified.tags.some(t=>MANAGED_TAGS.includes(t)&&!work.tags.includes(t)))throw Error('Tag verification incomplete');
   await store.transaction(s=>{if(s.shopifyStatusSync?.[order]?.lease!==lease)return;const latest=desiredStatusTags(s,order);s.shopifyStatusSync[order]={status:JSON.stringify(latest)===JSON.stringify(work.tags)?'synced':'pending',tags:work.tags,verifiedAt:new Date().toISOString()};for(const row of [s.shopifyOrders?.[order],...(s.snapshot.pipeline?.orders||[]).filter(r=>String(r.order)===order),...(s.snapshot.unfulfilled?.orders||[]).filter(r=>String(r.order)===order)])if(row){row.shopifyTags=[...verified.tags];if(row===s.shopifyOrders?.[order])row.tags=[...verified.tags];}});
  }catch{
   await store.transaction(s=>{if(s.shopifyStatusSync?.[order]?.lease===lease)s.shopifyStatusSync[order]={status:'needs_attention',error:'Shopify status update needs reconciliation; retry will re-read current tags.',at:new Date().toISOString()};});
  }
 }
}

export async function syncVerifiedStatusTags({store,client,limit=20,orders=null,force=false}){
 const s=await store.read();if(!client||s.shopifyConnection?.revoked)return {status:'disconnected'};
 let access=s.shopifyTagAccess;
 if(force||!access||Date.now()-Date.parse(access.checkedAt)>600000){
  try{const scopes=(await client.request(FULFILLMENT_ACCESS_QUERY,{}))?.currentAppInstallation?.accessScopes?.map(x=>x.handle)||[];access={allowed:scopes.includes('write_orders'),checkedAt:new Date().toISOString(),status:scopes.includes('write_orders')?'ready':'needs_permission',message:scopes.includes('write_orders')?'Order-tag write permission verified.':'Shopify needs write_orders permission and app reauthorization to update status tags.'};}
  catch{access={allowed:false,checkedAt:new Date().toISOString(),status:'needs_attention',message:'Shopify tag permissions could not be verified. Reconnect or retry the connection.'};}
  await store.transaction(s=>{s.shopifyTagAccess=access;});
 }
 if(!access.allowed)return {...access,status:'needs_attention'};
 await syncShopifyStatuses({store,client,limit,orders,deadline:Date.now()+25000});return {status:'processed'};
}
export function projectOrderStages(s){
 for(const key of ['pipeline','unfulfilled','expedited'])for(const row of s.snapshot[key]?.orders||[]){const stage=normalizeStage(s.orderStages?.[String(row.order)]?.stage);if(ORDER_STAGES.includes(stage))row.productionStage=stage;}
 return s;
}
