export const MOCK_MAIL=[
 {id:'SIM-FLAT',kind:'flat',order:'99001',subject:'The latest proof looks perfect',reply:'Thanks for approving your artwork. Your production confirmation will include the verified next production date.',action:'Banda: verify payment, current proof, production files and prior receipts. Qualified flat: simulate confirmation and filing.',estimate:'30–120 seconds; blocked if any verification fails'},
 {id:'SIM-QUESTION',kind:'approval_question',order:'99002',subject:'Approved — can it arrive Friday?',reply:'Thanks for the approval. I’m checking the production cutoff and services that can meet your requested Friday deadline before confirming an option.',action:'Banda: retain approval-plus-question review; obtain fresh Parsel options. Wait for owner sign-off.',estimate:'1–3 minutes preparation, then owner review; completion time depends on that review'},
 {id:'SIM-REVISION',kind:'revision',order:'99003',subject:'Please change the background to blue',reply:'I’ll prepare an updated proof with the requested blue background for your approval.',action:'Gideon: route revision to GOAT preparation; verify the resulting file before offering it as an attachment. No artwork approval inferred.',estimate:'2–10+ minutes preparation, depending on artwork; then owner/customer approval'},
 {id:'SIM-TRACKING',kind:'tracking',order:'99004',subject:'Has my rug shipped?',reply:'I’m checking your booked shipment and carrier scans so I can give you the current shipping status.',action:'Gideon: verify current Shopify/Parsel facts; prepare an editable factual reply. Never treat label creation as carrier acceptance.',estimate:'15–60 seconds preparation, then owner review'},
 {id:'SIM-NEW',kind:'new_rug_inquiry',subject:'Can you quote three custom rugs?',reply:'What sizes and shapes would you like, and can you share the artwork and any delivery deadline?',action:'Gideon: categorize as New rug order inquiries; collect missing quote details. Do not invent a price.',estimate:'15–60 seconds preparation, then owner review'},
 {id:'SIM-SECURITY',kind:'security',subject:'Account security alert',reply:'Owner attention required. No automated customer reply.',action:'Keep actionable security alert in Inbox; surface in Review without changing account settings.',estimate:'1–5 seconds routing; owner investigation has no fixed completion time'},
 {id:'SIM-PERSONAL',kind:'personal',subject:'Personal correspondence',reply:'No business response proposed.',action:'Show in unread review coverage; leave original labels, Inbox and unread state untouched.',estimate:'1–5 seconds routing; no business action'}
];
export function simulateWorkflow(s,mode){if(!['banda','complete'].includes(mode))throw Error('Unsupported simulation');const cases=mode==='banda'?MOCK_MAIL.filter(m=>['flat','approval_question'].includes(m.kind)):MOCK_MAIL;const result={mode,simulated:true,at:new Date().toISOString(),unreadCoverage:MOCK_MAIL.length,cases:structuredClone(cases),elapsedEstimate:'Banda: roughly 1–4 minutes; Gideon: roughly 3–15+ minutes for this sample. Estimates are not measured live performance.',externalActions:0};s.simulationRuns||=[];s.simulationRuns.push(result);return result;}

// Persist synthetic conversations as ordinary review records; never recreate dismissed cases.
export function seedUnreadReviewDemo(s){
 if(s.settings.unreadReviewDemoVersion)return;
 const groups={flat:'customer_approvals',approval_question:'approval_needs_reply',revision:'artwork',tracking:'shipping',new_rug_inquiry:'quotes',security:'other',personal:'other'};
 for(const mail of MOCK_MAIL){
  if(s.snapshot.results.review.some(i=>i.id===mail.id))continue;
  const noReply=['security','personal'].includes(mail.kind);
  s.snapshot.results.review.push({id:mail.id,version:'mock-review-v1',status:'pending',type:'reply',isTest:true,unread:true,order:mail.order,customer:mail.kind==='security'?'Account security':mail.kind==='personal'?'Personal correspondence':'Test customer',title:mail.subject,customerQuestion:mail.subject,responseGroupId:groups[mail.kind],category:mail.kind==='new_rug_inquiry'?'new_rug_inquiry':undefined,...(!noReply?{body:mail.reply}:{}),replyDisposition:{reason:noReply?mail.reply:'Simulation draft only; live source verification is required before sending.'},blockers:[mail.action],requiresInput:true});
 }
 s.settings.unreadReviewDemoVersion=1;
}
