import {randomUUID} from 'node:crypto';import {requireRole} from './auth.mjs';
export const SUBSCRIPTIONS_QUERY=`query ShuttleWebhooks($after:String){webhookSubscriptions(first:100,after:$after){nodes{id topic uri}pageInfo{hasNextPage endCursor}}}`;
export const SUBSCRIPTION_CREATE=`mutation ShuttleWebhookCreate($topic:WebhookSubscriptionTopic!,$input:WebhookSubscriptionInput!){webhookSubscriptionCreate(topic:$topic,webhookSubscription:$input){webhookSubscription{id topic uri}userErrors{field message}}}`;
export const REQUIRED_TOPICS=['ORDERS_CREATE','ORDERS_UPDATED','ORDERS_PAID','ORDERS_CANCELLED','ORDERS_FULFILLED','APP_UNINSTALLED'];
export async function setupShopifyWebhooks({store,client,origin,user}){
 requireRole(user,['owner']);const url=new URL(origin);if(url.protocol!=='https:'||url.pathname!=='/'||url.search||url.hash||url.username||url.password||['localhost','127.0.0.1','[::1]'].includes(url.hostname))throw Error('A deployed HTTPS SHUTTLE origin is required');
 const uri=url.origin+'/api/shopify/webhook',lease=randomUUID();
 const claimed=await store.transaction(s=>{s.shopifyWebhookSetup||={};if(s.shopifyWebhookSetup.leaseUntil>Date.now())return false;s.shopifyWebhookSetup.lease=lease;s.shopifyWebhookSetup.leaseUntil=Date.now()+120000;return true;});if(!claimed)throw Error('Webhook setup already running');
 try{
  const existing=[];let after=null,complete=false;
  for(let page=0;page<10;page++){const c=(await client.request(SUBSCRIPTIONS_QUERY,{after}))?.webhookSubscriptions;if(!c?.nodes||c.pageInfo.hasNextPage&&!c.pageInfo.endCursor)throw Error('Webhook inventory is incomplete');existing.push(...c.nodes);if(!c.pageInfo.hasNextPage){complete=true;break;}after=c.pageInfo.endCursor;}if(!complete)throw Error('Webhook inventory needs reconciliation');
  const receipts=[];
  for(const topic of REQUIRED_TOPICS){let receipt=existing.find(s=>s.topic===topic&&s.uri===uri);
   if(!receipt){const result=(await client.request(SUBSCRIPTION_CREATE,{topic,input:{uri,format:'JSON',includeFields:['id']}}))?.webhookSubscriptionCreate;if(!result?.webhookSubscription||result.userErrors?.length)throw Error('Shopify webhook registration needs attention');receipt=result.webhookSubscription;}
   if(!receipt.id||receipt.topic!==topic||receipt.uri!==uri)throw Error('Webhook subscription receipt differs from requested endpoint');
   receipts.push(receipt);await store.transaction(s=>{if(s.shopifyWebhookSetup?.lease!==lease)throw Error('Webhook setup lease changed');s.shopifyWebhookSetup.subscriptions=receipts;});
  }
  await store.transaction(s=>{s.shopifyWebhookSetup={...s.shopifyWebhookSetup,status:'awaiting_delivery',origin:url.origin,configuredAt:new Date().toISOString(),configuredBy:user.id};});return {status:'awaiting_delivery',subscriptions:receipts.length,endpoint:uri};
 }catch(error){await store.transaction(s=>{s.shopifyWebhookSetup={...s.shopifyWebhookSetup,status:'needs_attention',error:'Webhook setup incomplete; reconcile existing provider subscriptions before retrying.'};});throw error;}
 finally{await store.transaction(s=>{if(s.shopifyWebhookSetup?.lease===lease){delete s.shopifyWebhookSetup.lease;delete s.shopifyWebhookSetup.leaseUntil;}});}
}
