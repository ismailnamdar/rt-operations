import {ensureGmailWatch} from '../app/gmail-push.mjs';
import {processProductionRefresh} from '../app/production-refresh.mjs';
import {organizeReviewCategories} from '../app/review-routing.mjs';
import {syncGmail} from '../app/gmail-sync.mjs';
import {prepareScriptedDrafts} from '../app/scripted-drafts.mjs';
import {processDriveRedo} from '../app/drive-redo.mjs';
import {runtime} from '../app/vercel-runtime.mjs';
import {secretEquals} from '../app/auth.mjs';
import {advanceProductionStages} from '../app/stage-automation.mjs';
import {syncPaidShippingOrders,importLatestOrders,processShopifyUpdates,syncChangedOrders} from '../app/shopify-orders.mjs';
import {syncVerifiedStatusTags} from '../app/shopify-status.mjs';
import {randomUUID} from 'node:crypto';
export async function runScheduled(app){
 const lease=randomUUID();const claimed=await app.store.transaction(s=>{if(s.scheduledLease?.until>Date.now())return false;s.scheduledLease={id:lease,until:Date.now()+150000};return true;});if(!claimed)return {busy:true};
 try{
  const current=await app.store.read(),tasks=[];
  tasks.push(['stages',async()=>{if(current.productionFacts?.length)await (app.store.stageTransaction||app.store.transaction)(s=>{advanceProductionStages(s);});}]);
  if(app.gmail?.configured()&&app.env.GMAIL_PUSH_TOPIC)tasks.push(['gmailWatch',()=>ensureGmailWatch({store:app.store,gmail:app.gmail,topic:app.env.GMAIL_PUSH_TOPIC})]);
  if(app.gmail?.configured())tasks.push(['gmail',()=>syncGmail({store:app.store,gmail:app.gmail,labelSync:app.env.GMAIL_LABEL_SYNC==='1'})]);
  if(app.drive)tasks.push(['drive',async()=>{const redo=(current.redoRequests||[]).find(r=>r.status!=='resolved'&&!r.fileReturn?.verified);if(redo&&app.drive.writeEnabled)await processDriveRedo({store:app.store,drive:app.drive,id:redo.id});if(!current.snapshot.driveProduction?.checkedAt||Date.now()-Date.parse(current.driveFullInventoryAt||current.snapshot.driveProduction.checkedAt)>300000)await app.drive.sync(app.store);else if(app.drive.syncIntake)await app.drive.syncIntake(app.store);}]);
  if(app.client&&!current.shopifyConnection?.revoked)tasks.push(['shopify',async()=>{
   if(current.shopifyImport?.status!=='complete')await importLatestOrders({store:app.store,client:app.client,pages:1});
   else {if(current.shopifyExpeditedScan?.status!=='complete')await syncPaidShippingOrders({store:app.store,client:app.client,pages:1});await syncChangedOrders({store:app.store,client:app.client,pages:1});await processShopifyUpdates({store:app.store,client:app.client,limit:20});}
  }]);
  if(app.client&&!current.shopifyConnection?.revoked&&(app.env.SHOPIFY_TAG_SYNC!=='0'||current.settings.shopifyTagSyncEnabled))tasks.push(['shopifyStageTags',async()=>{if(current.settings.shopifyTagSyncEnabled===undefined)await (app.store.stageTransaction||app.store.transaction)(s=>{if(s.settings.shopifyTagSyncEnabled===undefined)s.settings.shopifyTagSyncEnabled=true;});return syncVerifiedStatusTags({store:app.store,client:app.client,limit:20});}]);
  if(app.client)tasks.push(['productionRefresh',()=>processProductionRefresh({store:app.store,client:app.client,limit:12,deadline:Date.now()+20000})]);
  if(app.livePrescan)tasks.push(['prescan',async()=>{try{const result=await app.livePrescan.run();await (app.store.stageTransaction||app.store.transaction)(s=>{s.lastLivePrescan={at:new Date().toISOString(),status:'complete',...result};});return result;}catch(error){await (app.store.stageTransaction||app.store.transaction)(s=>{s.lastLivePrescan={at:new Date().toISOString(),status:'needs_attention',message:error.message};});throw error;}}]);
  const settled=await Promise.allSettled(tasks.map(([,run])=>run())),sources=Object.fromEntries(settled.map((result,i)=>[tasks[i][0],{status:result.status==='fulfilled'&&result.value?.status!=='needs_attention'?'complete':'needs_attention'}]));
  const ok=Object.values(sources).every(r=>r.status==='complete');await app.store.transaction(s=>{prepareScriptedDrafts(s);organizeReviewCategories(s);});await (app.store.stageTransaction||app.store.transaction)(s=>{s.lastScheduledRun={at:new Date().toISOString(),status:ok?'complete':'needs_attention',sources};});return {ok,sources};
 }catch{await (app.store.stageTransaction||app.store.transaction)(s=>{s.lastScheduledRun={at:new Date().toISOString(),status:'needs_attention',message:'A scheduled source check failed; pending work is retained.'};});return {ok:false};}
 finally{await app.store.transaction(s=>{if(s.scheduledLease?.id===lease)delete s.scheduledLease;});}
}
export default async function handler(req,res){
 if(req.method!=='GET'){res.writeHead(405);return res.end();}
 if(!process.env.CRON_SECRET||!secretEquals(req.headers.authorization,'Bearer '+process.env.CRON_SECRET)){res.writeHead(401);return res.end();}
 try{const result=await runScheduled(await runtime());res.writeHead(result.ok===false?503:200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(result));}catch{res.writeHead(503,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'Scheduled processing needs attention'}));}
}
