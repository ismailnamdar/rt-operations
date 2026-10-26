import {requireRole} from './auth.mjs';
import {fail,record} from './shipping.mjs';
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
 for(const transition of s.productionTransitions||[]){for(const row of transition.orders){const order=String(row.order),intents=s.intents.filter(i=>i.approved.orders.some(n=>String(n)===order)),redos=(s.redoRequests||[]).filter(r=>r.orders.includes(order)&&r.status!=='resolved');
 const reasons=[];if(!intents.length||intents.some(i=>!i.booking))reasons.push('No saved label');if(row.hold||redos.length||intents.some(i=>i.redoHold||i.status==='held'))reasons.push('On hold');if(!intents.length||!intents.some(i=>i.booking||i.packed?.length||i.labelAppliedAt))reasons.push('No recorded shipping action');
 if(reasons.length)items.push({id:'reconcile:'+transition.id+':'+order,kind:'reconciliation',title:'#'+order+' · '+transition.runName,detail:reasons.join(' · ')+'. '+transition.nextRunName+' is now upcoming.',order,runId:transition.runId,action:'Review order',createdAt:transition.detectedAt});
 }}
 for(const redo of s.redoRequests||[])if(redo.flaggedForOwner&&redo.status!=='resolved')items.push({id:'redo:'+redo.id,kind:'attention',title:'Redo · '+redo.orders.map(n=>'#'+n).join(', '),detail:redo.fileReturn?.verified?'Artwork returned to DONE READY 4 PRINT as '+redo.fileReturn.name+'. Queued for the next eligible production.':redo.fileReturn?.status==='needs_attention'?'Drive move or rename failed verification. Order remains held.':'Artwork must return to DONE READY 4 PRINT with a .redo suffix. Drive write authorization and source verification are required.',order:redo.orders[0],runId:redo.productionId,action:'Review order',createdAt:redo.requestedAt});
 for(const intent of s.intents)if(!intent.booking&&intent.status==='approved')items.push({id:'booking:'+intent.id,kind:'approval',title:'Booking approval · '+intent.approved.orders.map(n=>'#'+n).join(', '),detail:'Review the verified shipment before approving a label purchase.',order:String(intent.approved.orders[0]),runId:intent.approved.productionId,action:'Review order'});
 return items.map(item=>({...item,acknowledged:!!s.controlAcknowledgements?.[user.id]?.[item.id]}));
}
export function acknowledgeControl(s,user,{id}){requireRole(user,['owner','viewer']);if(!controlCenter(s,user).some(i=>i.id===id))fail('Attention item is no longer active',404);s.controlAcknowledgements||={};s.controlAcknowledgements[user.id]||={};s.controlAcknowledgements[user.id][id]=new Date().toISOString();record(s,'control_item_acknowledged',user,{id});return {ok:true};}
