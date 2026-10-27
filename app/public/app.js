import {needsNextProduction} from './expedited-urgency.js';
import {renderControlCenter} from './control-center.js';
import {renderProduction as renderProductionPage} from './production-ui.js';
import {renderMockupBatches} from './mockup-batches-ui.js';
const expandedRunChecklists=new Set();
const deletedRunHistoryKey='shuttle-deleted-error-runs-v1';
function canDeleteRunHistory(run){return ['failed','needs_attention','blocked','interrupted'].includes(run.status)}
function runHistoryStamp(run){return JSON.stringify([run.status,run.finishedAt||null,run.startedAt||null])}
function deletedRunHistory(){try{return JSON.parse(localStorage.getItem(deletedRunHistoryKey)||'{}')}catch{return {}}}
function visibleHistoryRuns(runs=state?.runs||[]){const deleted=deletedRunHistory();return runs.filter(r=>!canDeleteRunHistory(r)||deleted[r.id]!==runHistoryStamp(r))}
function deleteRunHistory(ids){
 const current=(state?.runs||[]).filter(r=>ids.includes(r.id)&&canDeleteRunHistory(r));if(!current.length)return;
 const deleted=deletedRunHistory();for(const r of current)deleted[r.id]=runHistoryStamp(r);
 try{localStorage.setItem(deletedRunHistoryKey,JSON.stringify(deleted))}catch{toast('Could not save history changes. Nothing was deleted.');return}
 for(const r of current){expandedRunChecklists.delete(r.id);runDetailCache.delete(r.id)}
 requestRender();toast(current.length+' error run'+(current.length===1?'':'s')+' removed from this browser’s history. Send and upload receipts are retained.');
}

const loadedClientVersion=new URL(import.meta.url).searchParams.get('v');
let pendingClientVersion=null;
let liveRevision=null,liveConnected=false,refreshInFlight=false,refreshAgain=false,refreshPromise=null;
const runDetailCache=new Map();
function activeView(){const view=location.hash.slice(1)||'home';return names[view]?view:'home'}
function mergeLive(previous,packet){if(packet.full)return packet.full;const next={...previous,...packet.set,results:packet.set?.results?{...packet.set.results,review:previous.results.review}:previous.results};for(const [key,c] of Object.entries(packet.collections||{})){const source=key==='review'?next.results.review:next[key],map=new Map(source.map(i=>[i.id,i]));for(const id of c.remove)map.delete(id);for(const item of c.upsert)map.set(item.id,item);const out=c.order.map(id=>map.get(id));if(key==='review')next.results={...next.results,review:out};else next[key]=out;}return next;}
async function loadRunDetails(run){const cached=runDetailCache.get(run.id);if(cached&&cached.detailVersion===run.detailVersion)return;const response=await api('/api/run-detail?id='+encodeURIComponent(run.id));runDetailCache.set(run.id,{...response.run,detailVersion:run.detailVersion});if(activeView()==='history')requestRender();}

const $=s=>document.querySelector(s);const $$=s=>[...document.querySelectorAll(s)];
let pipelineFilter='all',deferredRender=false,pointerActive=false,pointerReleaseTimer,renderTimer,lastContentVersion='',lastRunVersion='',refreshRequest=0,appliedRefresh=0;
const inputInFlight=new Map(),inputIntentKeys=new Map();
let state,csrf,filter='all',selected=new Set(),busy=false,lastVersion='',dialogContext=null;
const approvalInFlight=new Map(),approvalIntentKeys=new Map();
const displayedReviewItems=new Map();
const emailSavesInFlight=new Set();
const deletionsInFlight=new Set(),deletionIntentKeys=new Map();
function canSelectReview(item){return !deletionsInFlight.has(item.id)&&!emailSavesInFlight.has(item.id)&&!approvalReserved(item.id)&&!reviewInputReserved(item.id)}
function canSaveEmail(item){return canSubmitApproval()&&!emailSavesInFlight.has(item.id)&&!approvalReserved(item.id)&&!reviewInputReserved(item.id)}
const names={mockups:'Mock-ups',home:'Home',agents:'Agents & History',review:'Review queue',oldest:'Orders',calendar:'Production',expedited:'Expedited orders',questions:'Policy questions',history:'Run history'};
function el(tag,cls,text){const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e}
function button(text,cls,fn){const b=el('button',cls,text);b.addEventListener('click',fn);return b}
function toast(message){if($('#detail-dialog').open){let note=$('#dialog-feedback');if(!note){note=el('div','dialog-feedback');note.id='dialog-feedback';note.setAttribute('role','status');($('#dialog-actions').hidden?$('#dialog-content'):$('#dialog-actions')).prepend(note)}note.textContent=message;}$('#toast').textContent=message;$('#toast').hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('#toast').hidden=true,6500)}
function route(){let view=location.hash.slice(1)||'home';if(view==='shipping'){view='calendar';history.replaceState(null,'','#calendar')}if(view==='gallery'){view='calendar';history.replaceState(null,'','#calendar')}if(!names[view])view='home';for(const v of $$('.view'))v.hidden=v.id!=='view-'+view;for(const a of $$('[data-nav]')){a.classList.toggle('active',a.dataset.nav===({expedited:'oldest',questions:'review',history:'agents',shipping:'calendar'}[view]||view));a.setAttribute('aria-current',a.dataset.nav===({expedited:'oldest',questions:'review',history:'agents',shipping:'calendar'}[view]||view)?'page':'false')}$('#breadcrumb-current').textContent=names[view];if(state)requestRender()}
async function api(path,body){const res=await fetch(path,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json','X-Shuttle-Token':csrf}:{},body:body?JSON.stringify(body):undefined});const data=await res.json();if(!res.ok)throw Error(data.error||'Request failed');return data}
function pending(){return (state?.results.review||[]).filter(x=>x.status==='pending'&&!deletionsInFlight.has(x.id)&&!approvalReserved(x.id)&&!reviewInputReserved(x.id))}
function render(){if(!state)return;if(state.expedited?.orders)state.expedited={...state.expedited,orders:state.expedited.orders.filter(row=>row.expeditedActive!==false&&!row.cancelledAt&&!row.canceledAt&&!(String(row.fulfillmentStatus||'').toUpperCase()==='FULFILLED'||(row.expeditedWithdrawal?.verified===true&&Boolean(row.expeditedWithdrawal?.messageId))))};deferredRender=false;const r=state.results;const active=state.runs.find(x=>['queued','running','dispatching'].includes(x.status));const latestWorkflow=visibleHistoryRuns().find(x=>['banda','complete','scan'].includes(x.mode));const blocked=!active&&latestWorkflow&&['needs_attention','failed','interrupted'].includes(latestWorkflow.status)?latestWorkflow:null;const online=state.connection.ready;$('#connection-label').textContent=!online?(state.hosted?'Email / agents offline':'Connection unavailable'):active?'Agent running':blocked?'Last run needs attention':'Ready to run';$('#connection-dot').classList.toggle('offline',!online||!!blocked);$('#footer-status').textContent=r.sourceLabel||'Updated '+new Date(r.updatedAt).toLocaleString();$('#review-count').textContent=pending().length;$('#question-count').textContent=r.questions.filter(x=>x.status==='pending').length;$('#oldest-count').textContent=unfulfilledRows().length;$('#expedited-count').textContent=(state.expedited?.orders||[]).length;$('#mockup-batches-count').textContent=(state.mockupBatches?.batches||[]).flatMap(b=>b.items||[]).filter(i=>!['sent','excluded'].includes(i.status)).length;
for(const b of $$('.run-button'))b.disabled=busy||!online;
const banner=$('#run-banner');banner.hidden=!active&&!blocked&&online&&!state.connection.limitation;banner.classList.toggle('warn',!online||!!blocked);banner.replaceChildren();if(active){banner.append(el('strong','',active.title+' · '+active.status),el('span','',active.progress||'Waiting for the agent. Results will appear here.'))}else if(blocked){banner.append(el('strong','',blocked.title+' · Needs attention'),el('span','',blocked.summary||blocked.progress||'The last run did not finish. Check its history before retrying.'));const historyLink=el('a','secondary','View run history →');historyLink.href='#history';banner.append(historyLink);if(!online)banner.append(el('span','',state.connection.message));}else if(!online){banner.append(el('strong','','Run connection needs attention'),el('span','',state.connection.message));banner.append(button('Use local Codex workers','secondary',()=>action('/api/setup',{backend:'cli'},'Local workers enabled. Choose an agent to run.')))}else if(state.connection.limitation){banner.append(el('strong','','Local workers enabled'),el('span','',state.connection.limitation))}
renderControlCenter(state,api,refresh,toast);const view=activeView();if(view==='home')renderHome();if(view==='mockups')renderMockupBatches(state,api,refresh,toast);if(view==='review')renderReview();if(view==='calendar'){renderCalendar();renderProductionPage(state,api,refresh,toast,'#production-run-content');}if(view==='expedited')renderExpedited();if(view==='questions')renderQuestions();if(view==='history')renderHistory();if(view==='oldest')renderPipeline();renderReceipt();renderLiveRuntime();lastContentVersion=contentVersion(state);lastRunVersion=JSON.stringify(state.runs);}
function updateSelection(){
 for(const id of selected)if(!pending().some(x=>x.id===id&&canSelectReview(x)))selected.delete(id);
 const items=pending().filter(i=>selected.has(i.id)),send=$('#approve-selected'),remove=$('#delete-selected');
 $('#selected-count').textContent=selected.size;$('#selected-count').hidden=!selected.size;
 send.disabled=!items.length||!canSubmitApproval()||items.some(i=>!canApproveItem(i));send.hidden=!items.length;
 send.title=items.some(i=>!canApproveItem(i))?'Finish the selected replies before sending, or delete them from review.':'';
 remove.hidden=!items.length;remove.disabled=!items.length;remove.textContent='Delete selected'+(items.length?' ('+items.length+')':'');
}

function renderReviewCard(item){return compactReviewRow(item)}
function sendReviewSelection(ids){const items=ids.map(id=>displayedReviewItems.get(id));if(items.some(i=>!i)){toast('Refresh the selected emails before sending.');return}return submitApproval(items)}
const expandedReviewRows=new Set();
function compactReviewRow(item,context=null){
 const row=el('article','review-card compact-review-row'+(context?' approval-preview-case':''));row.dataset.reviewCase=item.id;
 row.classList.toggle('is-expanded',expandedReviewRows.has(item.id));
 const chosen=context?context.selectedIds:selected,eligible=canApproveItem(item),check=el('input','compact-select');check.type='checkbox';check.checked=chosen.has(item.id);check.disabled=!canSelectReview(item);
 if(context)check.dataset.dialogSelect=item.id;else check.dataset.reviewSelect=item.id;
 check.setAttribute('aria-label','Select '+reviewCaseName(item));check.title='Select to send or delete from review';
 check.onchange=()=>{check.checked?chosen.add(item.id):chosen.delete(item.id);context?updateDialogControls():syncReviewSelection()};row.append(check);
 const customer=el('section','compact-customer');const identity=el('strong','compact-identity',reviewCaseName(item));
 const confidence=item.draftConfidence,field=emailField(item);
 if(confidence?.level==='high'&&confidence.verified===true&&field&&confidence.reviewedText===item[field]&&confidence.customerQuestion===item.customerQuestion&&confidence.checkedAt&&confidence.evidence?.length){const star=el('span','review-confidence-star',' ★');star.title='High confidence · current draft and customer context checked';star.setAttribute('aria-label','High-confidence draft');identity.append(star)}
 customer.append(identity,el('p','compact-message',item.customerQuestion||'The customer’s exact request still needs to be verified.'));
 const expand=button(expandedReviewRows.has(item.id)?'Collapse':'Expand','text-button compact-expand',()=>{const open=!expandedReviewRows.has(item.id);open?expandedReviewRows.add(item.id):expandedReviewRows.delete(item.id);row.classList.toggle('is-expanded',open);expand.textContent=open?'Collapse':'Expand';expand.setAttribute('aria-expanded',String(open))});expand.setAttribute('aria-label','Expand message and reply for '+reviewCaseName(item));expand.setAttribute('aria-expanded',String(expandedReviewRows.has(item.id)));customer.append(expand);
 const remove=button('Delete','text-button delete-review-item',()=>deleteReviewItems([item]));remove.dataset.deleteReview=item.id;remove.setAttribute('aria-label','Delete from review: '+reviewCaseName(item));remove.title='Remove this inquiry from review. A new customer message may return.';remove.disabled=!canSelectReview(item);customer.append(remove);
 if((item.requiresUpdatedMockup||item.mockupUpdate)&&updatedMockupReady(item)){
  const proofs=el('details','compact-proof');proofs.append(el('summary','',item.mockupUpdate.attachments.length===1?'View attached mock-up':'View '+item.mockupUpdate.attachments.length+' attached mock-ups'),mockupAttachments(item));customer.append(proofs);
 }
 if(item.workflowLabel?.startsWith('Support/'))customer.append(el('small','pill neutral',item.workflowLabel));
 const reply=el('section','compact-reply');if(item.approvalVerification?.status==='pending')reply.append(el('p','draft-notice',item.approvalVerification.summary));if(item.research?.status==='in_progress')reply.append(el('p','draft-notice','Researching · '+item.research.owner));if(emailField(item))reply.append(emailEditor(item,true));else reply.append(el('p','compact-waiting',!updatedMockupReady(item)?'Awaiting updated mock-up':item.replyDisposition?.reason||'Reply awaiting preparation'));
 if(item.draftLink?.note){const note=el('details','source-details');note.append(el('summary','','Related reply'),el('p','draft-notice',item.draftLink.note));reply.append(note);}
 if(item.workspaceDecision?.receivedAt){
  const outcome=item.workspaceDecision,notice=el('div','case-outcome'+(eligible?'':' needs-attention'));
  notice.append(el('strong','',eligible?'Updated after your instructions':'Instructions reviewed · '+(outcome.status==='held'?'Still on hold':'Needs review')));
  if(outcome.detail)notice.append(el('p','',outcome.detail));
  notice.append(el('small','','Reviewed '+new Date(outcome.receivedAt).toLocaleString()));reply.append(notice);
 }
 if(reviewNotes(item)||!eligible){
  const source=inputSource('review',item.id),detail=el('details','compact-hold');detail.append(el('summary','',!updatedMockupReady(item)?'Artwork status':item.replyDisposition?'Details':'Case notes'));
  detail.append(el('p','stale-note',(item.blockers||[]).join(' · ')||item.replyDisposition?.reason||'No additional case notes.'));if(source)detail.append(redraftAction(item,source));reply.append(detail);
 }
 row.append(customer,reply);row.classList.toggle('selected',chosen.has(item.id));return row;
}
function compactColumnLabels(){const row=el('div','compact-column-labels');row.append(el('span','',''),el('span','','Customer message'),el('span','','Reply'));return row}

function showDialog(title,children,context=null,actions=[]){const feedback=context&&dialogContext===context?$('#dialog-feedback')?.textContent:null;dialogContext=context;$('#detail-dialog').classList.toggle('review-dialog',context?.kind==='review');$('#dialog-title').textContent=title;$('#dialog-content').replaceChildren(...children);$('#dialog-actions').replaceChildren(...actions);$('#dialog-actions').hidden=!actions.length;if(feedback){const note=el('div','dialog-feedback',feedback);note.id='dialog-feedback';note.setAttribute('role','status');(actions.length?$('#dialog-actions'):$('#dialog-content')).prepend(note)}if(!$('#detail-dialog').open)$('#detail-dialog').showModal()}
function safeImage(src){return typeof src==='string'&&/^\/assets\/[a-zA-Z0-9_.-]+$/.test(src)?src:''}
function showImage(item){const image=el('img');image.src=safeImage(item.image);image.alt=item.title||`Order ${item.order}`;let content=image;if(item.before){content=el('div','preview-pair');for(const [label,src] of [['Before',item.before],['After',item.image]]){const fig=el('figure'),img=el('img');img.src=safeImage(src);img.alt=label+' order '+item.order;fig.append(el('figcaption','',label),img);content.append(fig)}}const draft=item.reviewId?pending().find(r=>r.id===item.reviewId):item;const parts=[content];if(item.description||item.type==='approval')parts.push(el('p','dialog-caption',item.description||item.body));if(draft&&emailField(draft))parts.push(emailEditor(draft));showDialog(`#${item.order} · ${item.title}`,parts,{kind:'image',item})}
function pendingQuestions(){return state?.results.questions.filter(q=>q.status==='pending'&&!inputReserved('questions',q.id))||[]}
function enteredAnswers(){return [...$('#questions-list').querySelectorAll('textarea')].filter(input=>input.value.trim()).map(input=>{const question=pendingQuestions().find(q=>q.id===input.dataset.id);const card=input.closest('.question-card');return question?{id:question.id,question:question.title,detail:question.detail,answer:input.value.trim(),savePolicy:card.querySelector('input[type=checkbox]').checked}:null}).filter(Boolean)}
function updateAnswerBatch(){const count=enteredAnswers().length,total=pendingQuestions().length;$('#answer-count').textContent=count;$('#answer-batch-count').textContent=count+' of '+total+' questions answered';const active=state?.runs.some(r=>['queued','running','dispatching'].includes(r.status));$('#send-all-answers').disabled=!count||busy||!state?.connection.ready;for(const button of $$('.send-one-answer'))button.disabled=busy||!state?.connection.ready||!button.closest('.question-card').querySelector('textarea').value.trim();const run=state?.runs.find(r=>['answer','answers'].includes(r.mode));const status=$('#answer-batch-status');const saved=state?.results.policyReview;const useSaved=saved&&(!run||(!['queued','running','dispatching'].includes(run.status)&&Date.parse(saved.at)>Date.parse(run.createdAt)));status.hidden=!run&&!useSaved;if(useSaved){status.classList.remove('warn');status.replaceChildren(el('strong','','Policies saved'),el('span','',saved.summary))}else if(run){status.classList.toggle('warn',run.status==='failed');status.replaceChildren(el('strong','',run.title+' · '+run.status),el('span','',run.summary||run.progress||'Waiting for review.'))}}
function renderQuestions(){const container=$('#questions-list');const values=new Map([...container.querySelectorAll('textarea')].map(e=>[e.dataset.id,e.value]));const checks=new Map([...container.querySelectorAll('input')].map(e=>[e.dataset.id,e.checked]));for(const q of state.results.questions.filter(q=>q.status==='answered')){localStorage.removeItem('shuttle-answer-'+q.id);localStorage.removeItem('shuttle-policy-'+q.id)}container.replaceChildren(...pendingQuestions().map((q,index)=>{const card=el('article','question-card');card.append(el('span','pill neutral','POLICY '+String(index+1).padStart(2,'0')),el('h3','',q.title),el('p','',q.detail));card.querySelector('h3').style.marginTop='14px';const input=el('textarea');input.dataset.id=q.id;input.placeholder='Your answer…';input.setAttribute('aria-label',q.title);input.maxLength=6000;input.value=values.has(q.id)?values.get(q.id):localStorage.getItem('shuttle-answer-'+q.id)||'';input.oninput=()=>{localStorage.setItem('shuttle-answer-'+q.id,input.value);updateAnswerBatch()};card.append(input);const bottom=el('div','question-bottom'),label=el('label'),check=el('input');check.type='checkbox';check.dataset.id=q.id;const stored=localStorage.getItem('shuttle-policy-'+q.id);check.checked=checks.has(q.id)?checks.get(q.id):stored===null?true:stored==='true';check.onchange=()=>{localStorage.setItem('shuttle-policy-'+q.id,String(check.checked));updateAnswerBatch()};label.append(check,document.createTextNode('Save as policy'));const send=button('Submit answer','secondary send-one-answer',()=>{const answer=enteredAnswers().find(a=>a.id===q.id);if(answer)submitInput('/api/answers',{answers:[answer]},[{category:'questions',id:answer.id}],'Answer submitted.');});send.setAttribute('aria-label','Send answer for '+q.title);bottom.append(label,send);card.append(bottom);return card}));if(!container.childElementCount)container.append(el('div','empty','No policy questions waiting.'));updateAnswerBatch()}
function runStatusPresentation(status){
 if(['needs_attention','review'].includes(status))return {label:'Needs you',color:'needs-you'};
 if(status==='queued')return {label:'Queued',color:'queued'};
 if(['running','dispatching','yielded'].includes(status))return {label:'Running',color:'running'};
 if(['completed','recovered'].includes(status))return {label:'Completed',color:'completed'};
 if(['failed','interrupted'].includes(status))return {label:'Failed',color:'failed'};
 return {label:status==='cancelled'?'Cancelled':status,color:'neutral'};
}
function redraftAction(item,source){
 const wrap=el('div','redraft-action'),notes=(item.blockers||[]).join(' · ')||item.nextAction||item.replyDisposition?.reason||'Recheck the conversation and update the reply.';
 const key='shuttle-redraft-correction-'+item.id,input=el('textarea','instruction-input');input.rows=2;input.maxLength=3500;input.placeholder='Case notes incorrect? Explain what should change (optional).';input.setAttribute('aria-label','Correct case notes for '+reviewCaseName(item));input.value=stored(key)?.text||'';input.oninput=()=>put(key,{text:input.value});
 const go=button('Redraft from case notes','secondary',async()=>{
  if(inputReserved('review',item.id))return;
  const correction=input.value.trim(),current=inputSource('review',item.id);if(!current||current.version!==source.version){toast('This case changed. Refresh before redrafting.');return;}
  const decision={category:'review',id:source.id,version:source.version,savePolicy:false,answer:'REDRAFT ONLY: Research current customer-specific conversations and update this same editable reply for review. Do not send an email or release production. Preserve my wording and tone where still accurate. Verify case notes rather than treating them as facts. Suggested next action: '+notes.slice(0,1800)+(correction?'\nMy correction: '+correction:'')};
  if(emailField(item)){const draft=emailDraft(item);if(draft.version!==item.version){toast('Review your saved edits against the latest draft first.');return;}decision.emailText=draft.text;}
  go.disabled=true;try{await submitInput('/api/decisions',{decisions:[decision]},[{category:'review',id:source.id}],'Redraft queued for review.',()=>{localStorage.removeItem(key);});}finally{go.disabled=!canSubmitApproval()||inputReserved('review',item.id);}
 });go.disabled=!canSubmitApproval()||inputReserved('review',item.id);wrap.append(go,input);return wrap;
}
const expandedHistorySections=new Set();
function historyBucket(run){if(['running','dispatching'].includes(run.status))return 'running';if(run.status==='queued')return 'queued';if(run.status==='paused')return 'paused';if(['failed','needs_attention','blocked','interrupted'].includes(run.status))return 'attention';return 'finished'}
function historyEstimate(run,runs,now=Date.now()){
 if(!['running','dispatching'].includes(run.status))return null;
 const start=Date.parse(run.startedAt||run.receivedAt);if(!Number.isFinite(start))return null;
 const size=run.payload?.items?.length;
 const samples=runs.filter(r=>r.id!==run.id&&r.mode===run.mode&&r.status==='completed'&&!r.pauseRequestedAt&&!r.resumedAt&&Date.parse(r.finishedAt)>now-7*86400000&&(!size||Math.abs((r.payload?.items?.length||0)-size)<=Math.max(1,size*.2))).map(r=>Date.parse(r.finishedAt)-Date.parse(r.startedAt||r.receivedAt)).filter(n=>n>0).sort((a,b)=>a-b);
 if(samples.length<3)return null;
 const low=samples[Math.floor((samples.length-1)*.25)],high=samples[Math.ceil((samples.length-1)*.75)],elapsed=now-start;
 if(elapsed>=high)return {text:'Longer than recent runs',detail:'Still processing. No reliable finish estimate.',samples:samples.length};
 return {text:`~${Math.max(1,Math.ceil((low-elapsed)/60000))}–${Math.max(1,Math.ceil((high-elapsed)/60000))} min remaining`,detail:`Estimate from ${samples.length} comparable completed runs in the last 7 days; excludes queue time.`,samples:samples.length};
}
function historyOverview(runs){const box=el('div','history-overview');for(const [key,label,icon] of [['running','Running','●'],['queued','Queued','◷'],['paused','Paused','Ⅱ'],['attention','Needs attention','!']]){const count=runs.filter(r=>historyBucket(r)===key).length,b=button('','history-stat '+key,()=>document.getElementById('history-'+key)?.scrollIntoView({behavior:'smooth',block:'start'}));b.append(el('span','history-stat-icon',icon),el('strong','',String(count)),el('span','',label));b.setAttribute('aria-label',`${label}: ${count} runs`);box.append(b)}return box}
function historyTiming(run){const box=el('div','history-timing');box.append(runtimeClock(run));if(run.timings?.queueMs!=null)box.append(el('span','history-updated','Queue wait '+Math.round(run.timings.queueMs/1000)+'s'));if(run.timings?.preparationMs!=null)box.append(el('span','history-updated','Preparation '+(run.timings.preparationMs/1000).toFixed(1)+'s'));if(['running','dispatching','paused'].includes(run.status)&&run.createdAt){const age=el('span','history-updated');age.dataset.runAgeId=run.id;box.append(age)}if(['running','dispatching'].includes(run.status)){const eta=el('span','history-eta');eta.dataset.estimateId=run.id;box.append(eta);const updated=run.progressAt||run.receivedAt;if(updated)box.append(el('span','history-updated','Updated '+new Date(updated).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})))}return box}
function updateHistoryEstimates(){for(const node of $$('[data-run-age-id]')){const r=state?.runs.find(x=>x.id===node.dataset.runAgeId);if(r)node.textContent='Since submitted '+elapsedText(r.createdAt)}for(const node of $$('[data-estimate-id]')){const run=state?.runs.find(r=>r.id===node.dataset.estimateId);if(!run)continue;const estimate=historyEstimate(run,state.runs);node.textContent=estimate?.text||'Finish estimate unavailable';node.title=estimate?.detail||'Not enough comparable completed runs to estimate safely.'}}

