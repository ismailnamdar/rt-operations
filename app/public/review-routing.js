// SHUTTLE 2.0 response-group identities. Routing is not artwork approval or
// authority to send, file, archive, purchase or resolve an inquiry.
export const REVIEW_ROUTING_VERSION='shuttle-2026-11-02-v1';
export const REVIEW_GROUP_IDS=['customer_approvals','approval_needs_reply','support_general','support_chargeback','placement','color','artwork','proof','production','deadline','shipping','quality','billing','identity','quotes','collaboration','business_operations','other'];
const mailbox=from=>String(from||'').match(/<([^>]+)>/)?.[1]?.toLowerCase()||String(from||'').trim().toLowerCase();
const own=m=>(m.labels||[]).includes('SENT')||/^info@rugtomize\.(co|com)$/.test(mailbox(m.from));
export const currentMessageText=text=>String(text||'').split(/\n\s*(?:On .+wrote:|From:\s|-----Original Message-----|>)/i)[0].trim();
export function classifyReviewConversation(item){
 const version=item.sourceVersion||item.version||null;
 const route=(group,reason,candidate=false)=>({group,reason,sourceVersion:version,candidateApproval:candidate,authority:'routing_only',verifiedApproval:false,classifierVersion:REVIEW_ROUTING_VERSION});
 // Preserve reviewed SHUTTLE cases. Gmail imports otherwise start as unreviewed
 // and must be evaluated against their current source, not a default `other`.
 if(!item.gmailManaged){if(item.approvalReviewKind==='needs_reply')return route('approval_needs_reply','Existing SHUTTLE approval-needs-reply classification');if(item.approvalReviewKind==='flat')return route('customer_approvals','Existing SHUTTLE flat-approval classification');if(REVIEW_GROUP_IDS.includes(item.responseGroupId)&&item.responseGroupId!=='other')return route(item.responseGroupId,'Existing SHUTTLE response group');}
 const messages=[...(item.conversation||[])].sort((a,b)=>String(a.date||'').localeCompare(String(b.date||''))),source=messages.find(m=>m.id===item.sourceMessageId)||[...messages].reverse().find(m=>!own(m));
 const text=currentMessageText(source?.text||item.customerQuestion),subject=String(source?.subject||item.title||''),topic=text||subject,label=item.workflowLabel||'';
 const index=source?messages.indexOf(source):-1,prior=index>=0?messages.slice(0,index):[],later=index>=0?messages.slice(index+1):[];
 const lastOutgoing=[...prior].reverse().find(own),proof=!!lastOutgoing&&/mock[ -]?up|\bproof\b|confirm.{0,35}(?:size|shape|design)|review.{0,35}(?:design|artwork)/i.test(currentMessageText(lastOutgoing.text));
 const newerProof=later.some(m=>own(m)&&/mock[ -]?up|\bproof\b|updated.{0,25}(?:design|artwork)/i.test(currentMessageText(m.text)));
 const revision=/\b(?:change|adjust|replace|revise|remove|add|switch|resize|make|move)\b.{0,65}\b(?:design|artwork|logo|size|bigger|smaller|text|word|color|colour|border|font|center|centre|background|circle|rectangle|runner)\b|\b(?:design|artwork|logo|size|color|colour|font|background)\b.{0,45}\b(?:change|adjust|replace|revise|remove|switch)\b/i.test(topic);
 const conditional=/\b(?:only if|as long as|provided that|once you|after you|except for)\b|\bif you\b/i.test(topic);
 if(/\b(?:not|never|haven['’]?t|didn['’]?t|do not|don['’]?t)\s+(?:yet\s+)?(?:approve|approved|approving|confirm)|\bdoesn['’]?t look (?:good|right)\b|\bnot ready to approve\b/i.test(topic))return route('proof','Customer has not approved the current proof; retain for review');
 const approval=/\b(?:looks? (?:good|great|perfect|amazing)|i approve|we approve|approved|go ahead|please proceed|let['’]?s do (?:it|that)|good to go)\b|^(?:yes|perfect|love it)[!. ,\s]*(?:thank(?:s| you)[!. ,\s]*)?$/i.test(topic);
 if(revision||item.requiresUpdatedMockup||(proof&&/\b(?:instead|rather|resize|change|can we|could we)\b.{0,35}\d+(?:\.\d+)?\s*[x×]\s*\d+/i.test(topic))){if(/\b(?:center|centre|orientation|vertical|horizontal|spacing)\b/i.test(topic))return route('placement','Current message requests placement/orientation changes');if(/\b(?:color|colour|shade|darker|lighter|gradient|metallic)\b/i.test(topic))return route('color','Current message requests a color revision');return route('artwork','Current message requests a design/size/artwork revision; not a flat approval');}
 if(approval&&proof&&!newerProof&&!conditional){const question=/\?|\b(?:when|how long|can you|could you|please (?:confirm|tell|check)|tracking|ship|delivery|deliver|deadline|expedit|invoice|payment|refund|address)\b|\bneed.{0,35}\b(?:by|tomorrow|today|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(topic);return route(question?'approval_needs_reply':'customer_approvals',question?'Approval wording plus a separate question; full approval/proof and reply verification still required':'Approval wording in the current proof conversation; exact whole-order proof verification still required',true);}
 if(label==='Support/Chargeback'||/chargeback|payment dispute|disputed (?:charge|payment)/i.test(topic))return route('support_chargeback','Chargeback/dispute inquiry');
 if(label==='Support/Rug-Issue'||/defect|replacement rug|printing error|incorrect rug|wrong rug|damaged|sublimation|quality (?:is|issue|complaint)|falling apart/i.test(topic))return route('quality','Quality/replacement inquiry; remedy requires its existing owner decision');
 if(label==='Support/Address-Change'||/\b(?:address|suite|apartment|postal code|zip code)\b/i.test(topic))return route('identity','Address/contact verification');
 if(label==='Support/General')return route('support_general','Existing Support/General routing');
 if(/refund|cancel(?:lation)?|discount|\binvoice\b|\bbilling\b|payment|charged twice/i.test(topic))return route('billing','Financial/support inquiry; preserve payment/remedy gates');
 if(label==='Collaborations'||/collaborat|partnership|sponsor|influencer|brand ambassador/i.test(topic))return route('collaboration','Partnership/owner-decision inquiry');
 if(/\b(?:business|operations)\b/i.test(label)||/purchase order|vendor|supplier|account statement|subscription renewal|security alert|tax document/i.test(topic))return route('business_operations','Business/operations information for owner review');
 if(/expedit|deadline|delivery date|arriv|need.{0,35}\bby\b|\beta\b/i.test(topic))return route('deadline','Delivery-date or expedited inquiry');
 if(label==='Support/Late-Order'||/tracking|shipment|where (?:is|are).{0,20}(?:order|rug)|missing package|order.{0,20}(?:status|update)|when.{0,25}(?:ship|deliver)/i.test(topic))return route('shipping','Shipping/status inquiry');
 if(/\bcolor\b|\bcolour\b|darker|lighter|gradient|metallic/i.test(topic))return route('color','Color/finish inquiry');
 if(/orientation|vertical|horizontal|center(?:ed|ing)?|centred|spacing/i.test(topic))return route('placement','Placement/orientation inquiry');
 if(conditional||newerProof)return route('proof','Conditional approval or a newer proof requires current-version review');
 if(/proof|mock[ -]?up|vector|source file|logo image|cannot open|can['’]?t open|attachment/i.test(topic))return route('proof','Proof/access/source-artwork inquiry');
 if(label.startsWith('Mockup-Inquiry')||/quote|pricing|\bprice\b|\bcost\b|\bsize\b|material|custom (?:rug|runner)|how much|rug care|wash|durab|high.traffic/i.test(topic))return route('quotes','Product/size/pricing/care inquiry');
 if(/production|cut.{0,15}stitch|queued for/i.test(topic))return route('production','Production-process inquiry');
 return route('other',approval?'Approval-like wording lacks verified current-proof context; review required':'No unambiguous SHUTTLE route; retain for review');
}
