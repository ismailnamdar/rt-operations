import {ShopifyOAuth} from './shopify-oauth.mjs';
import {createShopifyConnection} from './shopify-connection.mjs';
import {syncPaidShippingOrders,importLatestOrders,refreshRecentOrders,syncChangedOrders,processShopifyUpdates} from './shopify-orders.mjs';
// Non-demo local launcher. Optional credentials file is private and ignored by Git.
import fs from 'node:fs/promises';import path from 'node:path';import {fileURLToPath} from 'node:url';
import {createStore} from './store.mjs';import {createServer} from './server.mjs';import {DisabledCarrier} from './shipping-provider.mjs';import {SupabaseAuth} from './supabase-auth.mjs';import {importDriveProduction} from './drive-production.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),envFile=process.env.SHUTTLE_LOCAL_ENV_FILE||path.join(root,'data','local.env');
try{process.loadEnvFile(envFile);}catch(e){if(e.code!=='ENOENT')throw Error('Unable to read the private local configuration file');}
const store=await createStore({file:path.join(root,'data','local-live.json'),databaseUrl:process.env.DATABASE_URL||null,schema:process.env.DATABASE_URL?'shuttle_hosted':null});
// Import genuine cached folder membership only when no shared database is configured.
if(!process.env.DATABASE_URL){try{const inventory=JSON.parse(await fs.readFile(path.join(root,'data','drive-production-inventory.json'),'utf8'));await store.transaction(s=>importDriveProduction(s,inventory));}catch(e){if(e.code!=='ENOENT')throw e;}}
const supabaseAuth=new SupabaseAuth({url:process.env.SUPABASE_URL,key:process.env.SUPABASE_PUBLISHABLE_KEY||process.env.SUPABASE_ANON_KEY,ownerEmail:process.env.SHUTTLE_OWNER_EMAIL||'info@rugtomize.co'});
const origin='http://127.0.0.1:43841';const shopifyOAuth=new ShopifyOAuth({env:process.env,store,origin}),client=createShopifyConnection({...process.env,SHOPIFY_AUTH_MODE:'oauth',SHUTTLE_ORIGIN:origin},{store});const {server}=await createServer({shopifyOAuth,shopifyImport:client?()=>importLatestOrders({store,client,pages:1}):null,shopifyRefresh:client?()=>syncChangedOrders({store,client,pages:2}):null,store,origin,demo:false,supabaseAuth,provider:new DisabledCarrier(),drivePreviewDir:path.join(root,'data','drive-previews'),gmail:null,emailSendingEnabled:false});
server.on('error',e=>{console.error(e.code==='EADDRINUSE'?'Local SHUTTLE port is already in use.':'Local SHUTTLE could not start.');process.exitCode=1;});server.listen(43841,'127.0.0.1',()=>console.log('SHUTTLE non-demo local: '+origin+' · Supabase Auth '+(supabaseAuth.configured()?'configured (sign-in still needs verification)':'awaiting configuration')+' · shipping disconnected · no demo accounts seeded'));

// Read-only local synchronization. One store instance serializes UI and worker writes.
let syncing=false;
async function syncShopify(){if(syncing||!client)return;syncing=true;try{
 const state=await store.read();if(!state.shopifyOAuth||state.shopifyConnection?.revoked)return;
 if(state.shopifyImport?.status!=='complete')await importLatestOrders({store,client,pages:1});
 else {if(state.shopifyExpeditedScan?.status!=='complete')await syncPaidShippingOrders({store,client,pages:10});await syncChangedOrders({store,client,pages:state.shopifySync?.lastSuccessAt?2:10});await processShopifyUpdates({store,client,limit:10});}
}catch{console.error('Shopify read synchronization needs attention; pending work is retained.');}finally{syncing=false;}}
const syncTimer=setInterval(syncShopify,60000);syncTimer.unref();void syncShopify();
server.on('close',()=>clearInterval(syncTimer));
