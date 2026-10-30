import {fingerprint} from './shipping.mjs';

// Suggestions only: no Gmail writes, inferred approval, invoice edits or production moves.
export function prepareScriptedDrafts(s,{now=Date.now()}={}){
 const stats={drafted:0,needsContext:0,preserved:0};
 for(const item of s.snapshot.results.review){
  if(!item.gmailManaged||item.status!=='pending')continue;
  const previous=item.scriptedDraft;
  if(item.body&&(!previous||fingerprint(item.body)!==previous.bodyHash)){stats.preserved++;continue;}
  const question=(item.customerQuestion||'').split(/\n\s*(?:On .+wrote:|From:|>)/i)[0].trim();
  const order=s.shopifyOrders?.[String(item.order)],facts=s.productionFacts?.find(f=>String(f.order)===String(item.order));
  const reasons=[];let body='',rule='';
  const fresh=order&&now-Date.parse(order.checkedAt)<15*60000;
  const bound=fresh&&order.email?.toLowerCase()===item.recipient?.toLowerCase();
  const last=item.conversation?.at(-1);
  if(last?.labels?.includes('SENT'))reasons.push('A teammate may already have replied; reconcile SENT before preparing another answer.');
  if(!bound)reasons.push('A current Shopify order and matching customer email are required.');
  if(/refund|cancel|chargeback|change|wrong|damage|missing|discount|invoice|expedit|deadline|\bby\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d)/i.test(question))reasons.push('Contains an exception, change, financial question or delivery commitment requiring review.');
  if(bound&&!reasons.length&&/status|update|tracking|where.*(?:order|rug)|when.*(?:ship|arriv|deliver)|ship.*(?:yet|order)|delivery date/i.test(question)){
   const intents=(s.intents||[]).filter(i=>i.approved.orders.some(n=>String(n)===String(item.order)));
   const stage=s.orderStages?.[item.order]?.stage;
   if(intents.some(i=>i.redoHold||i.approved.hold))reasons.push('An active shipping or redo hold requires owner review.');
   else if(intents.length&&intents.every(i=>i.booking)&&['awaiting carrier','in transit'].includes(stage)){
    const codes=intents.map(i=>i.booking.tracking).filter(Boolean);
    if(codes.length!==intents.length)reasons.push('Tracking is incomplete for the package set.');
    else {rule=stage==='in transit'?'tracking_in_transit':'label_created';body=stage==='in transit'?`Your order is in transit. Your tracking number${codes.length===1?' is':'s are'}: ${codes.join(', ')}.`:`Your shipping label has been created. Please allow another day for carrier handoff. Your tracking number${codes.length===1?' is':'s are'}: ${codes.join(', ')}. A created label does not yet mean the carrier has received your order.`;}
   }else if(!intents.some(i=>i.booking)&&facts?.approvalVerified===true&&facts?.artworkVerified===true&&/^\d{4}-\d{2}-\d{2}$/.test(facts.productionDate||'')&&facts.productionDate>=new Date(now).toLocaleDateString('en-CA',{timeZone:'America/Los_Angeles'})){
    rule='next_production';body=`Your order is queued for our confirmed production run on ${facts.productionDate}.`;
    const units=facts.units;
    if(!Array.isArray(units)||!units.length||units.some(u=>!Number.isFinite(u.widthFeet)||!Number.isFinite(u.lengthFeet)||!Number.isSafeInteger(u.quantity)||u.quantity<1)){body='';reasons.push('Verified rug dimensions and quantities are needed for the one-day/two-day finishing script.');}
    else {const large=units.filter(u=>u.widthFeet>=8&&u.lengthFeet>=8).reduce((sum,u)=>sum+u.quantity,0);body+=` Please allow ${large>1?'two days':'one day'} to cut, stitch, and pack your ${units.reduce((sum,u)=>sum+u.quantity,0)>1?'rugs':'rug'} before shipping.`;}
   }else reasons.push('Current production date or complete shipping evidence is unavailable.');
  }else if(!reasons.length)reasons.push('No approved deterministic reply rule matches the full request.');
  // Do not leave a stale generated answer looking current after its facts change.
  if(!body||reasons.length){if(previous&&item.body&&fingerprint(item.body)===previous.bodyHash)item.body='';item.scriptedDraft={status:'needs_context',reasons,checkedAt:new Date(now).toISOString()};item.replyDisposition={reason:reasons.join(' ')};stats.needsContext++;}
  else {item.body=`Hi,\n\n${body}`;item.scriptedDraft={status:'suggested',rule,sourceVersion:item.sourceVersion,bodyHash:fingerprint(item.body),checkedAt:new Date(now).toISOString(),note:'Rule-based suggestion; owner review and canonical signature required before sending.'};item.replyDisposition={reason:'Scripted suggestion ready for review; sending remains disabled.'};stats.drafted++;}
  item.sendBlocked=true;item.requiresInput=true;item.version=fingerprint({source:item.sourceVersion,body:item.body,scriptedDraft:item.scriptedDraft});
 }
 s.snapshot.scriptedDrafts={...stats,checkedAt:new Date(now).toISOString(),sendingEnabled:false};return stats;
}