function renderHistory(){const historyRuns=visibleHistoryRuns();const list=$('#history-list');list.replaceChildren(historyOverview(historyRuns));const removable=historyRuns.filter(canDeleteRunHistory);if(removable.length){const bar=el('div','review-toolbar');bar.append(button('Delete all error runs ('+removable.length+')','secondary',()=>deleteRunHistory(removable.map(r=>r.id))));list.append(bar);}const historySections=new Map();for(const [key,label] of [['running','Running now'],['queued','Queued'],['paused','Paused'],['attention','Needs attention'],['finished','Finished']]){const count=historyRuns.filter(r=>historyBucket(r)===key).length;const section=el(key==='finished'?'details':'section','history-section '+key);section.id='history-'+key;if(key==='finished'){section.open=expandedHistorySections.has(key);section.ontoggle=()=>{section.open?expandedHistorySections.add(key):expandedHistorySections.delete(key)}}section.append(el(key==='finished'?'summary':'h2','history-section-heading',label+' · '+count));if(!count&&key==='running')section.append(el('p','empty','No run is active right now.'));if(count||key==='running')list.append(section);historySections.set(key,section)}const historyCards=historyRuns.map(summaryRun=>{const cached=runDetailCache.get(summaryRun.id);const run=cached&&cached.detailVersion===summaryRun.detailVersion?{...summaryRun,checklist:cached.checklist}:summaryRun;const card=el('article','history-card'),head=el('div','history-head'),d=el('div');card.dataset.runId=run.id;card.classList.add('history-'+historyBucket(run)+'-card');d.append(el('h3','',run.title),el('time','',new Date(run.createdAt).toLocaleString()));head.append(d,el('span','pill status-'+runStatusPresentation(run.status).color,runStatusPresentation(run.status).label));card.append(head,historyTiming(run));const progressText=run.progress||'Waiting for a worker update.';card.append(el('p','history-current-step',progressText.length>260?progressText.slice(0,257)+'…':progressText));if(progressText.length>260){const more=el('details','history-full-update');more.append(el('summary','','Full status update'),el('p','history-current-step',progressText));card.append(more)}const approvalStatus=approvalHandoffReport(run,state);if(approvalStatus){const box=el('details','approval-run-status');box.append(el('summary','','Automatic flat approvals · '+approvalStatus.items.length),el('p','',approvalStatus.reason));for(const item of approvalStatus.items)box.append(el('p','dialog-caption','#'+item.order+' · '+item.reason));card.append(box);}card.append(runProgressBar(run));if(['queued','running','dispatching','paused'].includes(run.status)){const control=button(run.status==='paused'?'Resume':run.pauseRequestedAt?'Pausing…':'Pause','secondary',()=>action('/api/run-control',{id:run.id,action:run.status==='paused'?'resume':'pause'},run.status==='paused'?'Resume queued.':'Pause requested at the next safe checkpoint.'));control.disabled=Boolean(run.pauseRequestedAt)&&run.status!=='paused';card.append(control);}if(run.receivedAt)card.append(el('p','receipt-time','Received by SHUTTLE · '+new Date(run.receivedAt).toLocaleString()));const steps=run.checklist||[];const details=el('details','run-checklist');details.open=expandedRunChecklists.has(run.id);details.ontoggle=()=>{details.open?expandedRunChecklists.add(run.id):expandedRunChecklists.delete(run.id);if(details.open&&!run.checklist)loadRunDetails(run).catch(e=>toast(e.message))};if(details.open&&!run.checklist)queueMicrotask(()=>loadRunDetails(run).catch(e=>toast(e.message)));details.append(el('summary','',`Steps · ${run.checklistSummary?.passed??steps.filter(s=>s.passed).length}/${run.checklistSummary?.total??steps.length} verified`));const stepsList=el('ul','run-step-list');for(const step of steps){const stepState=step.state||(step.passed?'passed':['queued','running','dispatching','paused'].includes(run.status)?'pending':'unknown');const li=el('li','run-step '+stepState);li.append(el('span','run-step-icon',({passed:'✓',failed:'✕',running:'◉',pending:'○',unknown:'?',skipped:'–'})[stepState]||'?'),el('strong','',step.label+(Number.isFinite(step.durationMs)?' · '+Math.floor(step.durationMs/60000)+'m '+Math.floor(step.durationMs%60000/1000)+'s':'')));if(!step.passed)li.append(el('p','run-step-reason',step.reason||'Completion not verified.'));stepsList.append(li)}details.append(stepsList);card.append(details);if(run.summary&&run.summary!==run.progress){const report=el('details','history-full-update');report.append(el('summary','','Run report'),el('p','history-current-step',run.summary));card.append(report)}if(run.mode==='mockup'&&run.status==='failed'&&run.canResumeDryRun!==false){const resume=button('Continue interrupted dry run','secondary',()=>action('/api/resume',{id:run.id},'Read-only recovery queued.'));resume.disabled=!canRun();card.append(resume);}if(run.mode==='banda'&&run.status==='needs_attention'){const resume=button('Continue unfinished Banda run','secondary',()=>action('/api/resume',{id:run.id},'Continuing the same Banda run from its saved progress.'));resume.disabled=!canRun();card.append(resume);}if(run.status==='queued'){const cancel=button(cancellingRuns.has(run.id)?'Cancelling…':'Cancel queued request','secondary',()=>cancelQueuedRun(run.id));cancel.disabled=cancellingRuns.has(run.id);card.append(cancel);}if(canDeleteRunHistory(run)){const remove=button('','history-trash',()=>deleteRunHistory([run.id]));remove.setAttribute('aria-label','Delete '+run.title+' from history');remove.title='Delete from history';remove.innerHTML='<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M9 6V4h6v2M5 6l1 14h12l1-14M10 10v6M14 10v6"/></svg>';card.classList.add('has-history-trash');card.append(remove);}return card});historyRuns.forEach((run,index)=>historySections.get(historyBucket(run)).append(historyCards[index]));for(const job of state.specialistJobs||[]){const card=el('article','history-card');card.append(el('h3','',job.target.name+' · '+job.caseCount+' cases'),el('span','pill neutral',job.status.replaceAll('_',' ')),el('p','dialog-caption',job.orders.map(n=>'#'+n).join(', ')));list.append(card);}if(!historyRuns.length)list.append(el('div','empty','No runs yet.'));if(state.results.alerts.length){const heading=el('h2','','Operational alerts');heading.style.margin='30px 0 18px';list.append(heading,decisionBar('alerts'));for(const a of state.results.alerts){const card=el('article','history-card');card.append(el('span','pill amber',a.status==='resolved'?'RESOLVED':'NEEDS LUKAS'),el('h3','',`#${a.order} · ${a.title}`),el('p','',a.detail));card.querySelector('h3').style.marginTop='14px';const source=inputSource('alerts',a.id||a.order);if(source)card.append(decisionEditor(source));list.append(card)}}updateDecisionButtons();updateRuntimeClocks();}
function confirmApproval(items,groupTitle,context=null){
 if(!items.length&&!context)return;
 context=context||{kind:'review',ids:items.map(i=>i.id),groupTitle,groupId:RESPONSE_GROUPS.find(([,title])=>title===groupTitle)?.[0],selectedIds:new Set(items.filter(i=>canSelectReview(i)&&selected.has(i.id)).map(i=>i.id))};
 const ready=items.filter(canSelectReview);
 if(!ready.length)delete context.updateNote;
 for(const id of context.selectedIds)if(!ready.some(i=>i.id===id))context.selectedIds.delete(id);
 const list=el('div','compact-review-list');
 if(context.updateNote){const note=el('p','dialog-live-update',context.updateNote);note.setAttribute('role','status');list.append(note)}
 for(const group of groupReviewItems(items)){
  const section=el('section','compact-category'),head=el('div','compact-category-heading'),label=el('label','dialog-select-all'),all=el('input');all.type='checkbox';all.dataset.dialogGroup=group.id;all.setAttribute('aria-label','Select all in '+group.title);
  const eligible=group.items.filter(canSelectReview);all.disabled=!eligible.length;all.onchange=()=>{for(const i of group.items.filter(canSelectReview))all.checked?context.selectedIds.add(i.id):context.selectedIds.delete(i.id);updateDialogControls()};label.append(all,document.createTextNode('Select all'));
  head.append(el('h3','',group.title),label);section.append(head,compactColumnLabels(),...group.items.map(i=>compactReviewRow(i,context)));list.append(section);
 }
 if(!items.length){const empty=el('div','review-dialog-empty');empty.append(el('strong','','No reviews left in this group'),el('p','','You can continue with another category.'));list.append(empty)}
 const selection=el('div','dialog-selection');selection.append(el('strong','dialog-selection-count',''),el('small','dialog-selection-note',''));
 const actions=el('div','dialog-submit-actions');actions.append(button('Back to categories','text-button',()=>$('#detail-dialog').close()));
 const save=button('Save edits','secondary save-dialog-emails',()=>saveEmails(items.filter(emailDirty)));save.dataset.emailIds=JSON.stringify(items.map(i=>i.id));actions.append(save);
 const remove=button('Delete selected','secondary delete-dialog-selection',()=>deleteReviewItems(pending().filter(i=>context.selectedIds.has(i.id))));actions.append(remove);
 const send=button('Send','primary approve-dialog-selection',()=>submitApproval(items.filter(i=>canApproveItem(i)&&context.selectedIds.has(i.id)),{keepReviewOpen:true}));send.dataset.reviewIds=JSON.stringify(items.map(i=>({id:i.id,version:i.version})));actions.append(send);
 showDialog(groupTitle||'Review emails',[list],context,[selection,actions]);updateDecisionButtons();updateReviewControls();
}
function updateDialogControls(){
 if(dialogContext?.kind!=='review'||!$('#detail-dialog').open)return;
 const chosen=dialogContext.selectedIds,items=pending(),boxes=$$('[data-dialog-select]');
 for(const check of boxes){const item=items.find(i=>i.id===check.dataset.dialogSelect);check.disabled=!item||!canSelectReview(item);if(check.disabled)chosen.delete(check.dataset.dialogSelect);check.checked=chosen.has(check.dataset.dialogSelect);check.closest('.compact-review-row').classList.toggle('selected',check.checked)}
 for(const all of $$('[data-dialog-group]')){
  const eligible=boxes.filter(b=>!b.disabled&&items.some(i=>i.id===b.dataset.dialogSelect&&responseGroupId(i)===all.dataset.dialogGroup)),count=eligible.filter(b=>b.checked).length;
  all.disabled=!eligible.length;all.checked=!!eligible.length&&count===eligible.length;all.indeterminate=count>0&&count<eligible.length;
 }
 const count=boxes.filter(b=>!b.disabled&&b.checked).length;$('.dialog-selection-count').textContent=count?count+' selected':'Select emails to send or delete';$('.dialog-selection-note').textContent=count?'Delete removes the inquiry from review; new customer messages can return.':'';
 const remove=$('.delete-dialog-selection');remove.hidden=!count;remove.disabled=!count;remove.textContent='Delete selected ('+count+')';
 const send=$('.approve-dialog-selection'),snapshots=JSON.parse(send.dataset.reviewIds),selectedSnapshots=snapshots.filter(s=>chosen.has(s.id));send.hidden=!selectedSnapshots.length;send.textContent='Send';send.disabled=!canSubmitApproval()||!selectedSnapshots.length||selectedSnapshots.some(s=>!items.some(i=>i.id===s.id&&i.version===s.version&&canApproveItem(i)));
}

const cancellingRuns=new Set();
async function cancelQueuedRun(id){
 if(cancellingRuns.has(id))return;
 cancellingRuns.add(id);renderHistory();
 try{
  // Recover current token/status after reconnect, including a stale queued card.
  await refresh(true);
  const current=state.runs.find(r=>r.id===id);
  if(!current||current.status!=='queued'){toast(current?.status==='cancelled'?'Request already cancelled.':'This request is '+(current?.status||'no longer available')+'. The run history has been refreshed.');return;}
  const result=await api('/api/cancel',{id});
  if(result.run){state.runs=state.runs.map(r=>r.id===id?{...r,...result.run}:r);renderHistory();}
  toast(result.cleanupError?'Cancelled. '+result.cleanupError:'Queued request cancelled.');
 }catch(e){toast(e.message)}finally{cancellingRuns.delete(id);await refresh(true);renderHistory();}
}

async function action(path,body,message,onSuccess){if(busy)return null;busy=true;try{const result=await api(path,body);onSuccess?.(result);toast(message);await refresh(true);return result}catch(e){toast(e.message);return null}finally{busy=false;render()}}
function contentVersion(s){return localToday()+'|'+JSON.stringify([s.productionShipping,s.lukasTodos,s.mockupBatches,s.results,s.pipeline,s.unfulfilled,s.orderControls,s.specialistJobs,s.productionArchive,s.expedited,s.schedule,s.workspaceInputs,s.receiptConfirmation,s.connection.ready,(s.approvalQueue||[]).map(q=>q.reviewIds),(s.inputQueue||[]).map(q=>q.sources),s.runs.some(r=>['queued','running','dispatching'].includes(r.status))])}
function interactionInProgress(){return pointerActive}
function viewElementKey(e){
 const scope=e.closest('[data-run-id]')?.dataset.runId||e.closest('[data-review-case]')?.dataset.reviewCase||e.closest('[data-group-id]')?.dataset.groupId||e.closest('.view')?.id||'';
 return [scope,e.tagName,e.id,e.dataset.emailId,e.dataset.id,e.dataset.sourceId,e.dataset.dialogSelect,e.dataset.reviewSelect,e.dataset.dialogGroup,e.getAttribute('aria-label'),e.tagName==='DETAILS'?e.querySelector('summary')?.textContent:''].join('|');
}
function captureView(root){
 const active=document.activeElement,focused=root.contains(active),key=focused?viewElementKey(active):null;
 const selection=focused&&active.tagName==='TEXTAREA'?[active.selectionStart,active.selectionEnd,active.selectionDirection]:null;
 const details=new Map([...root.querySelectorAll('details')].map(e=>[viewElementKey(e),e.open]));
 const editorScroll=new Map([...root.querySelectorAll('textarea')].map(e=>[viewElementKey(e),e.scrollTop]));
 const scrolls=[root,...root.querySelectorAll('.view,#dialog-content')].map(e=>[e,e.scrollTop]);
 return ()=>{
  for(const e of root.querySelectorAll('details'))if(details.has(viewElementKey(e)))e.open=details.get(viewElementKey(e));
  if(focused){const next=[...root.querySelectorAll('textarea,input,button,summary,a')].find(e=>viewElementKey(e)===key);if(next){next.focus({preventScroll:true});if(selection&&next.tagName==='TEXTAREA')next.setSelectionRange(...selection)}else if(root.id==='detail-dialog')$('#close-dialog').focus({preventScroll:true})}
  for(const e of root.querySelectorAll('textarea'))e.scrollTop=editorScroll.get(viewElementKey(e))||0;
  for(const [e,top] of scrolls)e.scrollTop=top;
 };
}
function renderPreservingInteraction(){
 const restore=captureView($('main')),scrollX=window.scrollX,scrollY=window.scrollY;
 render();restore();refreshReviewDialog(dialogContext);window.scrollTo(scrollX,scrollY);
}
function requestRender(){if(interactionInProgress()){deferredRender=true;return}renderPreservingInteraction()}
function flushDeferredRender(){clearTimeout(renderTimer);renderTimer=setTimeout(()=>{if(deferredRender&&!interactionInProgress())requestRender()},100)}
function clearChangedSelections(next){
 const previous=new Map((state?.results.review||[]).map(i=>[i.id,i.version])),changed=new Set(next.results.review.filter(i=>previous.has(i.id)&&previous.get(i.id)!==i.version).map(i=>i.id));
 let count=0;for(const id of changed){selected.delete(id);if(dialogContext?.selectedIds?.delete(id))count++}
 if(count)dialogContext.updateNote=count+' selected '+(count===1?'reply changed. Review it':'replies changed. Review them')+' and select again before sending.';
}
async function refresh(force=false){
 // A save must await a request started AFTER its write, not an older live poll.
 if(refreshInFlight){
  if(!force){refreshAgain=true;return refreshPromise;}
  await refreshPromise;
  return refresh(true);
 }
 refreshInFlight=true;
 refreshPromise=(async()=>{try{await refreshOnce(force)}finally{refreshInFlight=false;}})();
 try{await refreshPromise;}finally{if(refreshAgain){refreshAgain=false;queueMicrotask(()=>refresh());}}
}
async function refreshOnce(force=false){
 const request=++refreshRequest;
 let next;
 try{const packet=await api('/api/live'+(liveRevision?'?since='+encodeURIComponent(liveRevision):''));liveRevision=packet.revision;if(packet.unchanged){renderLiveRuntime();if(force)requestRender();return}next=mergeLive(state,packet)}catch(e){liveRevision=null;if(request<appliedRefresh)return;$('#connection-label').textContent='Server disconnected';$('#connection-dot').classList.add('offline');if(state)state.connection.ready=false;renderLiveRuntime();for(const b of $$('.run-button'))b.disabled=true;updateReviewControls();updateDecisionButtons();updateAnswerBatch();if(force)toast('The local server is offline. Open Launch SHUTTLE.command to reconnect.');return}
 if(request<appliedRefresh)return;appliedRefresh=request;csrf=next.token;clearChangedSelections(next);state=next;
 if(next.clientVersion&&loadedClientVersion!==next.clientVersion)offerClientUpdate(next.clientVersion);
 try{
  renderLiveRuntime();renderReconciliationStatus();renderApprovalQueue();renderLatestSubmission();updateReviewControls();updateDecisionButtons();updateAnswerBatch();
  const changed=contentVersion(next)!==lastContentVersion;
  if(force||changed)requestRender();
  else if(activeView()==='history'&&JSON.stringify(next.runs)!==lastRunVersion&&!interactionInProgress()){renderHistory();lastRunVersion=JSON.stringify(next.runs)}
 }catch(e){console.error('SHUTTLE result display failed',e);toast('Connected, but the result display could not refresh. Your edits are saved; use Refresh results to retry.')}
}

