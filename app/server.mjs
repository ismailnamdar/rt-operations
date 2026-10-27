import {authorizeSupabaseStaff} from './supabase-auth.mjs';
import {DisabledCarrier,shippingProvider} from './shipping-provider.mjs';
import {processDriveRedo} from './drive-redo.mjs';
import {controlCenter,acknowledgeControl} from './control-center.mjs';
import {visibleSnapshot} from './visibility.mjs';
import {bootstrapOwner,inviteUser,acceptInvitation,disableUser} from './accounts.mjs';
import {ShopifyStatusClient,syncShopifyStatuses} from './shopify-status.mjs';
import http from 'node:http';
import {closeUpcoming,simulatePrescan} from './upcoming-close.mjs';
import {MOCK_MAIL,simulateWorkflow,seedUnreadReviewDemo} from './workflow-simulation.mjs';
import {advanceProductionStages} from './stage-automation.mjs';
import {cutOffProduction,upcomingIntake} from './production-cutoff.mjs';
import {setOrderStage} from './production-stages.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID,createHash} from 'node:crypto';
import {createStore} from './store.mjs';
import {resolveOrigins} from './origins.mjs';
import {login,sessionFor,secretEquals,requireRole,digest} from './auth.mjs';
import {MockCarrier,ParselCarrier,labelFormat} from './parsel.mjs';
import {importIntent,pack,approveProductionAndBook,scanAndBook,reprint,claimPrint,completePrint,verifyApplied,reconcileBooking,enqueuePrint,requestRedo,resolveRedo,record,fail,fingerprint} from './shipping.mjs';
import {saveReviews,approveReviews} from './reviews.mjs';
import {GmailClient} from './gmail.mjs';
import {processApprovedEmails,reconcileApprovedEmails} from './email-worker.mjs';
const here=path.dirname(fileURLToPath(import.meta.url));
export async function createServer({store,provider,origin='http://127.0.0.1:43841',allowedOrigins=[origin],stationToken='',workflowToken='',demo=false,shopify=null,gmail=null,serverless=false,emailSendingEnabled=false,verifyOrder=null,attachmentRoot=null,setupToken='',ownerEmail='',shopifyImport=null,shopifyRefresh=null,shuttle2=null,drivePreviewDir=null,drive=null,supabaseAuth=null,shopifyOAuth=null,shopifyWebhookSetup=null}={}){
 store||=await createStore();if(demo)await store.transaction(s=>{seedUnreadReviewDemo(s);return true;});provider||=demo?new MockCarrier():new DisabledCarrier();const events=new Set();
 const files=['goat-output-model.js','control-center.js','app.js','orders-modern.js','expedited-urgency.js','index.html','style.css','mockup-batches-ui.js','production-ui.js','production-sheet.js','production-pages.js','production-runs.js','rug-shapes.js','order-detail.js','order-items.js','order-stages.js','demo-sun.svg','demo-wave.svg','demo-leaf.svg','production.css','hosted-ui.js','team-ui.js'];
 const clientVersion=createHash('sha256').update((await Promise.all(files.map(n=>fs.readFile(path.join(here,'public',n))))).join('')).digest('hex').slice(0,16);
 const hosts=new Map(allowedOrigins.map(o=>[new URL(o).host,o]));
 function publish(){for(const res of events)res.write('data: changed\n\n');}
 function json(res,status,data){res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));}
 async function body(req){if(req.body!==undefined){if(!String(req.headers['content-type']).startsWith('application/json'))fail('JSON required',415);const bytes=Buffer.byteLength(JSON.stringify(req.body));if(bytes>2*1024*1024)fail('Request exceeds limit',413);if(typeof req.body!=='object'||req.body===null)fail('JSON required',415);return req.body;}if(!String(req.headers['content-type']).startsWith('application/json'))fail('JSON required',415);let bytes=0,text='';for await(const chunk of req){bytes+=chunk.length;if(bytes>2*1024*1024)fail('Request exceeds limit',413);text+=chunk;}try{return JSON.parse(text);}catch{fail('Invalid JSON',400);}}
 const server=http.createServer(async(req,res)=>{try{
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  const requestOrigin=hosts.get(req.headers.host);if(!requestOrigin)fail('Unexpected host',403);const url=new URL(req.url,requestOrigin);
  if(req.method==='GET'&&url.pathname==='/auth/shopify/callback'){if(!shopifyOAuth)fail('Shopify OAuth is not configured',503);const nonce=String(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('shuttle_shopify_state='))?.slice(22);await shopifyOAuth.callback(url.searchParams,nonce);res.setHeader('Set-Cookie','shuttle_shopify_state=; HttpOnly; SameSite=Lax; Path=/auth/shopify; Max-Age=0');res.writeHead(302,{Location:'/#home'});return res.end();}
  if(url.pathname==='/health')return json(res,200,{ok:true,mode:demo?'test':'configured',carrier:provider.disabled?'disconnected':provider instanceof MockCarrier?'mock':'parsel'});
  if(req.method==='GET'&&url.pathname==='/auth/config')return json(res,200,{provider:supabaseAuth?'supabase':'local',configured:supabaseAuth?supabaseAuth.configured():true});
  if(supabaseAuth&&req.method==='GET'&&['/setup','/accept'].includes(url.pathname)){res.writeHead(302,{Location:'/login'});return res.end();}
  if(url.pathname==='/favicon.ico'){res.writeHead(204);return res.end();}
  if(req.method==='POST'&&url.pathname==='/auth/login'){
   if(req.headers.origin!==requestOrigin)fail('Same-origin login required',403);
   const b=await body(req),session=await (supabaseAuth?supabaseAuth.login.bind(supabaseAuth):login)(store,b.email,b.password,serverless?String(req.headers['x-forwarded-for']||req.socket?.remoteAddress||'unknown').split(',')[0]:req.socket.remoteAddress);res.setHeader('Set-Cookie',`shuttle_session=${session.token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${session.maxAge||28800}${requestOrigin.startsWith('https:')?'; Secure':''}`);return json(res,200,{user:session.user});
  }
  const bearer=String(req.headers.authorization||'').replace(/^Bearer /,'');
  if(req.method==='POST'&&['/auth/bootstrap','/auth/accept'].includes(url.pathname)){
   if(supabaseAuth)fail('Account passwords are managed in Supabase Authentication. Sign in using your verified Supabase account.',409);
   if(req.headers.origin!==requestOrigin)fail('Same-origin account request required',403);const b=await body(req);
   const result=url.pathname==='/auth/bootstrap'?await bootstrapOwner(store,{...b,token:bearer},{setupToken,ownerEmail}):await acceptInvitation(store,b);return json(res,200,result);
  }
  const publicAccountFiles={'/setup':'setup.html','/accept':'accept.html','/account-setup.js':'account-setup.js','/account.css':'account.css'};
  if(req.method==='GET'&&publicAccountFiles[url.pathname]){const name=publicAccountFiles[url.pathname];res.writeHead(200,{'Content-Type':name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'text/html','Cache-Control':'no-store'});return res.end(await fs.readFile(path.join(here,'public',name)));}

  if(url.pathname.startsWith('/api/station/')){
   if(!secretEquals(bearer,stationToken))fail('Station authorization required',401);
   if(req.method==='POST'&&url.pathname==='/api/station/claim'){const result=await store.transaction(s=>claimPrint(s,'warehouse-zebra'));publish();return json(res,200,result);}
   if(req.method==='POST'&&url.pathname==='/api/station/complete'){const b=await body(req),result=await store.transaction(s=>completePrint(s,'warehouse-zebra',b));publish();return json(res,200,result);}
   if(req.method==='GET'&&url.pathname==='/api/station/label'){const s=await store.read(),j=s.printJobs.find(x=>x.id===url.searchParams.get('id')&&x.status==='claimed'&&x.station==='warehouse-zebra'&&x.claimToken===url.searchParams.get('claim'));if(!j)fail('Valid print claim required',403);const i=s.intents.find(i=>i.id===j.intentId),bytes=await provider.label(i.booking);if(j.format!=='ZPL'||labelFormat(bytes)!=='ZPL')fail('Print station requires verified ZPL bytes');res.writeHead(200,{'Content-Type':'application/octet-stream','Cache-Control':'no-store'});return res.end(bytes);}
   fail('Unknown station action',404);
  }
  if(url.pathname.startsWith('/api/workflow/')){
   if(!secretEquals(bearer,workflowToken))fail('Workflow authorization required',401);const s=await store.read();
   if(req.method==='GET'&&url.pathname==='/api/workflow/jobs')return json(res,200,{jobs:s.jobs.filter(j=>j.status==='queued')});
   // Consumers must independently verify the current sources before reporting a result.
   if(req.method==='POST'&&url.pathname==='/api/workflow/result'){const b=await body(req);if(!b.jobId||!['review','needs_attention'].includes(b.status))fail('Only review/attention results supported until live send verification is implemented',400);await store.transaction(s=>{const j=s.jobs.find(j=>j.id===b.jobId&&j.status==='queued');if(!j)fail('Queued job not found');j.status=b.status;j.summary=String(b.summary||'').slice(0,2000);return j;});publish();return json(res,200,{ok:true});}
   fail('Unknown workflow action',404);
  }
  const state=await store.read(),cookie=String(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('shuttle_session='))?.slice(16),localAuth=sessionFor(state,cookie),auth=supabaseAuth?await supabaseAuth.verify(localAuth,cookie):localAuth;
  if(!auth){if(url.pathname==='/login'||url.pathname==='/login.js'){const name=url.pathname==='/login'?'login.html':'login.js';res.writeHead(200,{'Content-Type':name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'text/html','Cache-Control':'no-store'});return res.end(await fs.readFile(path.join(here,'public',name)));}if(url.pathname.startsWith('/api/'))fail('Sign in to SHUTTLE',401);res.writeHead(302,{Location:'/login'});return res.end();}
  if(url.pathname==='/login'){res.writeHead(302,{Location:'/'});return res.end();}
  const user=auth.user;
  if(req.method==='POST'){
   if(req.headers.origin!==requestOrigin||!secretEquals(req.headers['x-shuttle-token'],auth.session.csrf))fail('Reload SHUTTLE before submitting',403);const b=await body(req);let result;
   if(provider.disabled&&['/api/warehouse/production-approve','/api/warehouse/book','/api/warehouse/approve-run','/api/warehouse/print','/api/warehouse/print-run','/api/warehouse/reprint','/api/warehouse/reconcile'].includes(url.pathname))provider.unavailable();
   if(shuttle2?.handles('POST',url.pathname)){requireRole(user,['owner']);const response=await shuttle2.request('POST',url.pathname+url.search,b);res.writeHead(response.status,{'Content-Type':response.type,'Cache-Control':'no-store'});return res.end(response.bytes);}
   if(url.pathname==='/auth/logout'){if(supabaseAuth)await supabaseAuth.logout(cookie);await store.transaction(s=>{s.sessions=s.sessions.filter(x=>x.hash!==digest(cookie));return true;});res.setHeader('Set-Cookie','shuttle_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');return json(res,200,{ok:true});}
   if(url.pathname==='/api/shopify/connect'){if(!shopifyOAuth)fail('Shopify OAuth is not configured',503);const link=await shopifyOAuth.start(user);res.setHeader('Set-Cookie',`shuttle_shopify_state=${link.nonce}; HttpOnly; SameSite=Lax; Path=/auth/shopify; Max-Age=600${requestOrigin.startsWith('https:')?'; Secure':''}`);return json(res,200,{url:link.url});}
   if(url.pathname==='/api/team/invite')result=supabaseAuth?await authorizeSupabaseStaff(store,user,b):await inviteUser(store,user,b,origin);
   else if(url.pathname==='/api/team/disable')result=await disableUser(store,user,b.id);
   else if(url.pathname==='/api/control-center/acknowledge')result=await store.transaction(s=>acknowledgeControl(s,user,b));
   else if(url.pathname==='/api/drive/sync'){requireRole(user,['owner']);if(!drive)fail('Read-only Drive authorization is not configured',503);result=await drive.sync(store);}
   else if(url.pathname==='/api/shopify/webhooks/setup'){requireRole(user,['owner']);if(!shopifyWebhookSetup)fail('Webhook registration requires the deployed app and app signing mode',503);result=await shopifyWebhookSetup(user);}
   else if(url.pathname==='/api/shopify/refresh'){requireRole(user,['owner']);if(!shopifyRefresh)fail('Shopify connection is not configured',503);result=await shopifyRefresh();}
   else if(url.pathname==='/api/shopify/import'){requireRole(user,['owner']);if(!shopifyImport)fail('Shopify connection is not configured',503);result=await shopifyImport();}
   else if(url.pathname==='/api/warehouse/import')result=await store.transaction(s=>importIntent(s,user,b));
   else if(url.pathname==='/api/production/close-upcoming')result=await store.transaction(s=>{const cutoff=closeUpcoming(s,user,b);if(demo)simulatePrescan(s,cutoff.runId);return {cutoff};});
   else if(url.pathname==='/api/production/cutoff')result=await store.transaction(s=>cutOffProduction(s,user,b));
   else if(url.pathname==='/api/warehouse/pack')result=await store.transaction(s=>pack(s,user,b.id,b.rugId));
   else if(url.pathname==='/api/warehouse/production-approve')result=await approveProductionAndBook({store,provider,user,id:b.id});
   else if(url.pathname==='/api/warehouse/book'){requireRole(user,['owner']);result=await approveProductionAndBook({store,provider,user,id:b.id});}
   else if(url.pathname==='/api/warehouse/approve-run'){requireRole(user,['owner']);const rows=(await store.read()).intents.filter(i=>i.approved.productionId===b.productionId);result={results:[]};for(const i of rows){try{const r=await approveProductionAndBook({store,provider,user,id:i.id});result.results.push({id:i.id,ok:true,duplicate:!!r.duplicate});}catch(e){result.results.push({id:i.id,ok:false,error:e.message});}}}
   else if(url.pathname==='/api/warehouse/print-run'){requireRole(user,['owner','warehouse']);result=await store.transaction(s=>{const rows=s.intents.filter(i=>i.approved.productionId===b.productionId&&i.booking&&!i.redoHold);const jobs=rows.map(i=>enqueuePrint(s,user,i,false)).filter(Boolean);return {jobs};});}
   else if(url.pathname==='/api/warehouse/stage')result=await store.transaction(s=>setOrderStage(s,user,b));
   else if(url.pathname==='/api/warehouse/redo/resolve')result=await store.transaction(s=>resolveRedo(s,user,b));
   else if(url.pathname==='/api/warehouse/redo'){result=await store.transaction(s=>requestRedo(s,user,b));await processDriveRedo({store,drive,id:result.id});}
   else if(url.pathname==='/api/warehouse/print'){requireRole(user,['owner','warehouse']);result=await store.transaction(s=>{const i=s.intents.find(i=>i.id===b.id);if(!i?.booking)fail('Waiting for owner booking approval');return {job:enqueuePrint(s,user,i,false)};});}
   else if(url.pathname==='/api/warehouse/reprint')result=await store.transaction(s=>reprint(s,user,b.id));
   else if(url.pathname==='/api/warehouse/reconcile')result=await reconcileBooking({store,provider,user,id:b.id});
   else if(url.pathname==='/api/warehouse/applied')result=await store.transaction(s=>verifyApplied(s,user,b.id,b.tracking));
   else if(url.pathname==='/api/warehouse/hold'){requireRole(user,['owner']);result=await store.transaction(s=>{const i=s.intents.find(i=>i.id===b.id);if(!i||['checking','booking_pending','booking_uncertain'].includes(i.status))fail('Reconcile the booking attempt before changing a hold');i.status='held';record(s,'owner_hold',user,{intentId:i.id});return i;});}
   else if(url.pathname==='/api/demo/simulate'){requireRole(user,['owner']);if(!demo)fail('Simulation is unavailable',403);result=await store.transaction(s=>simulateWorkflow(s,b.mode));}
   else if(url.pathname==='/api/demo/load'){requireRole(user,['owner']);if(!demo)fail('Demo data unavailable',403);result=await store.transaction(s=>{const id='S-TEST-'+randomUUID().slice(0,8);return importIntent(s,user,{id,productionId:'TEST-RUN',proofHash:'test-proof',sourceVersion:'test-source',orders:['TEST-100'],units:[{id:'TEST-RUG-'+id,design:'Demonstration rug',size:'3x5',qcPassed:true}],carrier:b.carrier==='FedEx'?'FedEx':'UPS',service:b.carrier==='FedEx'?'StandardOvernight':'Ground',shipDate:new Intl.DateTimeFormat('en-CA',{timeZone:'America/Los_Angeles'}).format(new Date()),shipmentId:randomUUID(),rateId:randomUUID(),maxCostCents:2000,currency:'USD',destination:{name:'TEST ONLY',street1:'TEST ADDRESS',city:'TEST',state:'CA',zip:'00000',country:'US'},package:{length:36,width:6,height:6,weight:7,length_unit:'IN',weight_unit:'LB'},paymentVerified:true,validUntil:new Date(Date.now()+86400000).toISOString(),evidence:Object.fromEntries(['orders','address','package','payment','priorLabels','sourceCoverage'].map(k=>[k,{verified:true,reference:'DEMO — not live evidence'}]))});});}
   else if(url.pathname==='/api/review/save')result=await store.transaction(s=>saveReviews(s,user,b.items));
   else if(url.pathname==='/api/email/context'){requireRole(user,['owner']);if(!gmail?.configured())fail('Google authorization is not configured',503);result=await gmail.context(b.threadId,b.recipient);}
   else if(url.pathname==='/api/email/reconcile'){requireRole(user,['owner']);if(!gmail?.configured())fail('Google authorization is not configured',503);result=await reconcileApprovedEmails({store,gmail,jobId:b.jobId});}
   else if(url.pathname==='/api/approve'){requireRole(user,['owner']);if(!emailSendingEnabled||!gmail?.configured())fail('Direct Gmail sending is not enabled yet; your edits can still be saved',503);result=await store.transaction(s=>approveReviews(s,user,b.items,b.requestId));if(!result.duplicate&&!serverless)setImmediate(()=>processApprovedEmails({store,gmail,jobId:result.run.id,attachmentRoot,verifyOrder}).then(publish).catch(async()=>{await store.transaction(s=>{const j=s.jobs.find(j=>j.id===result.run.id);if(j.status==='queued'){j.status='needs_attention';j.summary='Google access needs attention; no send started';}return true;});publish();}));}
   else if(url.pathname==='/api/schedule'){requireRole(user,['owner']);if(!Array.isArray(b.days)||b.days.some(d=>typeof d!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(d)))fail('Use YYYY-MM-DD dates',400);result=await store.transaction(s=>{if(b.version!==s.snapshot.schedule.version)fail('Calendar changed; reload before saving');s.snapshot.schedule={days:[...new Set(b.days)].sort(),version:randomUUID()};return {schedule:s.snapshot.schedule};});}
   else if(url.pathname==='/api/run'){requireRole(user,['owner']);if(!process.env.N8N_JOB_WEBHOOK)fail('Hosted email workflow is not connected yet',503);if(!['banda','complete','pipeline','expedited'].includes(b.mode))fail('Mode not supported in first release',400);result=await store.transaction(s=>{const j={id:randomUUID(),mode:b.mode,status:'queued',createdAt:new Date().toISOString(),actor:user.id};s.jobs.push(j);return {run:j};});}
   else {requireRole(user,['owner']);fail('This existing SHUTTLE action still needs its hosted integration; no customer action was performed',503);}
   publish();return json(res,200,result);
  }
  if(req.method!=='GET')fail('Method not allowed',405);
  if(shuttle2?.handles('GET',url.pathname)){requireRole(user,['owner']);const response=await shuttle2.request('GET',url.pathname+url.search);res.writeHead(response.status,{'Content-Type':response.type,'Cache-Control':'no-store'});return res.end(response.bytes);}
  if(url.pathname==='/api/production/preview'){
   const id=url.searchParams.get('id');if((!drivePreviewDir&&!drive)||!/^[a-zA-Z0-9_-]+$/.test(id||'')||!state.snapshot.driveProduction?.fileIds.includes(id))fail('Verified preview not available',404);
   if(drive&&!drivePreviewDir){try{const preview=await drive.preview(id,state.snapshot.driveProduction,state.snapshot.productionRuns.runs.map(r=>r.id));res.writeHead(200,{'Content-Type':preview.type,'Cache-Control':'private, max-age=300'});return res.end(preview.bytes);}catch{fail('Drive preview needs authorization or reconciliation',503);}}
   let bytes;try{bytes=await fs.readFile(path.join(drivePreviewDir,id+'.jpg'));}catch{fail('Preview cache is not ready',404);}res.writeHead(200,{'Content-Type':'image/jpeg','Cache-Control':'private, max-age=300'});return res.end(bytes);
  }
  if(url.pathname==='/api/team'){requireRole(user,['owner']);return json(res,200,{users:state.users.map(({id,email,role,disabled,flagManager})=>({id,email,role,disabled:!!disabled,flagManager:!!flagManager}))});}
  if(url.pathname==='/api/warehouse/label'){requireRole(user,['owner','warehouse']);const i=state.intents.find(i=>i.id===url.searchParams.get('id'));if(!i?.booking)fail('No booked label',404);const bytes=await provider.label(i.booking),format=labelFormat(bytes),inline=['PDF','PNG'].includes(format);res.writeHead(200,{'Content-Type':format==='PDF'?'application/pdf':format==='PNG'?'image/png':'application/octet-stream','Content-Disposition':`${inline?'inline':'attachment'}; filename="booked-label.${format.toLowerCase()}"`,'Cache-Control':'no-store'});return res.end(bytes);}
  if(url.pathname==='/api/events'&&serverless)return json(res,200,{transport:'poll',intervalMs:15000});
  if(url.pathname==='/api/events'){res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-store','Connection':'keep-alive'});res.write('retry: 3000\ndata: connected\n\n');events.add(res);const timer=setInterval(()=>{if(auth.session.expiresAt<=Date.now()){res.end();return;}res.write(': keepalive\n\n');},25000);req.on('close',()=>{clearInterval(timer);events.delete(res);});return;}
  if(url.pathname==='/api/live'||url.pathname==='/api/state'){
   const s=await store.read(),original=shuttle2&&user.role==='owner'?await shuttle2.snapshot():null,revision=String(s.revision)+(original?'-'+createHash('sha256').update(JSON.stringify(original)).digest('hex').slice(0,16):'');if(url.searchParams.get('since')===revision)return json(res,200,{revision,unchanged:true});
   if(original?.schedule&&JSON.stringify(s.snapshot.schedule)!==JSON.stringify(original.schedule)){await store.transaction(current=>{current.snapshot.schedule=structuredClone(original.schedule);});s.snapshot.schedule=structuredClone(original.schedule);}
   const emailReady=emailSendingEnabled&&!!gmail?.configured();
   const snapshot={...s.snapshot,shopifyStatus:{oauthAvailable:!!shopifyOAuth,oauthConnected:!!s.shopifyOAuth&&!s.shopifyConnection?.revoked,sync:s.shopifySync?{status:s.shopifySync.status,lastSuccessAt:s.shopifySync.lastSuccessAt,error:s.shopifySync.error}:null,configured:!!shopify,items:s.shopifyStatusSync||{},import:s.shopifyImport||null},simulationMail:demo?MOCK_MAIL:[],runs:s.jobs.map(({items,receipts,...j})=>({...j,status:j.status==='processing'?'running':j.status,receiptSummary:receipts?Object.values(receipts).map(({status,messageId,error})=>({status,messageId,error})):[]})),token:auth.session.csrf,clientVersion,connection:{ready:emailReady,message:emailReady?'Direct Gmail sender connected; order and production gates remain.':'Email integrations are awaiting connection. Warehouse controls are available for the configured test mode.'},localSpeed:{idleReviewRefresh:false},orderControls:{items:[],warnings:[],target:80,visible:0,aboveTarget:0,complete:false,unclassified:0,overdue:0},specialistJobs:[],inputQueue:[],approvalQueue:s.jobs.filter(j=>j.mode==='approve'&&['queued','processing','uncertain'].includes(j.status)).map(j=>({runId:j.id,status:j.status,reviewIds:j.items.map(i=>i.id)})),workspaceInputs:[],receiptConfirmation:null,productionArchive:null,productionShipping:{bookingHistory:s.events.filter(e=>e.type==='label_booked').map(({intentId,at})=>({intentId,at})),transitions:s.productionTransitions||[],controlCenter:controlCenter(s,user),upcomingRunId:s.settings.upcomingProductionRunId,intents:s.intents,printJobs:s.printJobs,redoRequests:s.redoRequests||[],orderStages:s.orderStages||{},cutoffs:s.productionCutoffs||[],upcomingIntake:upcomingIntake(s),prescanJobs:s.prescanJobs||[]},hosted:{auth:{provider:supabaseAuth?'supabase':'local'},drive:{configured:!!drive},transport:serverless?'poll':'events',user:{email:user.email,role:user.role},demo,carrier:provider.disabled?'disconnected':provider instanceof MockCarrier?'mock':'parsel',gmail:{configured:!!gmail?.configured(),sendingEnabled:emailReady,mailbox:'info@rugtomize.co'}}};
   if(s.snapshot.driveProduction){const ids=new Set(s.snapshot.productionRuns.runs.map(r=>r.id));snapshot.productionShipping.intents=snapshot.productionShipping.intents.filter(i=>ids.has(i.approved.productionId));snapshot.productionShipping.redoRequests=snapshot.productionShipping.redoRequests.filter(r=>ids.has(r.productionId));snapshot.productionShipping.cutoffs=snapshot.productionShipping.cutoffs.filter(c=>ids.has(c.runId));snapshot.productionShipping.upcomingIntake={...snapshot.productionShipping.upcomingIntake,approvals:(snapshot.productionShipping.upcomingIntake.approvals||[]).filter(a=>!String(a.id||'').startsWith('TEST-')&&!a.isTest),redos:(snapshot.productionShipping.upcomingIntake.redos||[]).filter(r=>ids.has(r.productionId)),approvalWindowVerified:snapshot.productionShipping.cutoffs.length>0};snapshot.productionShipping.driveInventory=s.snapshot.driveProduction;}
   if(original){const retained={goatOutputs:snapshot.goatOutputs,productionRuns:snapshot.productionRuns,token:snapshot.token,clientVersion:snapshot.clientVersion,productionShipping:snapshot.productionShipping,hosted:{...snapshot.hosted,transport:'poll',shuttle2Connected:!!original.connection?.ready,shuttle2Local:true},shopifyStatus:snapshot.shopifyStatus};Object.assign(snapshot,original,retained);}
   visibleSnapshot(snapshot,user);return json(res,200,url.pathname==='/api/state'?snapshot:{revision,full:snapshot});
  }
  const name=url.pathname==='/'?'index.html':url.pathname.slice(1);if(!files.includes(name))fail('Not found',404);let content=await fs.readFile(path.join(here,'public',name));if(name==='index.html')content=content.toString().replace('src="/app.js"',`src="/app.js?v=${clientVersion}"`);res.writeHead(200,{'Content-Type':name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':name.endsWith('.svg')?'image/svg+xml':'text/html','Cache-Control':'no-store'});return res.end(content);
 }catch(e){json(res,e.status||500,{error:e.status?e.message:'Unable to complete request'});}});
 let statusSyncRunning=false;
 const shopifyTimer=setInterval(async()=>{if(!shopify||demo||statusSyncRunning)return;statusSyncRunning=true;try{await syncShopifyStatuses({store,client:shopify});publish();}catch{console.error('Shopify status sync requires attention.');}finally{statusSyncRunning=false;}},60000);shopifyTimer.unref();
 const stageTimer=setInterval(async()=>{try{const current=await store.read();if(current.productionFacts?.length)await store.transaction(s=>{advanceProductionStages(s);return true;});}catch{console.error('Production stage timer requires attention.');}},60000);stageTimer.unref();server.on('close',()=>{clearInterval(stageTimer);clearInterval(shopifyTimer);for(const e of events)e.end();});if(serverless){clearInterval(stageTimer);clearInterval(shopifyTimer);}
 return {server,store,handler:server.listeners('request')[0]};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const port=Number(process.env.PORT||43841),{canonical:origin,allowed:allowedOrigins}=resolveOrigins(process.env,{port}),demo=process.env.SHUTTLE_DEMO==='1';
 if(process.env.NODE_ENV==='production'&&(!origin.startsWith('https:')||!process.env.DATABASE_URL))throw Error('Production requires HTTPS origin and PostgreSQL');
 const provider=demo?new MockCarrier():shippingProvider(process.env);
 const oauth=process.env.GMAIL_OAUTH_TOKEN_FILE?JSON.parse(await fs.readFile(process.env.GMAIL_OAUTH_TOKEN_FILE,'utf8')):{};
 const gmail=new GmailClient({clientId:process.env.GMAIL_CLIENT_ID,clientSecret:process.env.GMAIL_CLIENT_SECRET,refreshToken:oauth.refreshToken||process.env.GMAIL_REFRESH_TOKEN,mailbox:'info@rugtomize.co'});
 const shopify=!demo&&process.env.SHOPIFY_TAG_SYNC==='1'?new ShopifyStatusClient({shop:process.env.SHOPIFY_STORE,token:process.env.SHOPIFY_ADMIN_TOKEN}):null;
 const {server}=await createServer({origin,allowedOrigins,demo,provider,shopify,gmail,emailSendingEnabled:process.env.GMAIL_LIVE_SEND==='1',attachmentRoot:process.env.SHUTTLE_ARTWORK_ROOT,stationToken:process.env.SHUTTLE_STATION_TOKEN,workflowToken:process.env.SHUTTLE_WORKFLOW_TOKEN});server.listen(port,process.env.SHUTTLE_BIND||'127.0.0.1',()=>console.log('SHUTTLE migration preview: '+origin));
}
