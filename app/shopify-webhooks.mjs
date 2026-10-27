import {createHmac,timingSafeEqual} from 'node:crypto';
export const SHOPIFY_WEBHOOK_TOPICS=['orders/create','orders/updated','orders/paid','orders/cancelled','orders/fulfilled','app/uninstalled'];
export function webhookSigningSecret(env){
 const source=env.SHOPIFY_WEBHOOK_SOURCE||'app';
 if(source==='app')return env.SHOPIFY_CLIENT_SECRET||'';
 if(source==='manual')return env.SHOPIFY_WEBHOOK_SECRET||'';
 return ''; // A bad mode must not silently fall back to another signing key.
}
export function verifyShopifyWebhook(raw,signature,secret){
 if(!secret||!Buffer.isBuffer(raw)||typeof signature!=='string')return false;
 const expected=createHmac('sha256',secret).update(raw).digest(),actual=Buffer.from(signature,'base64');
 return expected.length===actual.length&&timingSafeEqual(expected,actual);
}
export function enqueueShopifyWebhook(s,{id,topic,shop,payload}){
 if(!id||id.length>200||!SHOPIFY_WEBHOOK_TOPICS.includes(topic))throw Error('Unsupported webhook');
 const orderId=payload?.admin_graphql_api_id|| (Number.isSafeInteger(payload?.id)&&payload.id>0?'gid://shopify/Order/'+payload.id:null);
 if(topic!=='app/uninstalled'&&!/^gid:\/\/shopify\/Order\/\d+$/.test(orderId||''))throw Error('Missing verified order identity');
 s.shopifyWebhookReceipts||={};const prior=s.shopifyWebhookReceipts[id];
 if(prior){if(prior.topic!==topic||prior.shop!==shop||prior.orderId!==(topic==='app/uninstalled'?null:orderId))throw Error('Conflicting webhook identity');return {duplicate:true};}
 s.shopifyWebhookReceipts[id]={topic,shop,receivedAt:new Date().toISOString(),status:'pending',orderId:topic==='app/uninstalled'?null:orderId};
 s.shopifyWebhookDelivery={lastReceivedAt:new Date().toISOString(),lastTopic:topic};
 if(topic==='app/uninstalled')s.shopifyConnection={...(s.shopifyConnection||{}),revoked:true,revokedAt:new Date().toISOString()};
 return {duplicate:false};
}
// Acknowledge only durable receipt storage. Shopify reads and business rules run in the worker.
export function createShopifyWebhookHandler({env,getRuntime}){return async request=>{
 const response=(status,body)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
 if(request.method!=='POST')return new Response(null,{status:405,headers:{Allow:'POST'}});
 if(!env.SHOPIFY_STORE||request.headers.get('x-shopify-shop-domain')!==env.SHOPIFY_STORE)return response(401,{error:'Webhook verification failed'});
 const secret=webhookSigningSecret(env);if(!secret)return response(503,{error:'Webhook signing configuration is unavailable'});
 try{
  const chunks=[];let size=0;for await(const chunk of request.body||[]){size+=chunk.length;if(size>2*1024*1024)return response(413,{error:'Webhook too large'});chunks.push(Buffer.from(chunk));}const raw=Buffer.concat(chunks);
  if(!verifyShopifyWebhook(raw,request.headers.get('x-shopify-hmac-sha256'),secret))return response(401,{error:'Webhook verification failed'});
  const id=request.headers.get('x-shopify-webhook-id'),topic=request.headers.get('x-shopify-topic');
  if(!id||id.length>200||!SHOPIFY_WEBHOOK_TOPICS.includes(topic))return response(400,{error:'Unsupported webhook'});
  let payload;try{payload=JSON.parse(raw.toString('utf8'));if(!payload||Array.isArray(payload)||typeof payload!=='object')throw Error();}catch{return response(400,{error:'Invalid webhook body'});}
  // Reject malformed order identities before opening a database connection.
  if(topic!=='app/uninstalled'&&!/^gid:\/\/shopify\/Order\/\d+$/.test(payload.admin_graphql_api_id||'')&&!(Number.isSafeInteger(payload.id)&&payload.id>0))return response(400,{error:'Invalid order identity'});
  const app=await getRuntime();await app.store.transaction(s=>enqueueShopifyWebhook(s,{id,topic,shop:env.SHOPIFY_STORE,payload}));return response(200,{ok:true});
 }catch{return response(503,{error:'Webhook storage unavailable; retry delivery'});}
};}