for(const b of $$('.run-button'))b.onclick=()=>runAgent(b.dataset.run);$('#approve-selected').onclick=()=>sendReviewSelection([...selected]);$('#search').oninput=renderReview;for(const b of $$('#review-filters button'))b.onclick=()=>{filter=b.dataset.filter;for(const t of $$('#review-filters button'))t.classList.toggle('active',t===b);renderReview()};$('#refresh').onclick=()=>refresh(true);$('#close-dialog').onclick=()=>$('#detail-dialog').close();$('#detail-dialog').addEventListener('close',()=>{dialogContext=null;flushDeferredRender()});window.addEventListener('hashchange',route);document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh()});route();refresh();setInterval(()=>{if(!document.hidden&&!liveConnected)refresh()},15000);

function pipelineAge(date){if(!date)return '—';const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());const days=Math.max(0,Math.floor((Date.parse(today+'T00:00:00Z')-Date.parse(date.slice(0,10)+'T00:00:00Z'))/86400000));return Number.isFinite(days)?days+'d':'—'}
function pipelineDetails(row){const content=el('div');const fields=[['Current workflow',row.workflow],['Financial / fulfillment',[row.financialStatus,row.fulfillmentStatus].filter(Boolean).join(' / ')],['Why it is unfulfilled',row.reason],['Blocker',row.blocker],['Next step',row.nextAction],['Last meaningful message',row.lastMessage],['Production artwork',row.drive]];for(const [label,value] of fields){if(!value)continue;content.append(el('h3','pipeline-detail-label',label),el('p','dialog-caption',value))}if(row.details?.length){const d=el('details','pipeline-coverage');d.append(el('summary','','Full saved notes'));const list=el('ul');for(const line of row.details)list.append(el('li','dialog-caption',line));d.append(list);content.append(d)}const source=inputSource('oldest',row.order);if(source)content.append(decisionEditor(source));showDialog('#'+row.order+' · '+row.customer,[content])}
function renderPipeline(){if(state)renderUnfulfilled()}
$('#refresh-orders').addEventListener('click',()=>action('/api/run',{mode:'mockup'},'Reconciliation queued. Open the status icon for progress.'));$('#pipeline-search').oninput=renderPipeline;for(const b of $$('#pipeline-filters button'))b.onclick=()=>{pipelineFilter=b.dataset.filter;for(const tab of $$('#pipeline-filters button'))tab.classList.toggle('active',tab===b);renderPipeline()};
api('/api/state').then(s=>{if(s.hosted?.transport==='poll'){$('#pipeline-live-status').textContent='Checking for updates every 15s';return;}const events=new EventSource('/api/events');events.onopen=()=>{liveConnected=true;$('#pipeline-live-status').textContent='Live updates connected';$('#pipeline-live-dot').classList.remove('offline');refresh()};events.onmessage=()=>refresh();events.onerror=()=>{liveConnected=false;$('#pipeline-live-status').textContent='Reconnecting · checking every 15s';$('#pipeline-live-dot').classList.add('offline')};}).catch(()=>{});

$('#send-all-answers').onclick=()=>{const answers=enteredAnswers();if(answers.length)submitInput('/api/answers',{answers},answers.map(a=>({category:'questions',id:a.id})),answers.length+' answers queued together for review.');};

// Never replace a button between pointerdown, input blur, and its click.
document.addEventListener('pointerdown',()=>{pointerActive=true;clearTimeout(pointerReleaseTimer);clearTimeout(renderTimer)},true);
for(const event of ['pointerup','pointercancel'])document.addEventListener(event,()=>{clearTimeout(pointerReleaseTimer);pointerReleaseTimer=setTimeout(()=>{pointerActive=false;flushDeferredRender()},120)},true);
document.addEventListener('focusout',flushDeferredRender);
window.addEventListener('blur',()=>{pointerActive=false;flushDeferredRender()});


