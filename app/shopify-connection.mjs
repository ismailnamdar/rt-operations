import {ShopifyStatusClient} from './shopify-status.mjs';
// A merchant-owned app in the same Shopify organization can use this grant.
export function createShopifyConnection(env=process.env,{fetchImpl=fetch}={}){
 if(!env.SHOPIFY_STORE)return null;
 const client=new ShopifyStatusClient({shop:env.SHOPIFY_STORE,token:env.SHOPIFY_ADMIN_TOKEN,fetchImpl});
 let cached=null,pending=null;
 client.accessToken=async()=>{
  if(env.SHOPIFY_ADMIN_TOKEN)return env.SHOPIFY_ADMIN_TOKEN;
  if(!env.SHOPIFY_CLIENT_ID||!env.SHOPIFY_CLIENT_SECRET)throw Error('Shopify server credentials are not configured');
  if(cached&&cached.until>Date.now()+60000)return cached.token;
  pending||=(async()=>{const response=await fetchImpl(`https://${env.SHOPIFY_STORE}/admin/oauth/access_token`,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'client_credentials',client_id:env.SHOPIFY_CLIENT_ID,client_secret:env.SHOPIFY_CLIENT_SECRET}),signal:AbortSignal.timeout(15000),redirect:'error'});if(!response.ok)throw Error('Shopify app authorization failed');const result=await response.json();if(!result.access_token||!Number.isFinite(result.expires_in)||result.expires_in<=0)throw Error('Shopify token response is incomplete');cached={token:result.access_token,until:Date.now()+result.expires_in*1000};return cached.token;})();
  try{return await pending;}finally{pending=null;}
 };
 return client;
}
