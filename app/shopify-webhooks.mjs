import {createHmac,timingSafeEqual} from 'node:crypto';
export function verifyShopifyWebhook(raw,signature,secret){
 if(!secret||!Buffer.isBuffer(raw)||typeof signature!=='string')return false;
 const expected=createHmac('sha256',secret).update(raw).digest(),actual=Buffer.from(signature,'base64');
 return expected.length===actual.length&&timingSafeEqual(expected,actual);
}
export function enqueueShopifyWebhook(s,{id,topic,shop,payload}){
 if(!id||!['orders/create','orders/updated','orders/fulfilled','app/uninstalled'].includes(topic))throw Error('Unsupported webhook');
 s.shopifyWebhookReceipts||={};if(s.shopifyWebhookReceipts[id])return {duplicate:true};
 s.shopifyWebhookReceipts[id]={topic,shop,receivedAt:new Date().toISOString(),status:'pending',orderId:payload.admin_graphql_api_id||null};
 if(topic==='app/uninstalled')s.shopifyConnection={...(s.shopifyConnection||{}),revoked:true,revokedAt:new Date().toISOString()};
 return {duplicate:false};
}
