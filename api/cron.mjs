import {runtime} from '../app/vercel-runtime.mjs';
import {secretEquals} from '../app/auth.mjs';
import {advanceProductionStages} from '../app/stage-automation.mjs';
import {importLatestOrders,processShopifyUpdates} from '../app/shopify-orders.mjs';
import {syncShopifyStatuses} from '../app/shopify-status.mjs';
import {randomUUID} from 'node:crypto';
export async function runScheduled(app){
 const lease=randomUUID();const claimed=await app.store.transaction(s=>{if(s.scheduledLease?.until>Date.now())return false;s.scheduledLease={id:lease,until:Date.now()+150000};return true;});if(!claimed)return {busy:true};
 try{
  const current=await app.store.read();if(current.productionFacts?.length)await app.store.transaction(s=>{advanceProductionStages(s);});
  if(app.client&&!current.shopifyConnection?.revoked){
   if(current.shopifyImport?.status!=='complete')await importLatestOrders({store:app.store,client:app.client,pages:1});
   else {await processShopifyUpdates({store:app.store,client:app.client,limit:2});if(app.env.SHOPIFY_TAG_SYNC==='1')await syncShopifyStatuses({store:app.store,client:app.client,limit:4,deadline:Date.now()+45000});}
  }
  await app.store.transaction(s=>{s.lastScheduledRun={at:new Date().toISOString(),status:'complete'};});return {ok:true};
 }catch{await app.store.transaction(s=>{s.lastScheduledRun={at:new Date().toISOString(),status:'needs_attention',message:'A scheduled source check failed; pending work is retained.'};});return {ok:false};}
 finally{await app.store.transaction(s=>{if(s.scheduledLease?.id===lease)delete s.scheduledLease;});}
}
export default async function handler(req,res){
 if(req.method!=='GET'){res.writeHead(405);return res.end();}
 if(!process.env.CRON_SECRET||!secretEquals(req.headers.authorization,'Bearer '+process.env.CRON_SECRET)){res.writeHead(401);return res.end();}
 try{const result=await runScheduled(await runtime());res.writeHead(result.ok===false?503:200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(result));}catch{res.writeHead(503,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'Scheduled processing needs attention'}));}
}
