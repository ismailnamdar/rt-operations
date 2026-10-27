import {ShopifyOAuth} from './shopify-oauth.mjs';
import {SupabaseAuth} from './supabase-auth.mjs';
import {GoogleDriveProduction} from './google-drive-production.mjs';
import {createStore} from './store.mjs';
import {createServer} from './server.mjs';
import {createShopifyConnection} from './shopify-connection.mjs';
import {syncPaidShippingOrders,importLatestOrders,syncChangedOrders} from './shopify-orders.mjs';
import {shippingProvider} from './shipping-provider.mjs';
let pending;
export function validateDeployment(env){
 if(!env.DATABASE_URL)throw Error('Set the private Supabase PostgreSQL connection');
 const url=new URL(env.SHUTTLE_ORIGIN||'');if(url.protocol!=='https:'||url.pathname!=='/'||url.search||url.hash||url.username||url.password)throw Error('Set the exact HTTPS SHUTTLE origin');
 if(env.SHUTTLE_DEMO==='1')throw Error('The production Vercel deployment does not permit demo data');
 if(!env.CRON_SECRET||env.CRON_SECRET.length<32)throw Error('Set a private cron secret of at least 32 characters');
 return url.origin;
}
export async function createVercelRuntime({env=process.env,store,client,authFetch=fetch}={}){
 const origin=validateDeployment(env);store||=await createStore({databaseUrl:env.DATABASE_URL,schema:'shuttle_hosted'});
 client??=createShopifyConnection(env,{store});
 if(env.SHOPIFY_STORE)await store.transaction(s=>{if(s.shopifyConnection?.shop&&s.shopifyConnection.shop!==env.SHOPIFY_STORE)throw Error('Database belongs to another Shopify store');s.shopifyConnection={...s.shopifyConnection,shop:env.SHOPIFY_STORE};});
 // Fail closed without live Parsel verification; never fall back to the mock buyer.
 const provider=shippingProvider(env);
 const driveClient=new GoogleDriveProduction({clientId:env.GDRIVE_CLIENT_ID,clientSecret:env.GDRIVE_CLIENT_SECRET,refreshToken:env.GDRIVE_REFRESH_TOKEN,writeEnabled:env.GDRIVE_WRITE_ENABLED==='1'}),drive=driveClient.configured()?driveClient:null;
 const supabaseAuth=new SupabaseAuth({url:env.SUPABASE_URL,key:env.SUPABASE_PUBLISHABLE_KEY||env.SUPABASE_ANON_KEY,ownerEmail:env.SHUTTLE_OWNER_EMAIL,fetchImpl:authFetch});
 const shopifyOAuth=env.SHOPIFY_AUTH_MODE==='oauth'?new ShopifyOAuth({env,store,origin}):null;
 const {handler}=await createServer({shopifyOAuth,supabaseAuth,store,provider,origin,drive,serverless:true,demo:false,shopify:env.SHOPIFY_TAG_SYNC==='1'?client:null,shopifyImport:client?()=>importLatestOrders({store,client,pages:1}):null,shopifyRefresh:client?async()=>{await syncPaidShippingOrders({store,client,pages:1});return syncChangedOrders({store,client,pages:2});}:null,setupToken:env.SHUTTLE_SETUP_TOKEN||'',ownerEmail:env.SHUTTLE_OWNER_EMAIL||'',stationToken:env.SHUTTLE_STATION_TOKEN||'',workflowToken:env.SHUTTLE_WORKFLOW_TOKEN||'',gmail:null,emailSendingEnabled:false});
 return {handler,store,client,drive,origin,env};
}
export async function runtime(){if(!pending)pending=createVercelRuntime().catch(error=>{pending=null;throw error;});return pending;}
