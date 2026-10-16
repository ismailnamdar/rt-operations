import {runtime} from '../app/vercel-runtime.mjs';
import {verifyShopifyWebhook,enqueueShopifyWebhook} from '../app/shopify-webhooks.mjs';
export default {async fetch(request){
 if(request.method!=='POST')return new Response(null,{status:405});
 try{
  const env=process.env,shop=request.headers.get('x-shopify-shop-domain');if(!env.SHOPIFY_STORE||shop!==env.SHOPIFY_STORE)return new Response(null,{status:401});
  const chunks=[];let size=0;for await(const chunk of request.body||[]){size+=chunk.length;if(size>2*1024*1024)return new Response(null,{status:413});chunks.push(Buffer.from(chunk));}const raw=Buffer.concat(chunks);
  if(!verifyShopifyWebhook(raw,request.headers.get('x-shopify-hmac-sha256'),env.SHOPIFY_CLIENT_SECRET||env.SHOPIFY_WEBHOOK_SECRET))return new Response(null,{status:401});
  const id=request.headers.get('x-shopify-webhook-id'),topic=request.headers.get('x-shopify-topic');if(!id||!['orders/create','orders/updated','orders/fulfilled','app/uninstalled'].includes(topic))return new Response(null,{status:400});
  const payload=JSON.parse(raw.toString('utf8')),app=await runtime();await app.store.transaction(s=>enqueueShopifyWebhook(s,{id,topic,shop,payload}));return Response.json({ok:true});
 }catch{return Response.json({error:'Webhook processing needs attention'},{status:503});}
}};