// Unsent text is kept per case and source version, including across refreshes.
const gallerySelected=new Set(),expeditedSelected=new Set(),fulfillmentSelected=new Set();
function canRun(){return !!state?.connection.ready&&!busy}
function stored(key){try{return JSON.parse(localStorage.getItem(key))}catch{return null}}
function put(key,value){try{localStorage.setItem(key,JSON.stringify(value))}catch{toast('Browser storage is full. Save email changes before leaving this page.')}}
function emailField(item){return item.type==='reply'&&typeof item.body==='string'?'body':typeof item.emailBody==='string'?'emailBody':null}
function editKey(item){return 'shuttle-email-'+item.id}
function emailDraft(item){const field=emailField(item),draft=stored(editKey(item));return draft?.text===item[field]?{...draft,version:item.version}:draft||{version:item.version,text:item[field]}}
function emailDirty(item){const field=emailField(item);return field&&emailDraft(item).text!==item[field]}
function updatedMockupReady(item){
 if(item.requiresUpdatedMockup!==true&&item.mockupUpdate===undefined&&item.draftPreparation?.status!=='awaiting_mockup')return true;
 const m=item.mockupUpdate;
 return !!m&&m.status==='verified'&&m.changesVerified===true&&Number.isFinite(Date.parse(m.verifiedAt))&&Array.isArray(m.requestMessageIds)&&m.requestMessageIds.length>0&&m.requestMessageIds.every(id=>typeof id==='string'&&id.trim())&&Array.isArray(m.requestedChanges)&&m.requestedChanges.length>0&&m.requestedChanges.every(change=>typeof change==='string'&&change.trim())&&Number.isInteger(m.expectedAttachments)&&m.expectedAttachments>0&&Array.isArray(m.attachments)&&m.attachments.length===m.expectedAttachments&&new Set(m.attachments.map(a=>a?.path)).size===m.expectedAttachments&&m.attachments.every(a=>a&&typeof a.filename==='string'&&a.filename.trim()&&typeof a.path==='string'&&a.path.startsWith('/')&&/^[a-f0-9]{64}$/i.test(a.sha256||'')&&/^\/assets\/[a-zA-Z0-9_.-]+\.(png|jpg|svg)$/.test(a.preview||''));
}
function validReplyRoute(route){
 if(route===undefined)return true; // Legacy previews still require the worker's fresh routing audit.
 if(!route||!['order_mockup','general_inquiry'].includes(route.kind)||route.answerState!=='needs_reply'||!Number.isFinite(Date.parse(route.verifiedAt)))return false;
 if(typeof route.targetThreadId!=='string'||!route.targetThreadId.trim()||typeof route.to!=='string'||!route.to.trim())return false;
 return route.kind!=='order_mockup'||route.mockupThreadId===route.targetThreadId;
}
function canApproveItem(item){
 const field=emailField(item);if(!field)return false;
 const draft=emailDraft(item);
 return typeof draft.text==='string'&&!!draft.text.trim()&&draft.version===item.version&&!/\[(?:VERIFY|DECISION|ATTACH|QUOTE):/i.test(draft.text)&&!item.replyDisposition&&!['already_answered','sent'].includes(item.replyRoute?.answerState);
}
function reviewNotes(item){return item.requiresInput===true||item.sendBlocked===true||item.type==='hold'||item.draftPreparation?.status==='working_draft'||!!item.blockers?.length||!updatedMockupReady(item)}
function isFlat(item){return canApproveItem(item)&&item.type==='approval'&&item.batchEligible===true&&item.requiresInput===false&&!(item.blockers||[]).length}
function reviewPayload(item){const payload={id:item.id,version:item.version};if(emailField(item)){const draft=emailDraft(item);if(draft.version!==item.version)throw Error('The preview for #'+item.order+' changed. Compare it with your saved edit first.');if(!draft.text.trim())throw Error('Enter email text for #'+item.order+'.');payload.text=draft.text}return payload}
function clearSubmittedEdits(items,payload){items.forEach((item,index)=>{const draft=stored(editKey(item));if(draft?.version===payload[index].version&&draft.text===payload[index].text)localStorage.removeItem(editKey(item))})}
// A save changes email versions, so rebuild the same review with current snapshots.
// Keep local typing made during the request and preserve the user's place in the dialog.
function refreshReviewDialog(context){
 const dialog=$('#detail-dialog');if(!dialog.open||dialogContext!==context||!context)return;
 const restore=captureView(dialog);
 if(context.kind==='review'){
  const current=context.groupId?pending().filter(i=>responseGroupId(i)===context.groupId):context.ids.map(id=>pending().find(i=>i.id===id)).filter(Boolean);
  confirmApproval(current,context.groupTitle,context);
 }else if(context.kind==='image'){
  const item=state.results.gallery?.find(i=>i.id===context.item.id)||pending().find(i=>i.id===context.item.id)||context.item;
  showImage(item);
 }else return;
 restore();
}
async function saveEmails(items){
 items=items.map(item=>pending().find(current=>current.id===item.id)).filter(Boolean).filter(canSaveEmail);
 if(!items.length)return;
 let payload;try{payload=items.map(reviewPayload)}catch(e){toast(e.message);return}
 const context=dialogContext,sources=new Map(items.map(i=>[i.id,inputSource('review',i.id)]));
 for(const item of items)emailSavesInFlight.add(item.id);
 updateReviewControls();updateDecisionButtons();
 try{
  const result=await api('/api/review/save',{items:payload});
  for(const saved of result.items){
   const sent=payload.find(i=>i.id===saved.id),draft=stored(editKey(saved));
   if(draft?.version===sent.version){
    if(draft.text===sent.text)put(editKey(saved),{version:saved.version,text:sent.text});
    else put(editKey(saved),{...draft,version:saved.version});
   }
  }
  await refresh(true);
  for(const saved of result.items){
   const before=sources.get(saved.id),after=inputSource('review',saved.id),draft=before&&stored(decisionKey(before));
   // Rebase only instructions for this save; unrelated changes still need review.
   if(before&&draft?.version===before.version&&after?.item.version===saved.version)put(decisionKey(after),{...draft,version:after.version});
  }
  toast('Email changes saved. Nothing was sent.');
 }catch(e){toast(e.message+' Your edits are still saved on this device.')}
 finally{
  for(const item of items)emailSavesInFlight.delete(item.id);
  refreshReviewDialog(context);requestRender();updateReviewControls();updateDecisionButtons();
 }
}

function replyDestination(route){
 const box=el('section','delivery-evidence');box.append(el('strong','',route.kind==='order_mockup'?'Reply in order mock-up thread':'Reply in original inquiry thread'));
 if(route.to)box.append(el('p','','To: '+route.to));if(route.subject)box.append(el('p','','Subject: '+route.subject));
 if(route.answerState==='already_answered')box.append(el('p','stale-note','Already answered — no duplicate reply.'));
 else if(!validReplyRoute(route))box.append(el('p','stale-note','Reply destination or unanswered question needs verification.'));
 return box;
}
function deliveryEvidence(delivery){
 const statusNames={delivered:'Delivered',in_transit:'On the way',label_created:'Label created · awaiting carrier',not_shipped:'Not shipped',partially_delivered:'Partially delivered',exception:'Carrier exception',unknown:'Delivery not verified'};
 const box=el('section','delivery-evidence');box.append(el('strong','',statusNames[delivery.status]||statusNames.unknown));
 if(delivery.summary)box.append(el('p','',delivery.summary));
 if(delivery.checkedAt)box.append(el('small','','Checked '+new Date(delivery.checkedAt).toLocaleString()));
 for(const parcel of delivery.packages||[]){const row=el('p','meta-line');row.append(document.createTextNode([parcel.carrier,parcel.trackingNumber,parcel.statusText].filter(Boolean).join(' · ')));if(parcel.deliveredAt)row.append(document.createTextNode(' · Delivered '+new Date(parcel.deliveredAt).toLocaleString()));try{const url=new URL(parcel.sourceUrl);if(url.protocol==='https:'&&/(^|\.)(ups|fedex)\.com$/.test(url.hostname)){const link=el('a','','View carrier tracking ↗');link.href=url.href;link.target='_blank';link.rel='noopener noreferrer';row.append(document.createTextNode(' · '),link)}}catch{}box.append(row)}
 return box;
}
function emailEditor(item,compact=false){const wrap=el('div','email-edit-wrap'+(compact?' compact-email':''));wrap.dataset.emailId=item.id;const draft=emailDraft(item),stale=draft.version!==item.version;if(!compact)wrap.append(el('label','editor-label','Reply'));const input=el('textarea','email-editor');input.dataset.emailId=item.id;input.setAttribute('aria-label','Email for '+reviewCaseName(item));input.maxLength=20000;input.value=draft.text;input.rows=compact?3:Math.min(18,Math.max(6,draft.text.split('\n').length+2));const status=el('span','edit-status',stale?'Preview changed — compare before using your edit.':emailDirty(item)?'Unsaved changes':'Saved');input.oninput=()=>{put(editKey(item),{version:draft.version,text:input.value});for(const other of $$('.email-editor'))if(other!==input&&other.dataset.emailId===item.id)other.value=input.value;status.textContent=stale?'Preview changed — compare before using your edit.':'Unsaved changes';updateReviewControls()};wrap.append(input);const actions=el('div','editor-actions');actions.append(status);if(stale){const current=el('details','instruction-details');current.append(el('summary','','Compare current saved preview'),el('div','reply-body',item[emailField(item)]));wrap.append(current);actions.append(button('Keep my edit','secondary',()=>{put(editKey(item),{version:item.version,text:input.value});replaceEditor()}))}const save=button('Save changes','secondary save-email',()=>saveEmails([item]));save.dataset.emailId=item.id;save.disabled=stale||!canSaveEmail(item)||!emailDirty(item);const reset=button('Discard edits','text-button',()=>{localStorage.removeItem(editKey(item));replaceEditor()});reset.classList.add('reset-email');reset.dataset.emailId=item.id;reset.disabled=!emailDirty(item);actions.append(reset,save);actions.hidden=compact&&!emailDirty(item)&&!stale;wrap.append(actions);
 const sendBar=el('div','email-send-bar'),send=button('Send','primary send-one-email',()=>{
  const current=pending().find(i=>i.id===item.id);
  if(current&&canApproveItem(current))submitApproval([current],{keepReviewOpen:dialogContext?.kind==='review'&&$('#detail-dialog').open});
 });
 send.dataset.emailId=item.id;send.setAttribute('aria-label','Send email for '+reviewCaseName(item));
 send.disabled=!canSubmitApproval()||!canApproveItem(item)||!canSaveEmail(item);
 const hint=el('span','email-send-hint');hint.dataset.emailId=item.id;hint.textContent=emailSendHint(item);
 sendBar.append(hint,button('Use as exact template','text-button template-button',()=>openExactTemplate(item.id)),send);wrap.append(sendBar);
 if(item.draftSuggestion?.text){const suggestion=el('details','draft-suggestion');suggestion.append(el('summary','','Suggested update · your draft is preserved'),el('p','dialog-caption',item.draftSuggestion.reason),el('div','reply-body',item.draftSuggestion.text));const use=button('Use suggested update','secondary',()=>{put(editKey(item),{version:item.version,text:item.draftSuggestion.text});replaceEditor()});use.disabled=!canSaveEmail(item);suggestion.append(use);wrap.append(suggestion);}
 function replaceEditor(){const next=emailEditor(item,compact);wrap.replaceWith(next);updateReviewControls()}return wrap}
function emailSendHint(item){
 if(item.replyDisposition||['already_answered','sent'].includes(item.replyRoute?.answerState))return 'No new email needed.';
 const draft=emailDraft(item);
 if(draft.version!==item.version)return 'Review the updated draft.';
 if(!draft.text.trim())return 'Reply required.';
 if(/\[(?:VERIFY|DECISION|ATTACH|QUOTE):/i.test(draft.text))return 'Complete the bracketed fields.';
 return '';
}
function updateReviewControls(){
for(const b of $$('[data-delete-review]')){const item=pending().find(i=>i.id===b.dataset.deleteReview);b.disabled=!item||!canSelectReview(item)}if(!state)return;
 for(const b of $$('.send-one-email')){
  const item=pending().find(i=>i.id===b.dataset.emailId);
  b.disabled=!item||!canSubmitApproval()||!canApproveItem(item)||!canSaveEmail(item);
  b.title=item?emailSendHint(item):'Already submitted';
 }
 for(const hint of $$('.email-send-hint')){const item=pending().find(i=>i.id===hint.dataset.emailId);if(item)hint.textContent=emailSendHint(item)}
const dirty=pending().filter(i=>emailDirty(i)&&canSaveEmail(i)),flat=pending().filter(isFlat);$('#save-all-edits').disabled=!canSubmitApproval()||!dirty.length;$('#save-all-edits').textContent='Save edits'+(dirty.length?' ('+dirty.length+')':'');$('#flat-count').textContent=flat.length;$('#approve-flat').disabled=!canSubmitApproval()||!flat.length;$('#flat-batch').hidden=!flat.length;for(const b of $$('.save-email')){const i=pending().find(i=>i.id===b.dataset.emailId);b.disabled=!i||!canSaveEmail(i)||!emailDirty(i)||emailDraft(i).version!==i.version;b.textContent=emailSavesInFlight.has(b.dataset.emailId)?'Saving…':'Save changes';}for(const wrap of $$('.compact-email')){const i=pending().find(i=>i.id===wrap.dataset.emailId);wrap.querySelector('.editor-actions').hidden=!i||(!emailDirty(i)&&emailDraft(i).version===i.version)}for(const b of $$('.reset-email')){const i=pending().find(i=>i.id===b.dataset.emailId);b.disabled=!i||!emailDirty(i)}for(const b of $$('.save-dialog-emails')){const ids=JSON.parse(b.dataset.emailIds),dirty=pending().filter(i=>ids.includes(i.id)&&emailDirty(i)&&canSaveEmail(i));b.disabled=!canSubmitApproval()||!dirty.length||dirty.some(i=>emailDraft(i).version!==i.version);b.textContent='Save edits'+(dirty.length?' ('+dirty.length+')':'');b.hidden=!dirty.length}syncReviewSelection();updateDialogControls();}
function inputSource(category,id){return state?.workspaceInputs?.find(s=>s.category===category&&s.id===String(id))}
function decisionKey(source){return 'shuttle-instruction-'+source.category+'-'+source.id}
function decisionDraft(source){return stored(decisionKey(source))||{version:source.version,answer:'',savePolicy:false}}
function enteredDecisions(category){return (state?.workspaceInputs||[]).filter(s=>s.category===category&&!inputReserved(s.category,s.id)&&!emailSavesInFlight.has(s.item?.id)).map(source=>{const draft=decisionDraft(source);return draft.answer.trim()&&draft.version===source.version?{category:source.category,id:source.id,version:source.version,answer:draft.answer,savePolicy:draft.savePolicy}:null}).filter(Boolean)}
function decisionEditor(source){const wrap=el('div','decision-editor'),draft=decisionDraft(source),stale=draft.version!==source.version;const label=el('label','editor-label','YOUR INSTRUCTIONS · '+(source.item.order?'#'+source.item.order:source.item.customer||source.item.title||'Inquiry'));const input=el('textarea','instruction-input');input.setAttribute('aria-label','Instructions for '+source.category+' '+(source.item.order?'#'+source.item.order:source.item.customer||source.id));input.maxLength=6000;input.rows=3;input.value=draft.answer;input.placeholder='Your decision or changes to make…';const scope=el('label','policy-scope'),check=el('input');check.type='checkbox';check.checked=draft.savePolicy;scope.append(check,document.createTextNode('Save as policy'));const persist=()=>{put(decisionKey(source),{version:draft.version,answer:input.value,savePolicy:check.checked});updateDecisionButtons()};input.oninput=persist;check.onchange=persist;const send=button('Submit instructions','secondary send-decision',()=>sendDecisions(source.category,source.id));send.dataset.category=source.category;send.dataset.sourceId=source.id;const bottom=el('div','editor-actions');bottom.append(scope,send);wrap.append(label,input);if(stale){wrap.append(el('p','stale-note','This case changed. Review its current details before keeping these instructions.'),button('Keep these instructions','secondary',()=>{put(decisionKey(source),{version:source.version,answer:input.value,savePolicy:check.checked});wrap.replaceWith(decisionEditor(source));updateDecisionButtons()}))}wrap.append(bottom);send.disabled=!canSubmitApproval()||inputReserved(source.category,source.id)||stale||!draft.answer.trim();return wrap}
function decisionBar(category){const bar=el('div','decision-batch-bar');bar.dataset.decisionCategory=category;const count=enteredDecisions(category).length;bar.append(el('span','',''),button('Submit all ('+count+') →','secondary send-decisions',()=>sendDecisions(category)));bar.querySelector('button').disabled=!canSubmitApproval()||!count;return bar}
function renderDecisionBar(category){const host=$('#'+category+'-decisions');if(host)host.replaceChildren(...(category==='review'?[]:[decisionBar(category)]));updateDecisionButtons()}
function updateDecisionButtons(){for(const b of $$('.send-decision'))b.disabled=!canSubmitApproval()||!enteredDecisions(b.dataset.category).some(x=>x.id===b.dataset.sourceId);for(const bar of $$('[data-decision-category]')){const count=enteredDecisions(bar.dataset.decisionCategory).length,b=bar.querySelector('button');b.textContent='Submit all ('+count+') →';b.disabled=!canSubmitApproval()||!count;}}
async function sendDecisions(category,id){const decisions=enteredDecisions(category).filter(d=>!id||d.id===id);if(!decisions.length)return;await submitInput('/api/decisions',{decisions},decisions.map(d=>({category:d.category,id:d.id})),decisions.length+' decision'+(decisions.length===1?'':'s')+' queued for review.',()=>{for(const d of decisions){const source={category:d.category,id:d.id},saved=stored(decisionKey(source));if(saved?.version===d.version&&saved.answer===d.answer)localStorage.removeItem(decisionKey(source))}})}
function renderOldestInputs(rows){renderDecisionBar('oldest');const host=$('#oldest-inputs');host.replaceChildren(...rows.filter(r=>r.hold||r.requiresInput||decisionDraft(inputSource('oldest',r.order)||{category:'oldest',id:r.order}).answer).map(row=>{const source=inputSource('oldest',row.order);if(!source)return el('span');const card=el('details','order-input-card');const draft=decisionDraft(source);if(draft.answer)card.open=true;card.append(el('summary','','#'+row.order+' · '+row.customer+' — Add your decision'),el('p','dialog-caption',row.blocker||row.nextAction),decisionEditor(source));return card}));updateDecisionButtons()}
$('#save-all-edits').onclick=()=>saveEmails(pending().filter(emailDirty));
$('#approve-flat').onclick=()=>confirmApproval(pending().filter(isFlat));


let calendarCursor=null,calendarDraft=null,expeditedFilter='all';
function localToday(){return new Intl.DateTimeFormat('en-CA',{timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())}
function dayLabel(day,options={weekday:'long',month:'long',day:'numeric',year:'numeric'}){return new Date(day+'T12:00:00Z').toLocaleDateString('en-US',{...options,timeZone:'UTC'})}
function scheduleDraft(){const saved=state.schedule||{days:[],version:''};if(!calendarDraft||(!stored('shuttle-production-dates')&&calendarDraft.version!==saved.version))calendarDraft=stored('shuttle-production-dates')||{version:saved.version,days:[...saved.days]};if(calendarDraft.version!==saved.version&&JSON.stringify([...calendarDraft.days].sort())===JSON.stringify(saved.days))calendarDraft={version:saved.version,days:[...saved.days]};return calendarDraft}
function keepSchedule(){if(JSON.stringify([...calendarDraft.days].sort())===JSON.stringify(state.schedule.days))localStorage.removeItem('shuttle-production-dates');else put('shuttle-production-dates',calendarDraft)}
function renderCalendar(){const schedule=state.schedule||{days:[],version:''},draft=scheduleDraft(),today=localToday();if(!calendarCursor)calendarCursor=today.slice(0,7);const [year,month]=calendarCursor.split('-').map(Number);$('#calendar-month').textContent=new Date(Date.UTC(year,month-1,1)).toLocaleDateString('en-US',{month:'long',year:'numeric',timeZone:'UTC'});const days=new Date(Date.UTC(year,month,0)).getUTCDate(),offset=new Date(Date.UTC(year,month-1,1)).getUTCDay(),grid=$('#calendar-days');grid.replaceChildren();for(let i=0;i<offset;i++)grid.append(el('span','calendar-blank'));for(let day=1;day<=days;day++){const date=calendarCursor+'-'+String(day).padStart(2,'0'),chosen=draft.days.includes(date),b=button('','calendar-day'+(chosen?' chosen':'')+(date===today?' today':''),()=>{calendarDraft.days=chosen?calendarDraft.days.filter(d=>d!==date):[...calendarDraft.days,date].sort();keepSchedule();renderCalendar()});b.setAttribute('aria-label',dayLabel(date));b.setAttribute('aria-pressed',String(chosen));b.disabled=date<today;b.append(el('strong','',String(day)));if(chosen)b.append(el('small','','Production'));else if(date===today)b.append(el('small','','Today'));grid.append(b)}const dirty=JSON.stringify([...draft.days].sort())!==JSON.stringify(schedule.days),stale=draft.version!==schedule.version;$('#save-schedule').disabled=!dirty||stale||!canRun();$('#reset-schedule').disabled=!dirty&&!stale;$('#calendar-message').hidden=!dirty&&!stale;$('#calendar-message').textContent=stale?'Schedule changed. Reset to load the latest dates.':dirty?'Unsaved dates.':'';const next=schedule.days.find(d=>d>=today);$('#next-production').textContent=next?'Next production: '+dayLabel(next,{weekday:'short',month:'short',day:'numeric'}):'No production date scheduled.';const shown=[...new Set([...schedule.days,...draft.days])].filter(d=>d>=today).sort();$('#schedule-days').replaceChildren(...shown.map(day=>{const chosen=draft.days.includes(day),saved=schedule.days.includes(day),card=el('div','production-day-row');card.append(el('strong','',dayLabel(day,{weekday:'short',month:'short',day:'numeric'})),el('small','',saved?(chosen?'Saved':'Removal pending'):'Not yet saved'));const go=button(saved?'Remove day':'Save day','secondary',()=>saveSchedule(saved?schedule.days.filter(d=>d!==day):[...schedule.days,day].sort(),day,saved));go.disabled=!canRun()||stale;go.setAttribute('aria-label',(saved?'Remove ':'Save ')+dayLabel(day));card.append(go);return card}));if(!shown.length)$('#schedule-days').append(el('p','empty','Select a day on the calendar.'));}
async function saveSchedule(days,individualDay=null,remove=false){const draft=scheduleDraft(),nextDraft=[...draft.days];if(individualDay&&remove){const index=nextDraft.indexOf(individualDay);if(index>=0)nextDraft.splice(index,1)}await action('/api/schedule',{version:draft.version,days},'Production days saved for SHUTTLE.',result=>{state.schedule=result.schedule;if(individualDay){calendarDraft={version:result.schedule.version,days:nextDraft};keepSchedule()}else{calendarDraft=null;localStorage.removeItem('shuttle-production-dates')}state.schedule=result.schedule})}
function moveMonth(delta){const [y,m]=calendarCursor.split('-').map(Number);calendarCursor=new Date(Date.UTC(y,m-1+delta,1)).toISOString().slice(0,7);renderCalendar()}
$('#calendar-prev').onclick=()=>moveMonth(-1);$('#calendar-next').onclick=()=>moveMonth(1);$('#calendar-today').onclick=()=>{calendarCursor=localToday().slice(0,7);renderCalendar()};$('#reset-schedule').onclick=()=>{calendarDraft={version:state.schedule.version,days:[...state.schedule.days]};localStorage.removeItem('shuttle-production-dates');renderCalendar()};$('#save-schedule').onclick=()=>saveSchedule([...scheduleDraft().days].sort());
// Priority window follows the saved calendar, using LA today and whole calendar days.
function expeditedProductionWindow(days=state.schedule?.days||[],today=localToday()){
 const start=[...days].sort().find(day=>day>=today);
 if(!start)return null;
 const end=new Date(start+'T12:00:00Z');end.setUTCDate(end.getUTCDate()+3);
 return {start,end:end.toISOString().slice(0,10),isToday:start===today};
}
function needsProduction(row,window){return needsNextProduction(row,window)}
function visibleExpeditedOrders(){
 const window=expeditedProductionWindow(),query=$('#expedited-search').value.trim().toLowerCase();
 return (state.expedited?.orders||[]).filter(row=>(expeditedFilter!=='production'||needsProduction(row,window))&&[row.order,row.customer,row.workflow,row.nextAction,row.deadlineText].join(' ').toLowerCase().includes(query));
}
function renderExpedited(){const data=state.expedited||{orders:[]},orders=data.orders||[],today=localToday(),window=expeditedProductionWindow();$('#expedited-count').textContent=orders.length;const checked=data.checkedAt?'Checked '+new Date(data.checkedAt).toLocaleString()+'. ':'';const active=state.runs.find(r=>r.mode==='expedited'&&['queued','running','dispatching'].includes(r.status));$('#expedited-freshness').textContent=active?active.progress:orders.length+' unfulfilled orders · '+(checked||'Not freshly checked. ')+(data.partial?'Partial coverage — additional cases may exist.':data.checkedAt?'Verified within the reported coverage.':'Refresh to verify current cases.');$('#expedited-coverage').textContent=data.coverage||'No completed check yet.';$('#refresh-expedited').disabled=!canRun();$('#expedited-production-window').textContent=window?(window.isToday?'Today’s production: ':'Next production: ')+dayLabel(window.start,{weekday:'short',month:'short',day:'numeric'})+' · Deliver by '+dayLabel(window.start,{month:'short',day:'numeric'})+'–'+dayLabel(window.end,{month:'short',day:'numeric'})+'':'Set a production date to show priority orders.';const rows=visibleExpeditedOrders();$('#expedited-list').replaceChildren(...rows.map(row=>{const card=el('article','review-card expedited-card'),head=el('div','expedited-heading');const title=el('div');title.append(el('h3','',`#${row.order} · ${row.customer||'Customer'}`),el('p','',row.workflow||row.status||'Unfulfilled'));head.append(title,el('span','pill '+(row.deadline&&row.deadline<today?'red-pill':'amber'),row.deadline?dayLabel(row.deadline,{month:'short',day:'numeric'}):'DATE NEEDED'));card.append(head);const facts=el('dl','expedited-facts');for(const [label,value] of [['Deadline',row.deadlineText||row.deadline&&dayLabel(row.deadline)||'Not confirmed'],['Shipping',row.shippingStatus||'Not verified'],['Quote / payment',row.paymentStatus||row.quote||'Not verified'],['Next step',row.nextAction||'Review current order']]){facts.append(el('dt','',label),el('dd','',value))}card.append(facts);if(row.tracking)card.append(el('p','meta-line',row.tracking));if(row.sourceNote){const source=el('details','source-details');source.append(el('summary','','Source'),el('p','meta-line',row.sourceNote));card.append(source);}const fulfillmentActions=el('div','fulfillment-actions'),fulfillLabel=el('label'),fulfillCheck=el('input');fulfillCheck.type='checkbox';fulfillCheck.checked=fulfillmentSelected.has(String(row.order));fulfillCheck.setAttribute('aria-label','Select #'+row.order+' for fulfillment');fulfillCheck.onchange=()=>{fulfillCheck.checked?fulfillmentSelected.add(String(row.order)):fulfillmentSelected.delete(String(row.order));renderFulfillmentBar()};fulfillLabel.append(fulfillCheck,document.createTextNode('Select to fulfill'));const fulfill=button('Fulfilled','primary fulfillment-button',()=>confirmFulfillment([row]));fulfill.setAttribute('aria-label','Fulfilled — #'+row.order);fulfill.disabled=!canRun();fulfillmentActions.append(fulfillLabel,fulfill);card.append(fulfillmentActions);if(row.fulfillmentAction?.message)card.append(el('p','fulfillment-note',row.fulfillmentAction.message));const review=pending().find(r=>r.id===row.reviewId);if(review){const label=el('label','expedited-select'),check=el('input');check.type='checkbox';check.checked=expeditedSelected.has(review.id);check.disabled=!canApproveItem(review);check.setAttribute('aria-label','Select expedited #'+row.order);check.onchange=()=>{check.checked?expeditedSelected.add(review.id):expeditedSelected.delete(review.id);renderExpeditedApprovalBar()};label.append(check,document.createTextNode('Select for approval'));const go=button('Review & approve','secondary',()=>confirmApproval([review]));go.disabled=!canSubmitApproval()||!canApproveItem(review);card.append(label,go)}const source=inputSource('expedited',row.order);if(source)card.append(decisionEditor(source));return card}));if(!rows.length)$('#expedited-list').append(el('div','empty',expeditedFilter==='production'&&!window?'Save a production day in the calendar to use this filter.':orders.length?'No orders match this view.':data.checkedAt?'No eligible expedited orders in the verified coverage.':'No expedited-order check has completed yet.'));renderDecisionBar('expedited');renderExpeditedApprovalBar();renderFulfillmentBar();}
$('#refresh-expedited').onclick=()=>action('/api/run',{mode:'expedited'},'Checking expedited orders. Verified results will appear here.');$('#expedited-search').oninput=renderExpedited;for(const b of $$('#expedited-filters button'))b.onclick=()=>{expeditedFilter=b.dataset.filter;for(const t of $$('#expedited-filters button'))t.classList.toggle('active',t===b);renderExpedited()};
function renderReceipt(){const notice=state.receiptConfirmation,host=$('#submission-receipt');host.hidden=!notice?.runId&&!notice?.submission;if(host.hidden)return;if(notice.submission?.kind==='production_dates'){host.classList.remove('warn');host.replaceChildren(el('strong','',notice.delivered?'Production dates received':'Production dates saved'),el('span','',notice.delivered?'SHUTTLE has confirmed your saved production dates.':'Your production dates are saved. Your one-time confirmation will appear in the SHUTTLE task.'));return}const run=state.runs.find(r=>r.id===notice.runId);if(!run){host.hidden=true;return}const failed=['failed','interrupted','cancelled'].includes(run.status);host.classList.toggle('warn',failed);const title=run.receivedAt?'Received by SHUTTLE':failed?'Submission needs attention':'Submission saved — waiting for SHUTTLE';const detail=run.receivedAt?'Your next-answer receipt: the worker received this submission at '+new Date(run.receivedAt).toLocaleTimeString()+'. See Run history for its outcome.':failed?(run.progress||'The worker has not confirmed receipt.'):'Your answer is saved. A confirmation appears here as soon as the worker reads it.';host.replaceChildren(el('strong','',title),el('span','',detail));}

function renderExpeditedApprovalBar(){const items=(state.expedited?.orders||[]).map(row=>pending().find(r=>r.id===row.reviewId)).filter(item=>item&&canApproveItem(item)),host=$('#expedited-approvals');host.hidden=!items.length;for(const id of expeditedSelected)if(!items.some(i=>i.id===id))expeditedSelected.delete(id);const visibleIds=new Set(visibleExpeditedOrders().map(row=>row.reviewId));const select=button('Select all pending approvals','secondary',()=>{for(const i of items.filter(item=>visibleIds.has(item.id)))expeditedSelected.add(i.id);renderExpedited()}),approve=button('Approve selected ('+expeditedSelected.size+')','primary',()=>confirmApproval(pending().filter(r=>expeditedSelected.has(r.id))));approve.disabled=!expeditedSelected.size||!canSubmitApproval();host.replaceChildren(select,approve)}


function renderFulfillmentBar(){const orders=state.expedited?.orders||[];for(const order of fulfillmentSelected)if(!orders.some(o=>String(o.order)===order))fulfillmentSelected.delete(order);const host=$('#expedited-fulfillment-batch');const visible=visibleExpeditedOrders();const select=button('Select all to fulfill','secondary',()=>{for(const row of visible)fulfillmentSelected.add(String(row.order));renderExpedited()}),go=button('Fulfill selected ('+fulfillmentSelected.size+')','primary',()=>confirmFulfillment(orders.filter(o=>fulfillmentSelected.has(String(o.order)))));select.disabled=!visible.length||!canRun();go.disabled=!fulfillmentSelected.size||!canRun();host.replaceChildren(el('span','',''),select,go);const run=state.runs.find(r=>r.mode==='fulfill'),status=$('#expedited-fulfillment-status');status.hidden=!run;if(run){status.classList.toggle('warn',['failed','needs_attention','interrupted'].includes(run.status));status.replaceChildren(el('strong','',run.title+' · '+run.status.replaceAll('_',' ')),el('span','',run.summary||run.progress||'Waiting for SHUTTLE.'));}}
function trackingKey(row){return 'shuttle-fulfillment-tracking-'+row.order}
function confirmFulfillment(rows){if(!rows.length)return;const content=el('div');content.append(el('p','dialog-caption','Mark all remaining items in these orders fulfilled in Shopify. Choose existing tracking, enter tracking, or fulfill without tracking for pickup or another non-shipped handoff. SHUTTLE verifies the order first. Customer shipping notifications stay off.'));const entries=[];for(const row of rows){const source=inputSource('expedited',row.order);if(!source){toast('Refresh this order before fulfilling it.');return}const saved=stored(trackingKey(row));const initial=saved||{mode:'lookup',company:'UPS',numbers:''};const card=el('section','fulfillment-entry');card.append(el('h3','',`#${row.order} · ${row.customer||'Customer'}`));const mode=el('select');mode.setAttribute('aria-label','Tracking source for #'+row.order);for(const [value,text] of [['lookup','Find existing UPS / FedEx tracking'],['provided','Enter tracking number(s)'],['no_tracking','Fulfill without tracking (including pickup)']]){const option=el('option','',text);option.value=value;mode.append(option)}mode.value=initial.mode;const fields=el('div','tracking-fields'),company=el('select');company.setAttribute('aria-label','Carrier for #'+row.order);for(const value of ['UPS','FedEx']){const option=el('option','',value);option.value=value;company.append(option)}company.value=initial.company;const numbers=el('textarea','tracking-numbers');numbers.setAttribute('aria-label','Tracking numbers for #'+row.order);numbers.rows=2;numbers.maxLength=1200;numbers.placeholder='One tracking number per line or comma';numbers.value=initial.numbers;fields.append(company,numbers);const hint=el('p','fulfillment-hint');const update=()=>{fields.hidden=mode.value!=='provided';hint.textContent=mode.value==='no_tracking'?'Marks the order fulfilled internally without a tracking number or shipping notification. This does not record carrier delivery.':mode.value==='lookup'?'Uses tracking tied to this exact order. If none is found, the order stays pending.':'These tracking numbers must belong to this order and cover all remaining items.';put(trackingKey(row),{mode:mode.value,company:company.value,numbers:numbers.value});};mode.onchange=update;company.onchange=update;numbers.oninput=update;fields.hidden=mode.value!=='provided';hint.textContent=mode.value==='no_tracking'?'Marks the order fulfilled internally without a tracking number or shipping notification. This does not record carrier delivery.':mode.value==='lookup'?'Uses tracking tied to this exact order. If none is found, the order stays pending.':'These tracking numbers must belong to this order and cover all remaining items.';card.append(mode,fields,hint);content.append(card);entries.push({row,source,mode,company,numbers})}const go=button(rows.length===1?'Mark fulfilled in Shopify':'Fulfill these orders in Shopify','primary',async()=>{const items=entries.map(({row,source,mode,company,numbers})=>({order:String(row.order),version:source.version,tracking:mode.value==='no_tracking'?{mode:'no_tracking'}:mode.value==='lookup'?{mode:'lookup'}:{mode:'provided',company:company.value,numbers:numbers.value.split(/[\n,]+/).map(s=>s.trim()).filter(Boolean)}}));const result=await action('/api/fulfill',{items},'Fulfillment submitted. Verified results will appear here.',()=>{for(const {row} of entries)fulfillmentSelected.delete(String(row.order));$('#detail-dialog').close()});});go.disabled=!canRun();showDialog(rows.length===1?'Fulfill #'+rows[0].order:'Fulfill '+rows.length+' selected orders',[content,go]);}

function mockupAttachments(item){
 const box=el('section','mockup-attachments');const ready=updatedMockupReady(item);
 box.append(el('strong','',ready?'Updated mock-up attached for review':'Awaiting updated mock-up'));
 if(!ready){box.append(el('p','meta-line','Proof pending. Attach before sending a reply that promises it.'));return box;}
 for(const a of item.mockupUpdate.attachments){const figure=el('figure');const img=el('img');img.src=safeImage(a.preview);img.alt=a.filename+' · revised proof for #'+item.order;img.loading='lazy';figure.append(img,el('figcaption','meta-line',a.filename));box.append(figure);}
 return box;
}

function customerRequest(item){
 const box=el('section','customer-request');
 const internal=/^Internal\b/i.test(item.customerQuestion||'');
 box.append(el('strong','editor-label',internal?'CASE CONTEXT':'CUSTOMER ASKED'),el('p','customer-question',item.customerQuestion||'The customer’s exact request still needs to be verified.'));
 return box;
}
function renderReplySendStatus(){
 const notice=$('#reply-send-status');if(!notice)return;
 notice.hidden=true;notice.textContent='';
 const sent=$('#sent-reply-receipts');sent.replaceChildren();
 for(const receipt of state.results.lastReplyBatch?.sent||[]){
  const box=el('details','sent-reply-receipt');
  box.append(el('summary','',`Sent · #${receipt.order} ${receipt.customer||''}`));
  const pair=el('div','reply-comparison'),answer=el('section','sent-reply-body');
  answer.append(el('strong','editor-label','ACTUAL SENT REPLY'),el('p','customer-question',receipt.body));pair.append(customerRequest(receipt),answer);box.append(pair);sent.append(box);
 }
}

// Grouping organizes review only. Each case retains its own facts, edits and approval gates.
const RESPONSE_GROUPS = [
 ['customer_approvals','Flat approvals','Verified approvals with editable production confirmations. Select individually or together to send.'],
 ['approval_needs_reply','Approved · Needs reply','Approve to send the reply and file the approved artwork in DONE READY 4 PRINT.'],
 ['support_general','Support · General','Refund, return, invoice and billing cases awaiting their individual resolution.'],
 ['support_chargeback','Support · Chargeback','Dispute and chargeback-related cases awaiting their individual resolution.'],
 ['placement','Placement & orientation','Confirm centering, spacing, or which way the finished rug faces.'],
 ['color','Colors & finish','Clarify the requested shade or review a verified color revision.'],
 ['artwork','Artwork changes','Review updated designs with the requested changes and exact attached proofs.'],
 ['proof','Proofs & source files','Answer proof-access questions, review supplied artwork, or request the missing file details.'],
 ['production','Production confirmations','Confirm the approved order and production schedule after all release checks pass.'],
 ['deadline','Delivery dates & expedited shipping','Answer requested arrival dates using the verified production schedule and shipping options.'],
 ['shipping','Delayed or missing shipments','Explain the verified shipment status and any missing packages.'],
 ['quality','Rug quality & replacements','Respond to defects, incorrect rugs, or material concerns after checking the evidence and remedy.'],
 ['billing','Refunds, cancellations & payments','Review case-specific cancellation, refund, discount, and payment decisions.'],
 ['identity','Addresses & customer details','Verify the correct order, contact, or delivery address before responding.'],
 ['quotes','Sizes, quotes & product questions','Answer size, pricing, material, and custom-order questions with the relevant details.'],
 ['collaboration','Partnerships & collaborations','Review collaboration requests and agree on the appropriate response or terms.'],
 ['other','Other questions','Review the customer’s question and decide the next response.']
];
const REVIEW_GROUP_OVERRIDES = {
 placement:['reply-15469','faq-15398','faq-15486','banda-hold-19e84983dd5b0f3b'],
 color:['reply-15515','revision-15506','revision-15496','revision-15503','banda-hold-1a0637b1acdf0d9c'],
 artwork:['revision-15474','revision-15509','revision-15463','revision-14904','revision-15464','banda-hold-1a0888796bc0693c'],
 proof:['faq-15493','faq-15354','faq-lititz-images','inquiry-cfc-logos','delivery-failure-15352','banda-hold-19f052bbd2bba5b7','banda-hold-1a082a19c57eed1c','banda-hold-1a07c488f205248a','banda-hold-19f1dec6a539f04e','banda-hold-19eed77a4d9128b5','banda-hold-19ef012b905daf01','banda-hold-1a08c5bc45e40aca','banda-hold-1a0cebf1d87e3852','banda-hold-1a0c5333ec32a9be'],
 production:['faq-14191','faq-15276','faq-15481','faq-15519','repair-15457'],
 deadline:['faq-15201','faq-15430','faq-15219','faq-15479','faq-15462','faq-15347','banda-hold-19ee62a41e3661f9','banda-hold-19ed28c2d368c01b'],
 shipping:['faq-15327'],
 billing:['refund-13825','faq-14241','banda-hold-1a0ab066e30a0e5a','banda-hold-19f39b719ef9ef3b','banda-hold-19fb3c8db3602f9c','banda-hold-1a06d83d0fa7c6bf'],
 quality:['identity-yps','banda-hold-19d6eec3b99b817d','banda-hold-1a0879d65a7ca044'],
 identity:['identity-15356'],
 quotes:['inquiry-office-material','banda-hold-1a07414f90e8d0ca']
};
function responseGroupId(item){
 if(item.approvalReviewKind==='needs_reply')return 'approval_needs_reply';
 if(item.approvalReviewKind==='flat')return 'customer_approvals';
 if(item.workflowLabel==='Support/General')return 'support_general';
 if(item.workflowLabel==='Support/Chargeback')return 'support_chargeback';
 if(RESPONSE_GROUPS.some(([id])=>id===item.responseGroupId))return item.responseGroupId;
 for(const [id,ids] of Object.entries(REVIEW_GROUP_OVERRIDES))if(ids.includes(item.id))return id;
 const label=item.workflowLabel||'',text=[item.title,item.customerQuestion].filter(Boolean).join(' ').toLowerCase();
 if(label==='Collaborations')return 'collaboration';
 if(label==='Support/Chargeback'||/refund|chargeback|cancel(?:lation)?|discount|\binvoice\b/.test(text))return 'billing';
 if(label==='Support/Rug-Issue'||/defect|replacement rug|printing error|quality (?:is|complaint)|incorrect rug/.test(text))return 'quality';
 if(label==='Support/Address-Change'||item.id.startsWith('identity-'))return 'identity';
 if(label==='Support/Late-Order')return 'shipping';
 if(item.id.startsWith('release-')||item.type==='approval')return 'customer_approvals';
 if(/\bcolor\b|\bcolour\b|darker|lighter|gradient|metallic/.test(text))return 'color';
 if(item.requiresUpdatedMockup||item.id.startsWith('revision-'))return 'artwork';
 if(/orientation|vertical|horizontal|center(?:ed|ing)?|centred|spacing/.test(text))return 'placement';
 if(/expedit|deadline|\beta\b|delivery date|arriv|need.{0,30}\bby\b/.test(text))return 'deadline';
 if(/tracking|shipment|where is my|did.{0,12}ship|missing package/.test(text))return 'shipping';
 if(/proof|mock.?up|vector|source file|logo image/.test(text))return 'proof';
 if(label.startsWith('Mockup-Inquiry')||/quote|pricing|size|material|custom runner/.test(text))return 'quotes';
 if(label==='Support/General')return 'billing';
 return 'other';
}
function groupReviewItems(items){
 return [...RESPONSE_GROUPS].sort((a,b)=>(a[0]==='approval_needs_reply'?-1:b[0]==='approval_needs_reply'?1:0)).map(([id,title,description])=>({id,title,description,items:items.filter(i=>responseGroupId(i)===id)})).filter(g=>g.items.length);
}
const openReviewGroups=new Set();
function reviewWorkspaceCategory(item){
 const group=responseGroupId(item);
 if(group==='customer_approvals')return 'flat_approvals';
 if(group==='approval_needs_reply')return 'approval_reply';
 if((item.workflowLabel||'').startsWith('Support/')||['support_general','support_chargeback','quality','billing','shipping','identity'].includes(group))return 'support';
 if(['deadline','expedited'].includes(group))return 'expedited';
 return 'general';
}
function visibleReviewItems(){
 const query=$('#search').value.trim().toLowerCase();
 return pending().filter(i=>(filter==='all'||reviewWorkspaceCategory(i)===filter)&&[i.order,i.customer,i.title,i.customerQuestion,RESPONSE_GROUPS.find(([id])=>id===responseGroupId(i))?.[1]].join(' ').toLowerCase().includes(query));
}
function reviewCaseName(item){return [item.order?'#'+item.order:'Inquiry',item.customer||item.title||'Customer'].join(' · ')}
function reviewSummary(rows){const artwork=rows.filter(i=>!updatedMockupReady(i)).length;return rows.length+' conversations'+(artwork?' · '+artwork+' awaiting artwork':'')}
function renderReview(){
 updateSelection();renderReplySendStatus();renderApprovalQueue();renderLatestSubmission();renderReconciliationStatus();
 const rows=visibleReviewItems(),groups=groupReviewItems(rows),ready=rows.filter(canApproveItem);
 $('#review-summary').textContent=reviewSummary(rows);
 $('#review-count').textContent=pending().length;
 const host=$('#review-list'),existing=new Map([...host.children].filter(e=>e.dataset.groupId).map(e=>[e.dataset.groupId,e]));for(const e of [...host.children])if(!e.dataset.groupId||!groups.some(g=>g.id===e.dataset.groupId))e.remove();for(const [index,g] of groups.entries()){const key=JSON.stringify([g.items.map(i=>[i.id,i.version,i.status,i.emailBody,i.body,i.blockers]),canSubmitApproval(),g.items.map(i=>[canSelectReview(i),selected.has(i.id)])]);let node=existing.get(g.id);if(!node||node.dataset.renderVersion!==key){const fresh=renderReviewGroup(g);fresh.dataset.renderVersion=key;if(node)node.replaceWith(fresh);node=fresh;}if(host.children[index]!==node)host.insertBefore(node,host.children[index]||null);}
 if(!groups.length)host.append(el('div','empty',$('#search').value?'No matching conversations.':'No pending items in this view.'));
 updateReviewControls();renderDecisionBar('review');syncReviewSelection();
}
function renderReviewGroup(group){
 for(const item of group.items)displayedReviewItems.set(item.id,item);
 const ready=group.items.filter(canApproveItem),held=group.items.length-ready.length,drafts=group.items.filter(emailField).length;
 const section=el('section','response-group');section.dataset.groupId=group.id;
 const head=el('div','response-group-head'),title=el('div','response-group-title'),counts=el('div','response-group-counts');
 title.append(el('h2','',group.title));
 if(ready.length)counts.append(el('span','pill green',ready.length+(group.id==='customer_approvals'?' drafts':' to send')));
 if(held)counts.append(el('span','pill amber',held+' pending'));
 
 head.append(title,counts);section.append(head);
 const actions=el('div','response-group-actions'),label=el('label','group-selection'),check=el('input');
 check.type='checkbox';check.dataset.selectGroup=group.id;check.setAttribute('aria-label','Select all in '+group.title);check.disabled=!group.items.some(canSelectReview);
 check.onchange=()=>{for(const i of group.items.filter(canSelectReview))check.checked?selected.add(i.id):selected.delete(i.id);syncReviewSelection()};label.append(check,document.createTextNode('Select all'));
 const approve=button('Review','secondary group-approve',()=>confirmApproval(group.items,group.title));
 approve.setAttribute('aria-label','Review group: '+group.title);approve.disabled=false;
 const send=button('Approve & send','primary group-send',()=>{
  const chosen=group.items.filter(i=>canSelectReview(i)&&selected.has(i.id));
  if(chosen.length){submitApproval(chosen);return}
  const candidates=group.items.filter(i=>canApproveItem(i)&&!approvalReserved(i.id));
  if(!candidates.length)return;
  confirmApproval(candidates,group.title,{kind:'review',ids:candidates.map(i=>i.id),groupTitle:group.title,selectedIds:new Set(candidates.map(i=>i.id))});
 });send.setAttribute('aria-label','Approve & send in '+group.title);actions.append(label,el('span','group-selected',''),approve,send);
 const remove=button('Delete selected','secondary group-delete',()=>deleteReviewItems(pending().filter(i=>responseGroupId(i)===group.id&&selected.has(i.id))));remove.setAttribute('aria-label','Delete selected in '+group.title);actions.append(remove);
 const instructions=button('Request changes','text-button',()=>showGroupInstructions(group));instructions.setAttribute('aria-label','Request changes for '+group.title);actions.append(instructions);
 section.append(actions);
 const details=el('details','response-group-details');details.open=openReviewGroups.has(group.id)||!!$('#search').value.trim();
 details.append(el('summary','',`Messages (${group.items.length})`));
 const cases=el('div','group-cases');
 const mount=()=>{if(!cases.childElementCount){cases.append(compactColumnLabels(),...[...group.items].sort((a,b)=>Number(canApproveItem(b))-Number(canApproveItem(a))).map(renderReviewCard));updateDecisionButtons();syncReviewSelection()}};
 details.append(cases);if(details.open)mount();
 details.ontoggle=()=>{if(details.open){openReviewGroups.add(group.id);mount()}else openReviewGroups.delete(group.id)};
 section.append(details);return section;
}
function syncReviewSelection(){
 updateSelection();
 const rows=visibleReviewItems(),ready=rows.filter(canApproveItem),selectable=rows.filter(canSelectReview),all=selectable.length&&selectable.every(i=>selected.has(i.id));$('#review-summary').textContent=reviewSummary(rows);
 $('#select-all-ready').textContent=(all?'Deselect all':'Select all')+' ('+selectable.length+')';$('#select-all-ready').disabled=!selectable.length;
 $('#clear-review-selection').disabled=!selected.size;
 for(const group of groupReviewItems(rows)){
  const section=$(`[data-group-id="${group.id}"]`);if(!section)continue;
  const eligible=group.items.filter(canApproveItem),selectable=group.items.filter(canSelectReview),count=selectable.filter(i=>selected.has(i.id)).length,check=section.querySelector('[data-select-group]');
  check.disabled=!selectable.length;check.checked=selectable.length>0&&count===selectable.length;check.indeterminate=count>0&&count<selectable.length;
  const remove=section.querySelector('.group-delete');remove.hidden=!count;remove.disabled=!count;remove.textContent='Delete selected ('+count+')';
  section.querySelector('.group-selected').textContent=count?count+' selected':'';const badges=section.querySelector('.response-group-counts');badges.replaceChildren();if(eligible.length)badges.append(el('span','pill green',eligible.length+(group.id==='customer_approvals'?' drafts':' to send')));if(group.items.length>eligible.length)badges.append(el('span','pill amber',(group.items.length-eligible.length)+' pending'));
  section.querySelector('.group-approve').disabled=false;const send=section.querySelector('.group-send');send.hidden=false;send.textContent='Approve & send'+(count?' ('+count+')':eligible.length?' ('+eligible.length+')':'');send.disabled=!eligible.length||!canSubmitApproval()||group.items.some(i=>selected.has(i.id)&&!canApproveItem(i));send.title=count?'Send only the selected replies in this category':eligible.length?'Review the replies in this category, then send':'Edit the replies and replace any marked placeholders to send';if(count){const details=section.querySelector('.response-group-details');if(!details.open){details.open=true;openReviewGroups.add(group.id);details.ontoggle?.()}}
 }
 for(const check of $$('[data-review-select]')){const item=pending().find(i=>i.id===check.dataset.reviewSelect);check.disabled=!item||!canSelectReview(item);check.checked=selected.has(check.dataset.reviewSelect);check.closest('.review-card').classList.toggle('selected',check.checked)}
}
function showGroupInstructions(group){
 const sources=group.items.map(i=>inputSource('review',i.id)).filter(s=>s&&!inputReserved(s.category,s.id));
 const content=el('div','group-instruction-dialog');content.append(el('p','dialog-caption','Describe the changes for the selected replies.'));
 const list=el('div','group-instruction-cases'),entries=[];
 for(const source of sources){const label=el('label','group-instruction-case'),check=el('input');check.type='checkbox';check.checked=true;const text=el('span');text.append(el('strong','',reviewCaseName(source.item)),el('small','',source.item.customerQuestion||source.item.title));label.append(check,text);list.append(label);entries.push({source,check})}
 const input=el('textarea','instruction-input');input.setAttribute('aria-label','Shared instructions for '+group.title);input.placeholder='How should these similar cases be handled?';input.maxLength=6000;input.rows=4;
 const draftKey='shuttle-group-instructions-'+group.id;input.value=stored(draftKey)?.answer||'';input.oninput=()=>{put(draftKey,{answer:input.value});update()};
 const policy=el('label','policy-scope'),savePolicy=el('input');savePolicy.type='checkbox';policy.append(savePolicy,document.createTextNode('Save as policy'));
 const send=button('Submit group instructions','primary',async()=>{const decisions=entries.filter(e=>e.check.checked).map(({source})=>({category:source.category,id:source.id,version:source.version,answer:input.value.trim(),savePolicy:savePolicy.checked}));await submitInput('/api/decisions',{decisions},decisions.map(d=>({category:d.category,id:d.id})),'Changes requested.',()=>{localStorage.removeItem(draftKey)})});
 function update(){const count=entries.filter(e=>e.check.checked).length;send.textContent='Submit instructions for '+count+' case'+(count===1?'':'s');send.disabled=!canSubmitApproval()||!input.value.trim()||!count}
 for(const {check} of entries)check.onchange=update;
 const toggle=button('Select / deselect all cases','secondary',()=>{const all=entries.every(e=>e.check.checked);for(const e of entries)e.check.checked=!all;update()});
 content.append(toggle,list,input,policy,send);update();showDialog('Request changes · '+group.title,[content]);
}

$('#select-all-ready').onclick=()=>{const ready=visibleReviewItems().filter(canSelectReview),all=ready.length&&ready.every(i=>selected.has(i.id));for(const i of ready)all?selected.delete(i.id):selected.add(i.id);syncReviewSelection()};
$('#delete-selected').onclick=()=>deleteReviewItems(pending().filter(i=>selected.has(i.id)));
$('#clear-review-selection').onclick=()=>{selected.clear();syncReviewSelection()};

function canSubmitApproval(){return !!state?.connection.ready&&!busy}
function approvalReserved(id){return [...approvalInFlight.values()].some(entry=>entry.items.some(i=>i.id===id))||(state?.approvalQueue||[]).some(job=>job.reviewIds.includes(id))}
async function submitApproval(items,{keepReviewOpen=false}={}){
 if(!items.length||!canSubmitApproval()||items.some(i=>approvalReserved(i.id)||reviewInputReserved(i.id)))return;
 if(items.some(i=>emailSavesInFlight.has(i.id))){toast('Email is still saving.');return;}
 let payload;try{payload=items.map(reviewPayload)}catch(e){toast(e.message);return}
 const reviewContext=keepReviewOpen&&dialogContext?.kind==='review'?dialogContext:null;
 const intent=JSON.stringify(payload),requestId=approvalIntentKeys.get(intent)||crypto.randomUUID();approvalIntentKeys.set(intent,requestId);
 approvalInFlight.set(requestId,{items,submittedAt:new Date().toISOString()});
 updateSubmissionView(()=>{if(reviewContext)refreshReviewDialog(reviewContext);else $('#detail-dialog').close();renderSubmittedSelection()});
 try{
  const result=await api('/api/approve',{items:payload,requestId});approvalInFlight.get(requestId).runId=result.run.id;appliedRefresh=++refreshRequest;
  if(!state.runs.some(r=>r.id===result.run.id))state.runs.unshift(result.run);
  if(['queued','running','dispatching'].includes(result.run.status)){
   state.approvalQueue=state.approvalQueue||[];
   if(!state.approvalQueue.some(job=>job.runId===result.run.id))state.approvalQueue.push({runId:result.run.id,status:result.run.status,reviewIds:items.map(i=>i.id),cases:items.map(i=>({id:i.id,order:i.order,customer:i.customer})),acceptedAt:result.run.createdAt});
  }
  approvalIntentKeys.delete(intent);for(const i of items){selected.delete(i.id);gallerySelected.delete(i.id);expeditedSelected.delete(i.id)}
  if(reviewContext&&dialogContext===reviewContext&&!pending().some(i=>reviewContext.groupId?responseGroupId(i)===reviewContext.groupId:reviewContext.ids.includes(i.id)))$('#detail-dialog').close();
  toast(result.duplicate?'Already submitted.':result.run.status==='queued'?'Queued for sending.':'Sending.');
  await refresh(true);
 }catch(e){toast(e.message+' Your edits are still saved.')}finally{approvalInFlight.delete(requestId);updateSubmissionView(()=>{if(reviewContext)refreshReviewDialog(reviewContext);renderApprovalQueue();updateReviewControls();requestRender()})}
}
function reviewIdsForSources(sources){
 return sources.flatMap(source=>{if(source.category==='review')return [String(source.id)];const item=inputSource(source.category,source.id)?.item;return item?.reviewId?[String(item.reviewId)]:[]});
}
function reviewInputReserved(id){return [...inputInFlight.values()].some(entry=>reviewIdsForSources(entry.sources).includes(id))||(state?.inputQueue||[]).some(job=>reviewIdsForSources(job.sources).includes(id))}
// Display failures must never prevent saving a click or leave its controls locked.
function updateSubmissionView(update){
 try{update()}catch(error){console.error('SHUTTLE submission display failed',error);deferredRender=true;flushDeferredRender()}
}
function renderSubmittedSelection(){
 // This is the user's explicit click. Update the selected queue immediately,
 // while ordinary background refreshes still preserve open editors.
 renderReview();renderQuestions();renderLiveRuntime();renderHome();
 const groups=groupReviewItems(pending()),stat=$('#stats .stat-card strong');if(stat)stat.textContent=groups.length;
 requestRender();
}
function submissionCase(source){
 const found=inputSource(source.category,source.id)?.item;
 if(found)return reviewCaseName(found);
 const q=state.results.questions.find(q=>q.id===source.id);return q?.title||source.id;
}
function submittedJobs(){
 const jobs=(state.approvalQueue||[]).map(job=>({...job,kind:'Approval',labels:job.cases.map(reviewCaseName),count:job.cases.length}));
 for(const job of state.inputQueue||[])jobs.push({...job,kind:job.sources.every(s=>s.category==='questions')?'Answers':'Instructions',labels:job.sources.map(submissionCase),count:job.sources.length});
 const known=new Set(jobs.map(job=>job.runId));
 for(const [id,entry] of approvalInFlight)if(!entry.runId||!known.has(entry.runId))jobs.push({runId:id,status:'submitting',kind:'Approval',labels:entry.items.map(reviewCaseName),count:entry.items.length,acceptedAt:entry.submittedAt});
 for(const [id,entry] of inputInFlight)if(!entry.runId||!known.has(entry.runId))jobs.push({runId:id,status:'submitting',kind:entry.sources.every(s=>s.category==='questions')?'Answers':'Instructions',labels:entry.sources.map(submissionCase),count:entry.sources.length,acceptedAt:entry.submittedAt});
 return jobs.sort((a,b)=>Date.parse(state.runs.find(r=>r.id===a.runId)?.createdAt||a.acceptedAt)-Date.parse(state.runs.find(r=>r.id===b.runId)?.createdAt||b.acceptedAt));
}
function renderApprovalQueue(){
 const host=$('#approval-queue-status');if(!host)return;
 const jobs=submittedJobs(),active=jobs.filter(j=>['running','dispatching'].includes(j.status)).length,waiting=jobs.filter(j=>j.status==='queued').length,submitting=jobs.filter(j=>j.status==='submitting').length;
 host.hidden=!jobs.length;host.replaceChildren();if(host.hidden)return;
 host.append(el('strong','',`Submitted work · ${active} processing · ${waiting} queued${submitting?' · '+submitting+' submitting':''}`),el('p','','Submitted items leave their review groups immediately. They return only if a draft, decision or retry needs your review.'));
 for(const job of jobs){
  const row=el('div','approval-queue-row'),info=el('div','submitted-case-info'),run=state.runs.find(r=>r.id===job.runId);
  row.dataset.submissionId=job.runId;info.append(el('strong','',job.kind+' · '+job.count+' case'+(job.count===1?'':'s')),el('span','',job.labels.join(', ')));
  const detail=job.status==='submitting'?'Saving your selection…':job.status==='queued'?'Saved · waiting for the worker':run?.receivedAt?'Received by SHUTTLE':'Starting worker · receipt pending';
  info.append(el('small','',detail));row.append(info,el('span','pill '+(job.status==='queued'?'neutral':'green'),job.status==='submitting'?'SUBMITTING':job.status==='queued'?'QUEUED':'PROCESSING'));if(run)row.append(runtimeClock(run));host.append(row);
 }
 const link=el('a','text-button','View receipts in Run history →');link.href='#history';host.append(link);updateRuntimeClocks();
}

function renderLatestSubmission(){
 const host=$('#latest-submission-result');if(!host)return;
 if(pointerActive){deferredRender=true;return}
 const run=state.runs.find(r=>['approve','decisions','answer','answers','fulfill'].includes(r.mode)&&!['queued','running','dispatching'].includes(r.status));
 const cases=run?pending().filter(i=>i.workspaceDecision?.requestId===run.id):[];
 const key=JSON.stringify([run,cases.map(i=>[i.id,i.version])]);if(host.dataset.version===key)return;
 host.dataset.version=key;host.hidden=!run;host.replaceChildren();if(!run)return;
 const failed=['failed','interrupted','needs_attention','cancelled'].includes(run.status),head=el('div','submission-result-heading');
 head.append(el('strong','','Latest submission · '+(failed?run.status.replaceAll('_',' '):run.status==='review'?'Reviewed':'Finished')),el('time','',new Date(run.finishedAt||run.receivedAt||run.createdAt).toLocaleString()));
 host.append(head,el('p','',run.summary||run.progress||'See Run history for the result.'));
 if(run.receivedAt)host.append(el('small','','Received by SHUTTLE · '+new Date(run.receivedAt).toLocaleString()));
 const actions=el('div','submission-result-actions');
 if(cases.length)actions.append(button('Review '+cases.length+' updated case'+(cases.length===1?'':'s'),'secondary',()=>{const current=pending().filter(i=>i.workspaceDecision?.requestId===run.id);confirmApproval(current,'Results of your submission')}));
 const history=el('a','text-button','Run history →');history.href='#history';actions.append(history);host.append(actions);
 host.classList.toggle('needs-attention',failed||cases.some(i=>!canApproveItem(i)));
}
function inputReserved(category,id){return [...inputInFlight.values()].some(e=>e.sources.some(s=>s.category===category&&s.id===String(id)))||(state?.inputQueue||[]).some(job=>job.sources.some(s=>s.category===category&&s.id===String(id)))}
async function submitInput(path,payload,sources,message,onSuccess){
 if(!canSubmitApproval()||sources.some(s=>inputReserved(s.category,s.id)))return;
 if(sources.some(s=>emailSavesInFlight.has(inputSource(s.category,s.id)?.item.id))){toast('Email is still saving.');return;}
 if(path==='/api/decisions'){
  try{payload={...payload,decisions:payload.decisions.map(d=>{const item=state.results.review.find(i=>i.id===d.id);if(d.category!=='review'||!item||!emailField(item)||!emailDirty(item))return d;const edit=reviewPayload(item);return {...d,emailText:edit.text}})}}catch(e){toast(e.message);return}
 }
 const intent=path+JSON.stringify(payload),requestId=inputIntentKeys.get(intent)||crypto.randomUUID();inputIntentKeys.set(intent,requestId);inputInFlight.set(requestId,{sources,submittedAt:new Date().toISOString()});
 updateSubmissionView(()=>{$('#detail-dialog').close();renderSubmittedSelection()});
 try{const result=await api(path,{...payload,requestId});inputInFlight.get(requestId).runId=result.run.id;appliedRefresh=++refreshRequest;if(!state.runs.some(r=>r.id===result.run.id))state.runs.unshift(result.run);
  if(['queued','running','dispatching'].includes(result.run.status)){state.inputQueue=state.inputQueue||[];state.inputQueue.push({runId:result.run.id,sources,status:result.run.status})}
  inputIntentKeys.delete(intent);onSuccess?.(result);toast(message);await refresh();
 }catch(e){toast(e.message+' Your entered text is saved.')}finally{inputInFlight.delete(requestId);updateSubmissionView(requestRender)}
}
function elapsedText(start,end=Date.now()){const seconds=Math.max(0,Math.floor((Number(end)-Date.parse(start))/1000));if(!Number.isFinite(seconds))return '—';const h=Math.floor(seconds/3600),m=Math.floor(seconds%3600/60),s=seconds%60;return (h?h+'h ':'')+(m||h?m+'m ':'')+s+'s'}
function runtimeClock(run){const span=el('span','runtime-clock');span.dataset.runtimeId=run.id;return span}
function updateRuntimeClocks(){
 updateHistoryEstimates();
 for(const clock of $$('[data-runtime-id]')){const run=state?.runs.find(r=>r.id===clock.dataset.runtimeId);if(!run)continue;const active=['running','dispatching'].includes(run.status),start=run.startedAt||run.receivedAt;
  clock.textContent=run.status==='paused'?'Paused · started '+(start?new Date(start).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'}):'—'):run.status==='queued'?'Waiting '+elapsedText(run.createdAt):active?(start?'Current session '+elapsedText(start):'Starting…'):run.finishedAt&&start?'Runtime '+elapsedText(start,Date.parse(run.finishedAt)):'Finished';
 }
}
function runIndicatorState(snapshot,submitting=false){
 const runs=visibleHistoryRuns(snapshot?.runs||[]);
 if(snapshot?.connection?.ready===false)return {status:'problem',label:snapshot.hosted?'Email / agents offline':'Connection unavailable',detail:snapshot.hosted?'Email and agent workflows are not connected. Shopify has its own connection indicator.':'Reconnect to see the current run status.'};
 const active=runs.find(r=>['running','dispatching'].includes(r.status));
 const queued=runs.filter(r=>r.status==='queued');
 if(active||queued.length||submitting)return {status:'running',label:active?'Currently running':submitting?'Submitting work':'Work queued',detail:[active?.title,queued.length?`${queued.length} queued`:null].filter(Boolean).join(' · ')||'Saving your submission'};
 const last=runs[0];
 if(last&&['needs_attention','failed','interrupted','blocked'].includes(last.status))return {status:'problem',label:'Problem with last run',detail:last.title||'See Run history for details.'};
 return {status:'idle',label:'Not running',detail:'Open Run history for details.'};
}
function renderLiveRuntime(){
 const followup=$('#followup-agent-state');if(followup){const a=state?.unfulfilled?.automation;followup.textContent=a?.enabled&&a?.mode==='live'?'Automatic · Weekdays 7 AM & 7 PM':'Paused · Activation check required. Manual check follows current dry-run settings.';}
 if(!state)return;const host=$('#run-status-indicator');if(!host)return;
 const indicator=runIndicatorState(state,approvalInFlight.size>0||inputInFlight.size>0);
 const label=indicator.label+'. '+indicator.detail;
 host.dataset.status=indicator.status;host.title=label;host.setAttribute('aria-label',label+' Open run history.');host.dataset.tooltip=label;
 const announcement=$('#run-status-announcement');if(announcement.textContent!==indicator.label)announcement.textContent=indicator.label;
 updateRuntimeClocks();
}
setInterval(updateRuntimeClocks,1000);

function offerClientUpdate(version){
 pendingClientVersion=version;
 let notice=$('#interface-update');
 if(!notice){
  notice=el('div','run-banner');notice.id='interface-update';notice.setAttribute('role','status');
  notice.append(el('strong','','Interface update ready'),el('span','','Your edits are saved. Refresh the interface to load the latest controls.'),button('Load latest interface','secondary',reloadClient));
  $('main').prepend(notice);
 }
 // Never reload while a submission is being saved or an editor is in use.
 if(!busy&&!pointerActive&&!approvalInFlight.size&&!inputInFlight.size&&!emailSavesInFlight.size&&!deletionsInFlight.size&&!$('#detail-dialog').open&&!document.activeElement?.matches('textarea,input,select'))reloadClient();
}
function reloadClient(){
 if(!pendingClientVersion||busy||approvalInFlight.size||inputInFlight.size||emailSavesInFlight.size||deletionsInFlight.size)return;
 const url=new URL(location.href);url.searchParams.set('v',pendingClientVersion);location.replace(url.href);
}

// SHUTTLE interface recovery — September 28, 2026.

// This explicit mail check is separate from the lightweight saved-state refresh.
let reviewRefreshSubmitting=false;
function renderReconciliationStatus(){
 const idleControl=document.getElementById('idle-review-refresh');if(idleControl){idleControl.disabled=!state?.localSpeed?.idleReviewRefresh;idleControl.title=idleControl.disabled?'Available after the backend reload':'Checks pending reviews only while idle';}
 const check=state?.results?.reviewReconciliation;
 const active=state?.runs?.find(r=>r.mode==='reconcile'&&['queued','running','dispatching'].includes(r.status));
 const b=$('#check-answered-emails'),caption=$('#review-reconciliation-status');
 if(!b||!caption)return;
 b.disabled=!state?.connection?.ready||!!active||reviewRefreshSubmitting;
 b.textContent=reviewRefreshSubmitting?'Requesting…':active?(active.status==='queued'?'Refresh queued…':'Checking replies…'):'Refresh review status';
 b.setAttribute('aria-busy',String(!!active||reviewRefreshSubmitting));
 caption.textContent=active?(active.status==='queued'?'Starts after current work':active.progress||'Checking all pending reviews'):check?.checkedAt?`${check.checked} checked · ${check.removed} resolved · ${check.draftsUpdated||0} drafts updated${check.coverageComplete===false?' · Some checks remain':''} · ${new Date(check.checkedAt).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'})}`:'';
 caption.title=check?.checkedAt?'Last check: '+new Date(check.checkedAt).toLocaleString():'';
}
$('#check-answered-emails').onclick=async()=>{
 const b=$('#check-answered-emails');if(b.disabled||reviewRefreshSubmitting)return;
 reviewRefreshSubmitting=true;renderReconciliationStatus();
 try{
  const r=await api('/api/reconcile',{});
  if(r.run){state.runs=state.runs||[];const i=state.runs.findIndex(x=>x.id===r.run.id);if(i>=0)state.runs[i]=r.run;else state.runs.unshift(r.run);}
  toast(r.empty?'No pending reviews.':r.run?.status==='queued'?'Review refresh queued.':'Checking for manually answered inquiries.');
  await refresh(true);
 }catch(e){toast(e.message)}finally{reviewRefreshSubmitting=false;renderReconciliationStatus()}
};

async function deleteReviewItems(items){
 if(!items.length||items.some(i=>!canSelectReview(i)))return;
 const payload=items.map(i=>({id:i.id,version:i.version,...(emailField(i)?{editedText:emailDraft(i).text}:{})}));
 const intent=JSON.stringify(payload),requestId=deletionIntentKeys.get(intent)||crypto.randomUUID();deletionIntentKeys.set(intent,requestId);
 const context=dialogContext;
 for(const item of items)deletionsInFlight.add(item.id);
 renderSubmittedSelection();refreshReviewDialog(context);
 try{
  const result=await api('/api/review/delete',{items:payload,requestId});
  appliedRefresh=++refreshRequest;
  const removed=new Set(result.deletedIds);
  state.results.review=state.results.review.map(i=>removed.has(i.id)?{...i,status:'deleted'}:i);
  for(const id of removed){selected.delete(id);context?.selectedIds?.delete(id);displayedReviewItems.delete(id)}
  deletionIntentKeys.delete(intent);
  toast(removed.size+' review'+(removed.size===1?'':'s')+' deleted. Only a new customer message can bring the inquiry back.');
  await refresh(true);
 }catch(e){toast(e.message+' Nothing was removed unless the deletion was already received.');await refresh(true).catch(()=>{});}
 finally{for(const item of items)deletionsInFlight.delete(item.id);renderSubmittedSelection();refreshReviewDialog(context);updateReviewControls();requestRender()}
}

// Home uses the same saved records and calendar as the operational pages.
function dashboardMetrics(snapshot,review,sendableIds,artworkIds,today){
 const unique=rows=>[...new Map(rows.filter(r=>r.order!=null).map(r=>[String(r.order),r])).values()];
 const open=r=>r.expeditedActive!==false&&!['FULFILLED','CANCELLED','CANCELED'].includes(String(r.fulfillmentStatus||'').toUpperCase())&&!r.cancelledAt&&!r.canceledAt;
 const expedited=unique((snapshot.expedited?.orders||[]).filter(open));
 const tracked=unique((snapshot.pipeline?.orders||[]).filter(r=>open(r)&&r.eligible!==false));
 const window=expeditedProductionWindow(snapshot.schedule?.days||[],today);
 const validDay=d=>/^\d{4}-\d{2}-\d{2}$/.test(d||'')&&!Number.isNaN(Date.parse(d+'T12:00:00Z'));
 const priority=expedited.filter(r=>needsProduction(r,window)).sort((a,b)=>(a.deadline||'9999').localeCompare(b.deadline||'9999')||String(a.order).localeCompare(String(b.order)));
 const overdue=expedited.filter(r=>validDay(r.deadline)&&r.deadline<today).sort((a,b)=>(a.deadline||'9999').localeCompare(b.deadline||'9999'));
 const missingDeadlines=expedited.filter(r=>!validDay(r.deadline));
 const undated=missingDeadlines.filter(r=>!priority.includes(r));
 const later=expedited.filter(r=>validDay(r.deadline)&&r.deadline>=today&&!priority.includes(r));
 const artwork=review.filter(r=>artworkIds.has(r.id));
 const sendable=review.filter(r=>sendableIds.has(r.id)&&!artworkIds.has(r.id));
 const other=review.filter(r=>!artworkIds.has(r.id)&&!sendableIds.has(r.id));
 const ages=tracked.map(r=>({row:r,age:validDay((r.createdAt||'').slice(0,10))?Math.max(0,Math.floor((Date.parse(today+'T12:00:00Z')-Date.parse(r.createdAt.slice(0,10)+'T12:00:00Z'))/86400000)):null})).filter(r=>r.age!==null).sort((a,b)=>b.age-a.age);
 return {review,expedited,tracked,window,priority,overdue,undated,missingDeadlines,later,artwork,sendable,other,ages,oldest:ages[0]||null};
}
function homeLink(label,href,cls='text-button'){const a=el('a',cls,label);a.href=href;return a}
function homeOpenReview(items,title){if(items.length)confirmApproval(items,title);else location.hash='review'}
function homeOpenExpedited(order=null,priority=false){
 expeditedFilter=priority?'production':'all';$('#expedited-search').value=order?String(order):'';
 for(const tab of $$('#expedited-filters button'))tab.classList.toggle('active',tab.dataset.filter===expeditedFilter);
 renderExpedited();location.hash='expedited';
}
function homeShowOrders(rows,title){
 const content=el('div','home-order-dialog');
 if(!rows.length)content.append(el('p','empty','No matching orders.'));
 for(const row of rows){const line=el('div','home-order-row');line.append(el('strong','',`#${row.order} · ${row.customer||'Customer'}`),el('span','',row.deadline?dayLabel(row.deadline,{month:'short',day:'numeric'}):'Date needed'),el('p','',row.nextAction||'Review order details.'));line.append(button('Open order','secondary',()=>{$('#detail-dialog').close();homeOpenExpedited(row.order)}));content.append(line)}
 showDialog(title,[content]);
}
function renderHomeDonut(host,groups,unit){
 host.replaceChildren();const total=groups.reduce((n,g)=>n+g.items.length,0),wrap=el('div','home-donut-wrap'),svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
 svg.setAttribute('viewBox','0 0 200 200');svg.setAttribute('role','img');svg.setAttribute('aria-label',total?groups.map(g=>`${g.label}: ${g.items.length}`).join('; '):`No ${unit}`);
 const circle=(color,length,offset)=>{const c=document.createElementNS(svg.namespaceURI,'circle');for(const [k,v] of Object.entries({cx:100,cy:100,r:76,fill:'none',stroke:color,'stroke-width':24}))c.setAttribute(k,v);if(length!==undefined){c.setAttribute('stroke-dasharray',`${length} ${2*Math.PI*76-length}`);c.setAttribute('stroke-dashoffset',String(-offset));c.setAttribute('transform','rotate(-90 100 100)')}svg.append(c);return c};
 circle('#edf1ef');let offset=0;
 for(const group of groups){if(!group.items.length)continue;const length=group.items.length/total*2*Math.PI*76,c=circle(group.color,length,offset),title=document.createElementNS(svg.namespaceURI,'title');title.textContent=`${group.label}: ${group.items.length} (${Math.round(group.items.length/total*100)}%)`;c.append(title);c.style.cursor='pointer';c.addEventListener('click',()=>group.open(group.items));offset+=length;}
 const center=el('div','home-donut-center');center.append(el('strong','',String(total)),el('span','',unit));wrap.append(svg,center);
 const legend=el('div','home-chart-legend');for(const group of groups){const row=button('','home-legend-row',()=>group.open(group.items));row.disabled=!group.items.length;const dot=el('i');dot.style.background=group.color;row.append(dot,el('span','',group.label),el('strong','',String(group.items.length)),el('small','',total?Math.round(group.items.length/total*100)+'%':'0%'));legend.append(row)}
 host.append(wrap,legend);
}
function renderHome(){
 if(!state||!$('#view-home'))return;
 renderLukasTodos();renderGideonDigests();renderHomeActivity();
 const failures=visibleHistoryRuns().filter(r=>['failed','interrupted','needs_attention'].includes(r.status)).slice(0,5),failureHost=$('#home-failures');
 if(failureHost){failureHost.replaceChildren(...failures.map(r=>{const row=el('div','home-failure-row');row.append(el('span','pill status-'+runStatusPresentation(r.status).color,runStatusPresentation(r.status).label),el('strong','',r.title),el('p','',r.summary||r.progress||'Open the run for details.'),button('View run','text-button',()=>{expandedRunChecklists.add(r.id);location.hash='history'}));return row}));if(!failures.length)failureHost.append(el('p','home-empty','No recorded failures needing attention.'));}
 const rows=pending(),metrics=dashboardMetrics(state,rows,new Set(rows.filter(canApproveItem).map(i=>i.id)),new Set(rows.filter(i=>!updatedMockupReady(i)).map(i=>i.id)),localToday());
 const m=metrics,stamp=state.results.updatedAt;
 $('#home-updated').textContent=stamp?'Updated '+new Date(stamp).toLocaleString():'No saved results';
 const cards=[
  {label:'Review queue',value:m.review.length,note:'Open customer conversations',open:()=>{location.hash='review'}},
  {label:'Replies to send',value:m.sendable.length,note:'Awaiting your approval',open:()=>homeOpenReview(m.sendable,'Replies to send')},
  {label:'Proofs pending',value:m.artwork.length,note:'Updated artwork required',open:()=>homeOpenReview(m.artwork,'Proofs pending')},
  {label:'Due next production',value:m.priority.length,note:m.window?dayLabel(m.window.start,{month:'short',day:'numeric'})+'–'+dayLabel(m.window.end,{month:'short',day:'numeric'}):'Set a production date',open:()=>homeOpenExpedited(null,true)},
  {label:'Overdue rush orders',value:m.overdue.length,note:'Past requested delivery date',tone:m.overdue.length?'danger':'',open:()=>homeShowOrders(m.overdue,'Overdue rush orders')},
  {label:'Runs needing attention',value:visibleHistoryRuns().filter(r=>['failed','interrupted','needs_attention'].includes(r.status)).length,note:'Recorded failures · view reasons',tone:failures.length?'danger':'',open:()=>{location.hash='history'}}
 ];
 $('#home-kpis').replaceChildren(...cards.map(c=>{const card=button('','home-kpi '+(c.tone||''),c.open);card.append(el('span','home-kpi-symbol',({ 'Review queue':'◎','Replies to send':'↗','Proofs pending':'▧','Due next production':'◷','Overdue rush orders':'!','Runs needing attention':'⚑' })[c.label]||'•'),el('span','home-kpi-label',c.label),el('strong','home-kpi-value',String(c.value)),el('small','home-kpi-note',c.note));return card}));
 $('#home-production-date').textContent=m.window?dayLabel(m.window.start,{weekday:'short',month:'short',day:'numeric'}):'No date scheduled';
 $('#home-production-window').textContent=m.window?'Delivery dates '+dayLabel(m.window.start,{month:'short',day:'numeric'})+'–'+dayLabel(m.window.end,{month:'short',day:'numeric'}):'Choose a production date in the calendar.';
 const exp=state.expedited||{};$('#home-expedited-coverage').textContent=(exp.partial?'Partial list · ':'')+(exp.checkedAt?'Checked '+new Date(exp.checkedAt).toLocaleString():'Not checked');
 $('#home-priority-count').textContent=m.priority.length+' order'+(m.priority.length===1?'':'s');
 const body=$('#home-priority-rows');body.replaceChildren(...m.priority.map(row=>{
  const tr=el('tr'),identity=el('td');identity.append(el('strong','','#'+row.order),el('small','',row.customer||'Customer'));
  const deadline=el('td','home-deadline',row.deadline?dayLabel(row.deadline,{weekday:'short',month:'short',day:'numeric'}):'Date needed');
  const payment=el('td','home-payment',row.paymentStatus||row.quote||'Not verified');
  const next=el('td','home-next',row.nextAction||'Review order details.');
  const action=el('td');action.append(button('Open','secondary',()=>homeOpenExpedited(row.order)));tr.append(identity,deadline,payment,next,action);return tr;
 }));
 $('#home-priority-empty').hidden=!!m.priority.length;$('#home-priority-table').hidden=!m.priority.length;
 $('#home-priority-empty').textContent=!m.window?'Schedule the next production run.':'No recorded expedited deadlines in this production window.';
 const flags=$('#home-priority-flags');flags.replaceChildren();if(m.overdue.length)flags.append(button(m.overdue.length+' overdue deadlines','home-flag danger',()=>homeShowOrders(m.overdue,'Overdue rush orders')));if(m.missingDeadlines.length)flags.append(button(m.missingDeadlines.length+' missing delivery date'+(m.missingDeadlines.length===1?'':'s'),'home-flag',()=>homeShowOrders(m.missingDeadlines,'Delivery date needed')));
 renderHomeDonut($('#home-review-chart'),[
  {label:'Replies to send',color:'#24775b',items:m.sendable,open:i=>homeOpenReview(i,'Replies to send')},
  {label:'Awaiting artwork',color:'#d2a347',items:m.artwork,open:i=>homeOpenReview(i,'Proofs pending')},
  {label:'Other review',color:'#728daf',items:m.other,open:i=>homeOpenReview(i,'Other review')}
 ],'conversations');
 renderHomeDonut($('#home-deadline-chart'),[
  {label:'This production',color:'#24775b',items:m.priority,open:i=>homeShowOrders(i,'Next production priorities')},
  {label:'Overdue',color:'#bc5b59',items:m.overdue,open:i=>homeShowOrders(i,'Overdue rush orders')},
  {label:'Later deadlines',color:'#728daf',items:m.later,open:i=>homeShowOrders(i,'Later deadlines')},
  {label:'Date missing',color:'#bac3bf',items:m.undated,open:i=>homeShowOrders(i,'Delivery date needed')}
 ],'rush orders');
 $('#home-age-caption').textContent=`${m.tracked.length} tracked unfulfilled orders`;
 const buckets=[['0–7 days',0,7],['8–14 days',8,14],['15–30 days',15,30],['31+ days',31,Infinity]];
 $('#home-age-bars').replaceChildren(...buckets.map(([label,lo,hi])=>{const count=m.ages.filter(r=>r.age>=lo&&r.age<=hi).length,row=el('div','home-age-row'),bar=el('div','home-age-track'),fill=el('span');fill.style.width=(m.tracked.length?count/m.tracked.length*100:0)+'%';bar.append(fill);row.append(el('span','',label),bar,el('strong','',String(count)));return row}));
 const unknown=m.tracked.length-m.ages.length;$('#home-age-unknown').hidden=!unknown;$('#home-age-unknown').textContent=unknown+' orders without an order date';
 const sources=$('#home-sources');sources.replaceChildren();for(const [label,data] of [['Review',state.results],['Expedited',state.expedited],['Unfulfilled',state.pipeline]]){const row=el('p');row.append(el('strong','',label+': '),document.createTextNode(data?.coverage||'Coverage not recorded.'));sources.append(row)}
}
$('#home-manage-priority').onclick=()=>homeOpenExpedited(null,true);

const unfulfilledLabels={awaiting_mockup:'Awaiting Mockup',mockup_sent:'Mockup Sent',confirmation_sent:'Confirmation sent',in_production:'Label created / in transit'};
function unfulfilledRows(){return (state?.unfulfilled?.orders||[]).filter(row=>row.fulfillmentStatus!=='FULFILLED'&&!row.cancelledAt).map(row=>{
 if(row.classificationConflict)return {...row,category:null};
 const shipped=(row.shipments||[]).some(s=>['UPS','FedEx'].includes(s.carrier)&&['label_created','in_transit'].includes(s.status)&&s.trackingNumber&&s.source&&typeof s.checkedAt==='string'&&/(Z|[+-]\d\d:\d\d)$/.test(s.checkedAt)&&Number.isFinite(Date.parse(s.checkedAt)));
 if(shipped)return {...row,category:'in_production'};
 if(row.confirmation?.verified&&row.confirmation.messageId)return {...row,category:'confirmation_sent'};
 return row;
});}
function unfulfilledAttention(row){return row.hold&&Boolean(row.checkedAt||row.manualHold||row.response?.owed);}
function unfulfilledSelect(category){pipelineFilter=category;renderPipeline();$('#pipeline-caption').scrollIntoView({block:'nearest',behavior:'smooth'});}
function unfulfilledDate(value){return value?new Date(value).toLocaleString('en-US',{timeZone:'America/Los_Angeles',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}):'Unknown';}
const orderActionSelected=new Set();
function orderActionControl(row){
 const item=state.orderControls?.items.find(i=>i.orderId===row.id);if(!item)return el('span');
 const box=el('div');if(['research','review'].includes(item.kind)){const label=el('label'),check=el('input');check.type='checkbox';check.checked=orderActionSelected.has(row.id);check.setAttribute('aria-label','Select next action for #'+row.order);check.onchange=()=>{check.checked?orderActionSelected.add(row.id):orderActionSelected.delete(row.id);renderOrderTarget()};label.append(check,document.createTextNode(' Select'));box.append(label)}box.append(el('p','pipeline-blocker',item.label),el('small','',item.owner+(item.deadline?' · '+unfulfilledDate(item.deadline):'')));
 if(item.kind==='review')box.append(button('Review & approve','secondary',()=>confirmApproval(pending().filter(r=>item.reviewIds.includes(r.id)))));
 if(item.kind==='research'){const go=button('Approve action','secondary',async()=>{go.disabled=true;try{const result=await api('/api/order-action',{orderId:row.id,version:item.version});toast('Received #'+row.order+' · '+(result.duplicate?'Already queued':'Research and reply preparation queued'));await refresh()}catch(e){toast(e.message)}finally{go.disabled=false}});go.title='Approve research and preparation for this order; sending stays in the editable review.';box.append(go);}
 if(item.kind==='automatic')box.append(el('span','pill neutral',state.unfulfilled?.automation?.enabled?'Automatic':'Automatic · paused'));
 if(item.kind==='queued')box.append(el('span','pill amber','Queued / processing'));
 return box;
}
function renderOrderTarget(){
 const c=state.orderControls;if(!c)return;let host=document.getElementById('order-target');if(!host){host=el('section','review-card');host.id='order-target';$('#unfulfilled-coverage-count').before(host)}
 host.replaceChildren(el('h3','','Unfulfilled target · 80'),el('p','',c.visible+' visible · '+c.aboveTarget+' above target'+(c.complete?'':' · partial inventory')));
 for(const warning of c.warnings)host.append(el('p','pipeline-blocker',warning));
 host.append(el('p','',c.unclassified+' need classification · '+c.overdue+' past their recorded deadline'));
 const plan=el('details');plan.append(el('summary','','Maintain 80 after backlog clearance'),el('p','','Steady-state target: 80 unfulfilled orders. No forced clearance deadline.'),el('p','dialog-caption','After the current backlog clears, complete at least as many orders as arrive over the same period. Review oldest actionable orders and delivery commitments each production day. Incoming volume and actual completed shipments must be verified before setting a daily capacity target.'),el('p','dialog-caption','Never fulfill, skip approval, or hide orders to meet this target. Downloaded artwork is not proof of printing; a label is not proof of carrier pickup.'));host.append(plan);
 const candidates=c.items.filter(i=>['research','review'].includes(i.kind)),selected=candidates.filter(i=>orderActionSelected.has(i.orderId));const bar=el('div','dialog-submit-actions');bar.append(button('Select all actions','secondary',()=>{for(const i of candidates)orderActionSelected.add(i.orderId);renderUnfulfilled()}),button('Clear selection','text-button',()=>{orderActionSelected.clear();renderUnfulfilled()}));
 const research=selected.filter(i=>i.kind==='research'),review=selected.filter(i=>i.kind==='review');const researchButton=button('Approve research ('+research.length+')','primary',async()=>{researchButton.disabled=true;try{await api('/api/order-actions',{items:research.map(i=>({orderId:i.orderId,version:i.version}))});for(const i of research)orderActionSelected.delete(i.orderId);toast('Selected order research received. Track progress in Run history.');await refresh()}catch(e){toast(e.message)}finally{researchButton.disabled=false}});researchButton.disabled=!research.length;bar.append(researchButton);
 const replyButton=button('Review & approve replies ('+review.length+')','secondary',()=>confirmApproval(pending().filter(r=>review.some(i=>i.reviewIds.includes(r.id)))));replyButton.disabled=!review.length;bar.append(replyButton);host.append(bar);
}
function unfulfilledDetails(row){
 const content=el('div','unfulfilled-detail');content.append(orderActionControl(row));
 const fields=[['Order',row.order],['Customer',row.customer],['Email',row.email],['Shopify ID',row.id],['Financial / fulfillment',[row.financialStatus,row.fulfillmentStatus].filter(Boolean).join(' / ')],['Category',unfulfilledLabels[row.category]||'Reconciliation needed'],['Workflow',row.workflow],['Next action',row.qualification?.reason||row.nextAction],['Execution holds',(row.runtimeBlockers||[]).join(' · ')],['Current proof',row.proof?.id],['Proof delivered',unfulfilledDate(row.proof?.deliveredAt)],['Last Rugtomize message',unfulfilledDate(row.lastMeaningfulRugtomizeAt)],['Last customer response',unfulfilledDate(row.lastMeaningfulCustomerAt)],['Matching',row.match?[row.match.method,row.match.confidence].filter(Boolean).join(' · '):'Unknown'],['Stage 2 notice',row.stage2?.messageId||'Not verified'],['Stage 2 sent',unfulfilledDate(row.stage2?.sentAt)],['Standard deadline',unfulfilledDate(row.qualification?.deadline?.standard)],['Effective deadline',unfulfilledDate(row.deadline)],['Eligible weekday hours',row.qualification?.elapsedHours==null?'Unknown':row.qualification.elapsedHours.toFixed(2)+' elapsed · '+row.qualification.remainingHours.toFixed(2)+' remaining'],['Manual hold',row.manualHold||row.blocker||'None recorded'],['Production confirmation',row.confirmation?.messageId||'Not verified'],['Last reconciled',unfulfilledDate(row.checkedAt)]];
 const list=el('dl','unfulfilled-facts');for(const [label,value] of fields){list.append(el('dt','',label),el('dd','',value||'Unknown'));}content.append(list);
 if(row.thread?.id){const a=el('a','text-button','Open Gmail conversation ↗');a.href='https://mail.google.com/mail/u/0/#all/'+encodeURIComponent(row.thread.id);a.target='_blank';a.rel='noopener';content.append(a);}
 for(const [title,items] of [['Ordered items',row.requiredItems],['Required production files',row.proof?.files],['Verified handoff files',row.handoff?.files],['Customer-specific deadlines',row.promises],['Matching evidence',row.match?.evidence]]){
  const section=el('details','source-details');section.append(el('summary','',title));const ul=el('ul');if(!items?.length)ul.append(el('li','','Not verified'));else for(const item of items)ul.append(el('li','',typeof item==='string'?item:JSON.stringify(item)));section.append(ul);content.append(section);
 }
 const history=button('Action history','secondary',async()=>{try{const data=await api('/api/mockup/history?order='+encodeURIComponent(row.order)),list=el('div');for(const e of data.events)list.append(el('p','dialog-caption',unfulfilledDate(e.at)+' · '+e.type+(e.phase?' · '+e.phase:'')+(e.messageId?' · '+e.messageId:'')));if(!data.events.length)list.append(el('p','empty','No recorded actions.'));showDialog('#'+row.order+' · Action history',[list]);}catch(error){toast(error.message)}});content.append(history);
 const source=inputSource('oldest',row.order);if(source)content.append(decisionEditor(source));
 showDialog('#'+row.order+' · '+(row.customer||'Customer'),[content]);
}
function showUnfulfilledReport(){
 const report=state.unfulfilled?.report,content=el('div');if(!report){content.append(el('p','empty','No workflow reconciliation has completed.'));showDialog('Mockup workflow report',[content]);return;}
 content.append(el('p','dialog-caption',(report.mode==='live'?'Live':'Dry run')+' · '+unfulfilledDate(report.finishedAt||report.startedAt)));
 for(const [key,title] of [['stage1','Stage 1'],['stage2','Stage 2 notices'],['responses','Customer responses'],['stage3','Stage 3 handoffs'],['explicitApprovals','Explicit approvals'],['multipleOptions','Alternative designs'],['manualAttention','Manual attention'],['fallbackMatches','Fallback matches'],['failures','Failures / incomplete work']]){
  const d=el('details','source-details');d.append(el('summary','',title+' ('+(report[key]?.length||0)+')'));for(const r of report[key]||[]){const p=el('p','dialog-caption');p.textContent=(r.order?'#'+r.order+' · ':'')+(r.customer?r.customer+' · ':'')+(r.error||r.reason||r.plan?.reason||r.status||r.confidence||'See order evidence');const row=unfulfilledRows().find(o=>o.order===r.order);if(row)p.append(button('Open order','text-button',()=>unfulfilledDetails(row)));d.append(p)}if(!report[key]?.length)d.append(el('p','dialog-caption','None'));content.append(d);
 }
 content.append(el('p','dialog-caption','Terminal conversations skipped: '+(report.terminalSkips||0)));showDialog('Mockup workflow report',[content]);
}
function renderUnfulfilledReports(){
 const host=$('#unfulfilled-recent-reports');if(!host)return;
 const runs=(state.runs||[]).filter(r=>r.mode==='mockup').slice(0,6);
 host.replaceChildren(...runs.map(run=>{const card=el('article','uf-report-card');card.append(el('span','uf-report-state',run.status.replaceAll('_',' ')),el('h3','',new Date(run.createdAt).toLocaleString()),el('p','',run.summary||run.progress||'Waiting for a report.'));card.append(button('View report','secondary',async()=>{try{const data=await api('/api/run-detail?id='+encodeURIComponent(run.id));const detail=data.run||data;const content=el('div');content.append(el('p','dialog-caption',run.summary||run.progress||run.status));for(const step of detail.checklist||[]){content.append(el('p','dialog-caption',(step.passed?'✓ ':'✕ ')+step.label+(step.passed?'':' — '+(step.reason||'Not verified'))));}if(!(detail.checklist||[]).length)content.append(el('p','dialog-caption','Detailed checklist is not available for this run.'));showDialog('Follow-up report · '+new Date(run.createdAt).toLocaleString(),[content]);}catch(e){toast(e.message)}}));return card}));
 if(!runs.length)host.append(el('p','empty','No follow-up runs recorded yet.'));
 const orders=unfulfilledRows(),metrics=$('#unfulfilled-metrics');if(metrics)metrics.replaceChildren(...[['Unfulfilled',orders.length],['Awaiting mockup',orders.filter(o=>o.category==='awaiting_mockup').length],['Mockup sent',orders.filter(o=>o.category==='mockup_sent').length],['Confirmation sent',orders.filter(o=>o.category==='confirmation_sent').length],['Label / in transit',orders.filter(o=>o.category==='in_production').length]].map(([label,count])=>{const card=el('div','uf-metric');card.append(el('span','',label),el('strong','',String(count)));return card}));
}
function renderOverdueOrders(){
 const q=state.orderControls?.overdueQueue;let host=document.getElementById('overdue-orders');
 if(!host){host=el('section','review-card overdue-orders');host.id='overdue-orders';$('#unfulfilled-metrics').after(host)}
 host.replaceChildren();const head=el('div','overdue-heading');head.append(el('h2','','Overdue'),el('span','pill amber',q?.verified?String(q.orders.length):'Not verified'));host.append(head);
 if(!q?.verified){host.append(el('p','dialog-caption',q?.reason||'Latest Shopify order number is not verified. Run the inventory reconciliation.'));return}
 host.append(el('p','dialog-caption','300+ order numbers behind · Latest #'+q.latestOrder+' · #'+q.cutoff+' and earlier · Checked '+unfulfilledDate(q.checkedAt)));
 if(q.stale||!q.inventoryComplete)host.append(el('p','pipeline-blocker',(q.stale?'Latest-order reference is over 24 hours old. ':'')+(!q.inventoryComplete?'Inventory is incomplete; more overdue orders may exist.':'')));
 if(!q.orders.length){host.append(el('p','empty','No overdue orders in this inventory.'));return}
 const wrap=el('div','overdue-table-wrap'),table=el('table','overdue-table'),thead=el('thead'),header=el('tr');
 for(const text of ['Order / customer','Behind','Next step','Action'])header.append(el('th','',text));thead.append(header);table.append(thead);const body=el('tbody');
 for(const row of q.orders){const item=row.recoveryExcluded?{kind:'excluded',label:'Review Shopify / Support disposition'}:state.orderControls.items.find(i=>i.orderId===row.id),tr=el('tr'),identity=el('td');identity.append(button('#'+row.order+' · '+(row.customer||'Customer'),'unfulfilled-order-link',()=>unfulfilledDetails(row)),el('small','pipeline-customer',row.email||'Email not verified'));
 const next=el('td');next.append(el('p','',row.nextAction||item?.label||'Reconcile current order evidence'),el('small','dialog-caption',row.blocker||row.qualification?.reason||row.workflow||'Current stage needs verification'));
 const cell=el('td');const go=button('Go','primary',async()=>{
  if(item?.kind==='review'){confirmApproval(pending().filter(r=>item.reviewIds.includes(r.id)));return}
  if(item?.kind==='queued'){expandedRunChecklists.add(item.runId);location.hash='history';return}
  if(item?.kind==='excluded'){unfulfilledDetails(row);return}
  go.disabled=true;try{const result=await api('/api/order-action',{orderId:row.id,version:item?.version,overdue:true});toast('#'+row.order+(result.duplicate?' is already queued.':' next-action recovery queued.'));await refresh()}catch(error){toast(error.message)}finally{go.disabled=false}
 });go.setAttribute('aria-label','Go — next action for order #'+row.order);go.disabled=!item;go.title=item?.kind==='review'?'Review the prepared reply':item?.kind==='queued'?'View current progress':item?.kind==='excluded'?'View why this order needs Shopify / Support handling':'Reconcile this order and prepare its next action through the shared queue';cell.append(go);if(item?.kind==='queued')cell.append(el('small','dialog-caption','Queued / processing'));if(item?.kind==='automatic')cell.append(el('small','dialog-caption','Automatic workflow rules still apply'));tr.append(identity,el('td','',String(row.ordersBehind)),next,cell);body.append(tr);
 }table.append(body);wrap.append(table);host.append(wrap);
}
function renderUnfulfilled(){
 renderOverdueOrders();
 renderUnfulfilledReports();
 renderOrderTarget();
 const data=state.unfulfilled||{orders:[],inventoryComplete:false},orders=unfulfilledRows(),automation=data.automation||{},query=$('#pipeline-search').value.trim().toLowerCase();
 $('#oldest-count').textContent=orders.length;const categories=['awaiting_mockup','mockup_sent','confirmation_sent','in_production'],classified=orders.filter(r=>categories.includes(r.category)),unknown=orders.filter(r=>!categories.includes(r.category));
 $('#unfulfilled-coverage-count').textContent=orders.length+' unfulfilled orders · '+classified.length+' classified'+(data.inventoryComplete?'':' · Inventory incomplete');
 renderHomeDonut($('#unfulfilled-chart'),[
  {label:'Awaiting Mockup',color:'#bd9459',items:orders.filter(r=>r.category==='awaiting_mockup'),open:()=>unfulfilledSelect('awaiting_mockup')},
  {label:'Mockup Sent',color:'#89a598',items:orders.filter(r=>r.category==='mockup_sent'),open:()=>unfulfilledSelect('mockup_sent')},
  {label:'Confirmation sent',color:'#5989ca',items:orders.filter(r=>r.category==='confirmation_sent'),open:()=>unfulfilledSelect('confirmation_sent')},
  {label:'Label created / in transit',color:'#315d48',items:orders.filter(r=>r.category==='in_production'),open:()=>unfulfilledSelect('in_production')},
  {label:'Unclassified',color:'#9686c9',items:unknown,open:()=>unfulfilledSelect('unclassified')}
 ],'unfulfilled');
 const unresolved=$('#unfulfilled-unclassified');unresolved.textContent=unknown.length+' need reconciliation';unresolved.disabled=!unknown.length;
 $('#unfulfilled-automation-mode').textContent=automation.mode==='live'?'Live':automation.mode==='paused'?'Paused':'Dry run';
 $('#unfulfilled-schedule').textContent='Weekdays · 7 AM & 7 PM · Los Angeles';
 $('#unfulfilled-next-run').textContent=automation.nextRun?'Next: '+unfulfilledDate(automation.nextRun):automation.schedule?.savedStatus==='PAUSED'?'Schedule paused':'Schedule not activated';
 $('#unfulfilled-last-run').textContent=data.lastSuccessfulReconciliationAt?'Last successful reconciliation: '+unfulfilledDate(data.lastSuccessfulReconciliationAt):'No complete reconciliation yet';
 const progress=data.report?.discovery?.inspectCandidates;const progressNode=document.getElementById('unfulfilled-scan-progress')||el('p','dialog-caption');progressNode.id='unfulfilled-scan-progress';progressNode.textContent=progress?progress.examined+' examined · '+progress.held+' held · '+progress.unexamined+' not yet examined'+(progress.recovered?' · '+progress.recovered+' recovered from saved evidence':''):'';$('#unfulfilled-last-run').after(progressNode);
 $('#unfulfilled-manual-count').textContent=String(orders.filter(unfulfilledAttention).length);$('#unfulfilled-failed-count').textContent=String(data.report?.failures?.length||0);
 const deps=$('#unfulfilled-dependencies');deps.replaceChildren(...(automation.blockers||[]).map(reason=>el('li','',reason)));
 $('#pipeline-checked').textContent=data.checkedAt?'Inventory checked '+unfulfilledDate(data.checkedAt):'Inventory not verified';
 $('#pipeline-notice').hidden=data.inventoryComplete&&unknown.length===0&&!data.warning;
 $('#pipeline-notice').textContent=data.warning||data.coverage?.limit||(!data.inventoryComplete?'Inventory sync incomplete. ':'')+(unknown.length?'The pie includes unclassified orders; each order is counted once.':'');
 $('#pipeline-coverage').textContent=typeof data.coverage==='string'?data.coverage:data.coverage?.limit||'No complete inventory reconciliation.';
 const active=state.runs.find(r=>['queued','running','dispatching'].includes(r.status));$('#refresh-orders').disabled=busy||!!active||!state.connection.ready;$('#pipeline-progress').hidden=!active;if(active)$('#pipeline-progress').textContent=active.title+' · '+(active.progress||active.status);
 const oldest=new Set((state.pipeline?.orders||[]).map(r=>String(r.order)));
 const rows=orders.filter(r=>(pipelineFilter==='all'||pipelineFilter==='holds'&&unfulfilledAttention(r)||pipelineFilter==='unclassified'&&!categories.includes(r.category)||pipelineFilter==='oldest'&&oldest.has(String(r.order))||r.category===pipelineFilter)&&[r.order,r.customer,r.email,r.workflow,r.blocker].join(' ').toLowerCase().includes(query)).sort((a,b)=>(a.createdAt||'9999').localeCompare(b.createdAt||'9999'));
 for(const b of $$('#pipeline-filters button'))b.classList.toggle('active',b.dataset.filter===pipelineFilter);
 $('#pipeline-caption').textContent=rows.length+' of '+orders.length+' orders · '+(unfulfilledLabels[pipelineFilter]||({all:'All unfulfilled',holds:'Manual attention',unclassified:'Reconciliation needed',oldest:'Oldest tracked'}[pipelineFilter]||'All unfulfilled'));
 $('#pipeline-rows').replaceChildren(...rows.map(row=>{const tr=el('tr'),identity=el('td'),name=button('#'+row.order+' · '+(row.customer||'Customer'),'unfulfilled-order-link',()=>unfulfilledDetails(row));identity.append(name,el('span','pipeline-customer',row.email||'Email unknown'));const date=el('td','pipeline-age',row.createdAt?row.createdAt.slice(0,10)+' · '+pipelineAge(row.createdAt):'Unknown');const status=el('td');status.append(el('span','pill neutral',unfulfilledLabels[row.category]||'Reconciliation needed'),el('p','pipeline-blocker',row.workflow||[row.financialStatus,row.fulfillmentStatus].filter(Boolean).join(' · ')||'Not yet reconciled'));const action=el('td','pipeline-next',row.qualification?.reason||row.nextAction||(row.automationEligible===false?'—':'Reconcile current evidence'));const deadline=el('td','pipeline-age',row.deadline?unfulfilledDate(row.deadline):'—');action.replaceChildren(orderActionControl(row));tr.append(identity,date,status,action,deadline);return tr}));$('#pipeline-empty').hidden=!!rows.length;
 const delivery=data.awaitingDelivery||[];$('#unfulfilled-delivery-count').textContent=delivery.length+' awaiting delivery';const deliveryList=$('#unfulfilled-delivery-list');deliveryList.replaceChildren(...delivery.map(row=>{const p=el('div','home-order-row');p.append(button('#'+row.order+' · '+(row.customer||'Customer'),'unfulfilled-order-link',()=>unfulfilledDetails(row)),el('span','',row.shipments?.map(s=>s.carrier+' · '+s.status?.replaceAll('_',' ')+' · '+s.trackingNumber).join('; ')||'Carrier evidence unavailable'));return p}));if(data.awaitingDeliveryComplete!==true)deliveryList.prepend(el('p','dialog-caption','Partial shipment coverage. '+(data.awaitingDeliveryCoverage||'Older orders may be outside the connection’s access.')));if(!delivery.length)deliveryList.append(el('p','dialog-caption',data.awaitingDeliveryComplete?'No verified shipments awaiting delivery.':'Awaiting-delivery coverage has not been verified.'));
 renderOldestInputs((state.pipeline?.orders||[]).filter(r=>rows.some(o=>o.order===r.order)));
}
$('#unfulfilled-unclassified').addEventListener('click',()=>unfulfilledSelect('unclassified'));$('#unfulfilled-report').addEventListener('click',showUnfulfilledReport);


function productionFolderLink(url,id){
 try{const u=new URL(url);return u.protocol==='https:'&&u.hostname==='drive.google.com'&&u.pathname==='/drive/folders/'+id?u.href:null}catch{return null}
}
function renderProductionArchive(){
 const data=state.productionArchive,host=$('#production-archive-list'),rootLink=$('#production-intake-link');
 const rootUrl=data&&productionFolderLink(data.folderUrl,data.folderId);rootLink.hidden=!rootUrl;if(rootUrl)rootLink.href=rootUrl;else rootLink.removeAttribute('href');
 const stamp=data?.checkedAt&&Number.isFinite(Date.parse(data.checkedAt))?new Date(data.checkedAt).toLocaleString():null;
 $('#production-archive-freshness').textContent=stamp?'Folder index checked '+stamp:'Folder index not yet checked.';
 const folders=[...(data?.folders||[])].filter(f=>f.parentId===data.folderId).sort((a,b)=>b.name.localeCompare(a.name,undefined,{numeric:true}));
 host.replaceChildren(...folders.map(folder=>{const row=el('div','production-folder-row'),url=productionFolderLink(folder.url,folder.id),label=el(url?'a':'span','',folder.name);if(url){label.href=url;label.target='_blank';label.rel='noopener noreferrer';label.setAttribute('aria-label','Open '+folder.name+' in Google Drive')}row.append(label,el('span','meta-line','Printing not reconciled'));return row}));
 if(!folders.length)host.append(el('p','empty','No verified production folders in this index.'));
}

// Import adds historical visibility only; the server keeps customer actions blocked.
const historicalImport=button('Import Shopify CSV','secondary',()=>{
 const input=document.createElement('input');input.type='file';input.accept='.csv,text/csv';
 input.onchange=async()=>{const file=input.files?.[0];if(!file)return;if(file.size>10000000){toast('CSV exceeds the 10 MB import limit.');return;}try{await action('/api/inventory/import',{filename:file.name,csv:await file.text()},'Historical inventory imported. Live verification is still required.')}catch(error){toast(error.message)}};input.click();
});
$('#refresh-orders').parentElement.append(historicalImport);

let agentRunSubmitting=false;
async function runAgent(mode){
 if(agentRunSubmitting)return;agentRunSubmitting=true;
 try{
  if(['banda','complete'].includes(mode)){
   const relevantEdit=item=>mode!=='banda'||item.approvalReviewKind==='flat';
   const edits=pending().filter(relevantEdit).filter(emailDirty);
   if(edits.length){
    const payload=edits.map(reviewPayload);
    await api('/api/review/save',{items:payload});
    clearSubmittedEdits(edits,payload);await refresh();
    if(pending().filter(relevantEdit).some(emailDirty))throw Error('A confirmation you edited changed while saving. Your text is preserved; compare that confirmation before it can auto-send.');
   }
  }
  await action('/api/run',{mode},'Run approved. Verified actions will proceed automatically.');
 }catch(error){toast(error.message)}finally{agentRunSubmitting=false;}
}

function renderLukasTodos(){
 let section=$('#lukas-todos');if(!section){section=el('section','home-panel');section.id='lukas-todos';$('#home-failures-panel').before(section)}section.replaceChildren(el('h2','','Only you can decide'));
 const items=(state.lukasTodos||[]).filter(i=>i.owner==='lukas'||i.requiresOwnerDecision===true);if(!items.length){section.append(el('p','meta-line','Nothing to do.'));return}
 for(const item of items){const row=el('label','todo-lukas-row'),check=el('input');check.type='checkbox';check.setAttribute('aria-label','Complete '+(item.order?'#'+item.order+' · ':'')+item.reason);row.style.cssText='display:flex;gap:12px;align-items:flex-start;padding:10px 0';check.onchange=async()=>{if(!check.checked)return;check.disabled=true;try{await api('/api/lukas-todo/complete',{id:item.id});state.lukasTodos=state.lukasTodos.filter(i=>i.id!==item.id);row.remove();await refresh(true)}catch(e){check.checked=false;check.disabled=false;toast(e.message)}};row.append(check,el('span','',(item.order?'#'+item.order+' · ':'')+item.reason));section.append(row)}
}

function renderGideonDigests(){
 let host=$('#gideon-digests');if(!host){host=el('section','home-panel');host.id='gideon-digests';$('#home-failures-panel').before(host)}
 host.replaceChildren(el('h2','','Gideon · AM / PM reports'));
 const groups=gideonDigests(state.runs).slice(0,6);
 if(!groups.length){host.append(el('p','meta-line','Reports appear here as Gideon runs. AM: before noon · PM: noon onward, Los Angeles.'));return}
 for(const group of groups){const details=el('details','gideon-digest'),summary=el('summary');const running=group.runs.filter(r=>['running','queued','dispatching'].includes(r.status)).length,completed=group.runs.filter(r=>r.status==='completed').length;
 summary.textContent=group.date+' · '+group.period+' — '+group.runs.length+' runs · '+completed+' completed'+(running?' · '+running+' in progress':'');details.append(summary);
 for(const run of group.runs){const row=el('article','digest-run');row.append(el('strong','',runStatusPresentation(run.status).label),el('p','',run.summary||run.progress||'Results pending'),button('Details','text-button',()=>{expandedRunChecklists.add(run.id);location.hash='history'}));details.append(row)}host.append(details)}
 const tasks=(state.lukasTodos||[]).filter(i=>!i.completedAt&&i.owner!=='lukas'&&i.requiresOwnerDecision!==true);if(tasks.length){const details=el('details','gideon-digest');details.append(el('summary','',tasks.length+' operational follow-ups · assigned to Gideon'));for(const task of tasks)details.append(el('p','meta-line',(task.order?'#'+task.order+' · ':'')+task.reason));host.append(details)}
}

function gideonDigests(runs){
 const groups=new Map();const clock=new Intl.DateTimeFormat('en-US',{timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'});
 for(const run of runs||[]){if(run.mode!=='complete')continue;const time=run.startedAt||run.createdAt;if(!Number.isFinite(Date.parse(time)))continue;const p=Object.fromEntries(clock.formatToParts(new Date(time)).map(x=>[x.type,x.value]));const date=p.year+'-'+p.month+'-'+p.day,period=Number(p.hour)<12?'AM':'PM',key=date+' '+period;
 if(!groups.has(key))groups.set(key,{key,date,period,runs:[]});groups.get(key).runs.push(run);}
 return [...groups.values()].sort((a,b)=>b.key.localeCompare(a.key)).map(g=>({...g,runs:g.runs.sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt))}));
}

function runProgressBar(run){const box=el('div','run-progress'),steps=run.checklist||[],total=run.checklistSummary?.total??steps.length,passed=run.checklistSummary?.passed??steps.filter(s=>s.passed===true).length,bar=el('progress');bar.max=100;if(total>0)bar.value=Math.min(100,Math.floor(passed/total*100));else if(run.status==='queued')bar.value=0;bar.setAttribute('aria-label','Verified checklist progress');box.append(bar,el('span','',total>0?bar.value+'% · '+passed+'/'+total+' checklist steps verified':'Progress not yet measurable'));return box;}

function openExactTemplate(reviewId){
 if(!Array.isArray(state.emailTemplates))return toast('Template saving is awaiting the server update. Your email edits are unchanged.');
 const item=pending().find(i=>i.id===reviewId);if(!item)return toast('Reopen the current review email.');
 const existing=(state.emailTemplates||[]).find(t=>t.active&&t.sourceReviewId===reviewId);
 const modal=el('dialog','template-dialog');const form=el('div','template-form');
 const heading=el('h2','','Exact email template');form.append(heading,el('p','dialog-caption','Use this wording for matching situations. Only {{placeholders}} will change. This does not send or change the current email.'));
 const field=(label,value,textarea=false)=>{const wrap=el('label','template-field'),input=el(textarea?'textarea':'input');wrap.append(el('span','editor-label',label),input);input.value=value;form.append(wrap);return input};
 const name=field('Template name',existing?.name||'');name.maxLength=100;
 const when=field('Use when',existing?.appliesWhen||'');when.placeholder='Example: the customer approves and asks whether the design is centered.';when.maxLength=2000;
 const text=field('Exact wording',existing?.text||emailDraft(item).text,true);text.rows=12;text.maxLength=20000;
 form.append(el('p','dialog-caption','Replace customer-specific details with {{name}}, {{production_date}}, {{shipping_options}}, or your own named placeholders. Keep the approved signature intact.'));
 const message=el('p','template-feedback');message.setAttribute('role','status');form.append(message);
 const actions=el('div','editor-actions'),close=button('Cancel','secondary',()=>modal.close());
 const save=button(existing?'Update template':'Save exact template','primary',async()=>{save.disabled=true;message.textContent='Saving…';try{const result=await api('/api/email-template',{reviewId:item.id,sourceVersion:item.version,name:name.value,appliesWhen:when.value,text:text.value,templateId:existing?.id,templateVersion:existing?.version});state.emailTemplates=[...(state.emailTemplates||[]).filter(t=>t.id!==result.template.id),result.template];message.textContent='Saved. Matching future drafts will use this exact wording.';save.textContent='Saved';setTimeout(()=>modal.close(),600);}catch(e){message.textContent=e.message;save.disabled=false;}});
 if(existing)actions.append(button('Stop using template','text-button',async()=>{try{await api('/api/email-template',{action:'disable',id:existing.id,version:existing.version});state.emailTemplates=state.emailTemplates.filter(t=>t.id!==existing.id);modal.close();toast('Template disabled.');}catch(e){message.textContent=e.message}}));
 actions.append(close,save);form.append(actions);modal.append(form);document.body.append(modal);modal.addEventListener('close',()=>modal.remove());modal.showModal();name.focus();
}
function renderHomeActivity(){
 const host=$('#home-activity');if(!host)return;host.replaceChildren();
 const runs=(state.runs||[]).filter(r=>['running','dispatching','queued','paused'].includes(r.status));
 if(!runs.length){host.append(el('p','home-empty','No active runs.'));return;}
 for(const run of runs.slice(0,6)){const card=el('div','home-activity-card'),steps=(run.checklist||[]).filter(s=>!['received','result'].includes(s.id)),done=steps.filter(s=>s.passed).length;
 const head=el('div','home-activity-head');head.append(el('strong','',run.title||run.mode),el('span','pill',run.status.replaceAll('_',' ')));card.append(head);
 const progress=el('progress');progress.max=steps.length||1;progress.value=done;progress.setAttribute('aria-label',(run.title||run.mode)+' verified steps');card.append(progress,el('small','',steps.length?done+' of '+steps.length+' steps verified':'No step evidence yet'));
 card.append(button('View progress','text-button',()=>{expandedRunChecklists.add(run.id);location.hash='history'}));host.append(card);}
}

function approvalHandoffReport(run,snapshot){
 const flat=(snapshot.results?.review||[]).filter(i=>i.status==='pending'&&(i.approvalReviewKind==='flat'||i.responseGroupId==='customer_approvals')&&!i.replyDisposition);
 const banda=(snapshot.runs||[]).filter(r=>r.mode==='banda'&&['queued','running','dispatching','paused'].includes(r.status)).sort((a,b)=>Date.parse(a.createdAt)-Date.parse(b.createdAt))[0];
 const owned=flat.filter(i=>i.sourceRunId===run.id);
 const items=run.id===banda?.id?flat:owned;
 if(!items.length)return null;
 const executing=(snapshot.runs||[]).find(r=>['running','dispatching'].includes(r.status));
 let reason;
 if(banda?.status==='queued')reason=items.length+' flat-approval candidates have not been sent. Banda is queued'+(executing&&executing.id!==banda.id?' behind '+executing.title:' for the shared worker')+'. These need Banda verification, not another approval from Lukas.';
 else if(banda?.status==='paused')reason=items.length+' flat-approval candidates remain pending; Banda is paused. They do not require another approval from Lukas.';
 else if(banda)reason=items.length+' flat-approval candidates are awaiting Banda’s verified send receipts. A candidate label does not establish that the final checks or send completed.';
 else reason=items.length+' flat-approval candidates remain pending with no active or queued Banda run. Automatic processing has not been verified.';
 return {reason,items:items.map(i=>({order:i.order,reason:(i.blockers||[]).join(' ')||'Final approval/duplicate verification and send receipt not yet recorded.'}))};
}

// Local semi-live refresh: existing read-only queue, never a second executor.
let idleReviewCheckInFlight=false;
const idleRefreshKey='shuttle-idle-review-refresh';
function mountIdleRefreshControl(){
 const anchor=document.getElementById('check-answered-emails');if(!anchor||document.getElementById('idle-review-refresh'))return;
 const label=el('label','idle-review-refresh'),input=el('input');input.type='checkbox';input.id='idle-review-refresh';input.checked=localStorage.getItem(idleRefreshKey)!=='off';
 input.onchange=()=>localStorage.setItem(idleRefreshKey,input.checked?'on':'off');
 label.append(input,document.createTextNode('Refresh reviews while idle'));label.title='Checks up to five pending cases when Review is open and the worker is idle. Existing final-send checks remain.';anchor.after(label);
}
mountIdleRefreshControl();
setInterval(async()=>{
 if(document.hidden||location.hash!=='#review'||localStorage.getItem(idleRefreshKey)==='off'||!state?.localSpeed?.idleReviewRefresh||!state?.connection?.ready||idleReviewCheckInFlight||reviewRefreshSubmitting||busy||approvalInFlight.size||emailSavesInFlight.size)return;
 if(state.runs.some(r=>['queued','running','dispatching'].includes(r.status)))return;
 idleReviewCheckInFlight=true;
 try{const result=await api('/api/reconcile',{automatic:true});if(result.run)await refresh(true);}catch(error){const caption=document.getElementById('review-reconciliation-status');if(caption)caption.textContent='Automatic refresh unavailable: '+error.message;}finally{idleReviewCheckInFlight=false;}
},120000);
