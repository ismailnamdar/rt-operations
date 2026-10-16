import {createStore} from './store.mjs';
import {createServer} from './server.mjs';
import {createShopifyConnection} from './shopify-connection.mjs';
import {importLatestOrders,refreshRecentOrders} from './shopify-orders.mjs';
import {ParselCarrier} from './parsel.mjs';
let pending;
export function validateDeployment(env){
 if(!env.DATABASE_URL)throw Error('Set the private Supabase PostgreSQL connection');
 const url=new URL(env.SHUTTLE_ORIGIN||'');if(url.protocol!=='https:'||url.pathname!=='/'||url.search||url.hash||url.username||url.password)throw Error('Set the exact HTTPS SHUTTLE origin');
 if(env.SHUTTLE_DEMO==='1')throw Error('The production Vercel deployment does not permit demo data');
 if(!env.CRON_SECRET||env.CRON_SECRET.length<32)throw Error('Set a private cron secret of at least 32 characters');
 return url.origin;
}
export async function createVercelRuntime({env=process.env,store,client}={}){
 const origin=validateDeployment(env);store||=await createStore({databaseUrl:env.DATABASE_URL,schema:'shuttle_hosted'});
 client??=createShopifyConnection(env);
 if(env.SHOPIFY_STORE)await store.transaction(s=>{if(s.shopifyConnection?.shop&&s.shopifyConnection.shop!==env.SHOPIFY_STORE)throw Error('Database belongs to another Shopify store');s.shopifyConnection={...s.shopifyConnection,shop:env.SHOPIFY_STORE};});
 // Fail closed without live Parsel verification; never fall back to the mock buyer.
 const provider=new ParselCarrier({token:env.PARSEL_TOKEN||'',baseUrl:env.PARSEL_BASE_URL||'https://api.parsel.app',liveBooking:false,labelHosts:(env.PARSEL_LABEL_HOSTS||'').split(',').filter(Boolean)});
 const {handler}=await createServer({store,provider,origin,serverless:true,demo:false,shopify:env.SHOPIFY_TAG_SYNC==='1'?client:null,shopifyImport:client?()=>importLatestOrders({store,client,pages:1}):null,shopifyRefresh:client?()=>refreshRecentOrders({store,client}):null,setupToken:env.SHUTTLE_SETUP_TOKEN||'',ownerEmail:env.SHUTTLE_OWNER_EMAIL||'',stationToken:env.SHUTTLE_STATION_TOKEN||'',workflowToken:env.SHUTTLE_WORKFLOW_TOKEN||'',gmail:null,emailSendingEnabled:false});
 return {handler,store,client,origin,env};
}
export async function runtime(){if(!pending)pending=createVercelRuntime().catch(error=>{pending=null;throw error;});return pending;}
