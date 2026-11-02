import {requireRole} from './auth.mjs';
export async function checkIntegrations({store,user,gmail,drive,provider,parselProbe,emailSendingEnabled=false}){
 requireRole(user,['owner']);const s=await store.read();
 const result={checkedAt:new Date().toISOString(),checks:{},writesPerformed:false};
 result.checks.shopify={connected:!!s.shopifyOAuth&&!s.shopifyConnection?.revoked,importStatus:s.shopifyImport?.status||'not_started',imported:s.shopifyImport?.imported||0,syncStatus:s.shopifySync?.status||'not_checked',lastSuccessAt:s.shopifySync?.lastSuccessAt||null,webhooks:s.shopifyWebhookSetup?.status||'not_verified',note:'Cached connection and sync receipts; this check does not prove a new webhook delivery.'};
 const deliveries=Object.values(s.shopifyWebhookReceipts||{});result.checks.shopify.webhookDelivery={lastReceivedAt:s.shopifyWebhookDelivery?.lastReceivedAt||null,lastTopic:s.shopifyWebhookDelivery?.lastTopic||null,received:deliveries.length,processed:deliveries.filter(r=>r.status==='complete').length,pending:deliveries.filter(r=>r.status==='pending').length,needsAttention:deliveries.filter(r=>r.status==='needs_attention').length};
 if(s.shopifyWebhookDelivery?.lastReceivedAt&&deliveries.some(r=>r.status==='complete')){result.checks.shopify.webhooks='active';result.checks.shopify.note='Signed webhook delivery and completed order-processing receipts are present.';}
 const pending=Object.values(s.gmailSync?.pending||{}),errors={};for(const p of pending)if(p.error){const code=String(p.providerStatus||'unknown');errors[code]=(errors[code]||0)+1;}
 result.checks.gmail={configured:!!gmail?.configured(),status:s.gmailSync?.status||'not_started',pending:pending.length,failedByProviderStatus:errors,lastSuccessAt:s.gmailSync?.lastSuccessAt||null,sendingEnabled:emailSendingEnabled};
 result.checks.drive={configured:!!drive,writeEnabled:!!drive?.writeEnabled,lastSuccessAt:s.snapshot.driveProduction?.checkedAt||null};
 result.checks.parsel={configured:!!parselProbe||!!provider&&!provider.disabled,enabledForOperations:!!provider&&!provider.disabled,authenticatedRead:false,purchasesEnabled:!!provider?.liveBooking,freshVerifierConnected:typeof provider?.verifyCurrent==='function',labelHostsConfigured:!!provider?.labelHosts?.length};
 result.checks.scheduler={status:s.lastScheduledRun?.status||'not_verified',at:s.lastScheduledRun?.at||null,sources:Object.fromEntries(Object.entries(s.lastScheduledRun?.sources||{}).map(([name,value])=>[name,{status:value.status}]))};
 result.checks.printer={status:'not_verified',note:'Requires a Windows station and physical test; a website visit does not prove USB printing.'};
 await Promise.allSettled([
  (async()=>{if(!gmail?.configured())return;try{await gmail.verifyMailbox();result.checks.gmail.authenticatedRead=true;}catch{result.checks.gmail.authenticatedRead=false;result.checks.gmail.action='Reconnect Google or inspect server logs; no messages changed.';}})(),
  (async()=>{if(!parselProbe&&(!provider||provider.disabled))return;try{const reader=parselProbe?parselProbe():provider;await reader.request('/shipments');result.checks.parsel.authenticatedRead=true;}catch{result.checks.parsel.action='Verify private token, API origin and shipment read permission. No purchase attempted.';}})()
 ]);
 return result;
}
