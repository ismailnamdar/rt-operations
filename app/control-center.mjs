import {requireRole} from './auth.mjs';
import {fail,record} from './shipping.mjs';
import {prescanReport} from './live-prescan.mjs';
export function detectProductionRollover(s,runs,now){
 const prior=s.snapshot.productionRuns?.runs||[],known=new Set(prior.map(r=>r.id)),currentId=s.settings.upcomingProductionRunId,current=prior.find(r=>r.id===currentId);
 if(!current)return;
 const number=r=>Number((r.name||'').match(/^pro\s*(\d+)$/i)?.[1]||0);
 const next=runs.filter(r=>!known.has(r.id)&&number(r)>number(current)).sort((a,b)=>number(a)-number(b))[0];
 if(!next)return;
 s.productionTransitions||=[];
 s.productionTransitions.push({id:current.id+'->'+next.id,runId:current.id,runName:current.name,nextRunId:next.id,nextRunName:next.name,detectedAt:now,orders:structuredClone(current.orders||[])});
 s.settings.upcomingProductionRunId=next.id;
}
export function controlCenter(s,user){
 const items=[];
 if(user.role==='owner'){
  if(s.settings.shopifyTagSyncEnabled&&s.shopifyTagAccess?.allowed===false)items.push({id:'sync:shopify-tags',kind:'sync',title:'Shopify stage tags need attention',detail:s.shopifyTagAccess.message,action:'Check integrations'});
  for(const request of Object.values(s.productionRefresh||{})){if(!Object.keys(request.failures||{}).length)continue;const run=s.snapshot.productionRuns?.runs?.find(r=>r.id===request.runId);items.push({id:'production-refresh:'+request.id,kind:'reconciliation',title:'Production refresh · '+(run?.name||request.runId),detail:Object.entries(request.failures).map(([order,error])=>'#'+order+': '+error).join('\n'),order:Object.keys(request.failures)[0],runId:request.runId,action:'Review order'});}
  for(const run of s.snapshot.productionRuns?.runs||[]){if(run.id!==s.settings.upcomingProductionRunId&&!(s.prescanJobs||[]).some(j=>j.runId===run.id&&j.status!=='superseded'&&j.liveStatus!=='booked'))continue;const report=prescanReport(s,run.id);items.push({id:'prescan:'+run.id,kind:'prescan',title:run.name+' · shipping prescan',detail:report.rows.length+' orders · '+report.rows.filter(r=>r.status==='ready_for_owner').length+' ready for your purchase approval. Handoff uses this run’s production date; holds and pickup orders are excluded.',runId:run.id,action:'Review prescan'});}
  const pending=Object.values(s.gmailSync?.pending||{}),unavailable=pending.filter(p=>p.providerStatus===404).length,failed=pending.filter(p=>p.error).length;
  if(failed)items.push({id:'sync:gmail',kind:'sync',title:'Gmail needs attention',detail:`${pending.length} conversations queued; ${unavailable} unavailable conversations and ${failed-unavailable} other failures. Unresolved inquiries are retained. Unavailable sources do not block new email processing.`,action:'Check integrations'});
  if(s.lastScheduledRun?.at&&Date.now()-Date.parse(s.lastScheduledRun.at)>300000)items.push({id:'sync:scheduler',kind:'sync',title:'Automatic sync is overdue',detail:'The last saved scheduled run is more than five minutes old. Check Vercel cron execution and logs.',action:'Check integrations'});
 }
 for(const transition of s.productionTransitions||[]){for(const row of transition.orders){const order=String(row.order),intents=s.intents.filter(i=>i.approved.orders.some(n=>String(n)===order)),redos=(s.redoRequests||[]).filter(r=>r.orders.includes(order)&&r.status!=='resolved');
 const reasons=[];if(!intents.length||intents.some(i=>!i.booking))reasons.push('No saved label');if(row.hold||redos.length||intents.some(i=>i.redoHold||i.status==='held'))reasons.push('On hold');if(!intents.length||!intents.some(i=>i.booking||i.packed?.length||i.labelAppliedAt))reasons.push('No recorded shipping action');
 if(reasons.length)items.push({id:'reconcile:'+transition.id+':'+order,kind:'reconciliation',title:'#'+order+' · '+transition.runName,detail:reasons.join(' · ')+'. '+transition.nextRunName+' is now upcoming.',order,runId:transition.runId,action:'Review order',createdAt:transition.detectedAt});
 }}
 for(const redo of s.redoRequests||[])if(redo.flaggedForOwner&&redo.status!=='resolved')items.push({id:'redo:'+redo.id,kind:'attention',title:'Redo · '+redo.orders.map(n=>'#'+n).join(', '),detail:redo.fileReturn?.verified?'Artwork returned to DONE READY 4 PRINT as '+redo.fileReturn.name+'. Queued for the next eligible production.':redo.fileReturn?.status==='needs_attention'?'Drive move or rename failed verification. Order remains held.':'Artwork must return to DONE READY 4 PRINT with a .redo suffix. Drive write authorization and source verification are required.',order:redo.orders[0],runId:redo.productionId,action:'Review order',createdAt:redo.requestedAt});
 for(const intent of s.intents)if(!intent.booking&&intent.status==='approved')items.push({id:'booking:'+intent.id,kind:'approval',title:'Booking approval · '+intent.approved.orders.map(n=>'#'+n).join(', '),detail:'Review the verified shipment before approving a label purchase.',order:String(intent.approved.orders[0]),runId:intent.approved.productionId,action:'Review order'});
 return items.map(item=>({...item,acknowledged:!!s.controlAcknowledgements?.[user.id]?.[item.id]}));
}
export function acknowledgeControl(s,user,{id}){requireRole(user,['owner','viewer']);if(!controlCenter(s,user).some(i=>i.id===id))fail('Attention item is no longer active',404);s.controlAcknowledgements||={};s.controlAcknowledgements[user.id]||={};s.controlAcknowledgements[user.id][id]=new Date().toISOString();record(s,'control_item_acknowledged',user,{id});return {ok:true};}
