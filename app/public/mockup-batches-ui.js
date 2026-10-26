import {goatOutputKind} from './goat-output-model.js';
const edits=new Map(),operations=new Set(),opened=new Set(),pendingSaves=new Map(),selectedRows=new Set(),saveChains=new Map();
let host,apiCall,refreshState,notify,currentState,busy=false;
const terminal=i=>['sent','excluded'].includes(i.status);
const locked=b=>['queued_redo','redoing','queued_send','sending','sent'].includes(b.status)||operations.has(b.id);
export function mockupItemLocked(b,i){
 if(terminal(i))return true;
 if(!['queued_redo','redoing','queued_send','sending'].includes(b.status))return false;
 const s=b.submissions?.find(s=>s.id===b.activeSubmissionId);if(!s)return true;
 return (s.kind==='redo'?(s.redoIds||Object.keys(s.versions||{})):(s.sendIds||Object.keys(s.versions||{}))).includes(i.id);
}
const itemBusy=(b,i)=>mockupItemLocked(b,i)||operations.has(key(b,i));
const el=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e};
const safe=p=>typeof p==='string'&&/^\/assets\/[a-zA-Z0-9_.-]+\.(png|jpg|svg)$/.test(p)?p:'';
const key=(b,i)=>'shuttle-batch-'+b.id+'-'+i.id+'-'+i.version;
function choice(b,i){const k=key(b,i);if(!edits.has(k)){let cached;try{cached=JSON.parse(localStorage.getItem(k))}catch{}if(cached?.awaitingSync)pendingSaves.set(k,{batchId:b.id,itemId:i.id,version:i.version});edits.set(k,cached||{id:i.id,version:i.version,decision:i.decision||'pending',reason:i.reason||'',emailBody:i.email?.body||''})}return edits.get(k)}
function keep(b,i,v){edits.set(key(b,i),v);localStorage.setItem(key(b,i),JSON.stringify(v))}
function category(b,i){return ['approved','redo'].includes(choice(b,i).decision)?choice(b,i).decision:'pending'}
const ready=i=>i.expectedProofCount>0&&i.proofs?.length===i.expectedProofCount;
export function batchItemInSendQueue(b,i,runs=[]){
 const sub=b.submissions?.find(s=>s.id===b.activeSubmissionId);
 if(sub?.kind!=='send'||sub.versions?.[i.id]!==i.version||!sub.sendIds?.includes(i.id))return false;
 const run=runs.find(r=>r.id===sub.runId);
 if(run)return ['queued','dispatching','running','paused'].includes(run.status);
 return ['queued_send','sending'].includes(b.status)&&['queued','processing'].includes(sub.status);
}
export function visibleMockupRows(state){return (state.mockupBatches?.batches||[]).flatMap(b=>b.items.filter(i=>!terminal(i)&&!batchItemInSendQueue(b,i,state.runs)).map(i=>({b,i})))}
function rows(){return visibleMockupRows(currentState)}
function sendFailure(b,i){
 const sub=[...(b.submissions||[])].reverse().find(s=>s.kind==='send'&&s.versions?.[i.id]===i.version&&s.sendIds?.includes(i.id));
 if(!sub)return '';
 const run=currentState.runs?.find(r=>r.id===sub.runId);
 if(['failed','needs_attention','interrupted','cancelled','queue_failed'].includes(run?.status||sub.status))return run?.summary||sub.summary||'The send did not complete. Review Run history before retrying.';
 return '';
}
function redraw(){renderMockupBatches(currentState,apiCall,refreshState,notify)}
async function persist(b,items){
 const snapshots=items.map(i=>({...choice(b,i),expectedDecidedAt:i.decidedAt||null}));
 const previous=saveChains.get(b.id)||Promise.resolve();
 const task=previous.catch(()=>{}).then(async()=>{
  const live=currentState.mockupBatches.batches.find(x=>x.id===b.id)||b;
  const result=await apiCall('/api/mockup-batches/save',{batchId:b.id,version:live.version,items:snapshots});
  for(const i of items){edits.delete(key(b,i));localStorage.removeItem(key(b,i));pendingSaves.delete(key(b,i));}
  Object.assign(live,result.batch);if(live!==b)Object.assign(b,result.batch);
 });saveChains.set(b.id,task);try{await task}finally{if(saveChains.get(b.id)===task)saveChains.delete(b.id)}
}
async function decideRows(list,decision){
 const groups=new Map();for(const {b,i} of list){if(itemBusy(b,i)||(decision==='approved'&&!ready(i)))continue;keep(b,i,{...choice(b,i),decision,awaitingSync:true});operations.add(key(b,i));if(!groups.has(b.id))groups.set(b.id,{b,items:[]});groups.get(b.id).items.push(i)}redraw();
 for(const {b,items} of groups.values()){try{await persist(b,items);for(const i of items)selectedRows.delete(key(b,i))}catch(e){notify(e.message)}finally{for(const i of items)operations.delete(key(b,i))}}
 redraw();await refreshState(true);
}
async function decide(b,i,decision){if(itemBusy(b,i))return;keep(b,i,{...choice(b,i),decision,awaitingSync:true});const operation=key(b,i);operations.add(operation);redraw();try{await persist(b,[i]);pendingSaves.delete(operation);}catch(e){if(locked(b)&&/already queued or processing/.test(e.message)){pendingSaves.set(operation,{batchId:b.id,itemId:i.id,version:i.version});notify('Choice saved on this browser. It will sync when the current batch finishes.');}else notify(e.message)}finally{operations.delete(operation);redraw();await refreshState(true)}}
function flushPending(){for(const [k,p] of pendingSaves){const b=currentState.mockupBatches?.batches.find(b=>b.id===p.batchId),i=b?.items.find(i=>i.id===p.itemId);if(!i||i.version!==p.version||terminal(i)){pendingSaves.delete(k);continue}if(!locked(b)&&!itemBusy(b,i)){pendingSaves.delete(k);void decide(b,i,choice(b,i).decision);}}}

async function processRows(selected,action){if(busy||!selected.length)return;busy=true;redraw();let submitted=0;try{const groups=new Map();for(const row of selected){if(!groups.has(row.b.id))groups.set(row.b.id,[]);groups.get(row.b.id).push(row.i)}for(const [id,items] of groups){const b=currentState.mockupBatches.batches.find(b=>b.id===id);if(locked(b)){notify('These mock-ups are already processing.');continue}operations.add(id);try{await persist(b,items);const ids=items.map(i=>i.id);const result=await apiCall('/api/mockup-batches/submit',{batchId:id,version:b.version,requestId:crypto.randomUUID(),action,itemIds:ids});Object.assign(b,result.batch);submitted+=items.length}catch(e){notify(e.message)}finally{operations.delete(id)}}if(submitted)notify(action==='send'?submitted+' approved emails queued.':submitted+' redos queued.');}finally{busy=false;redraw();await refreshState(true)}}
async function actOnMockups(selected,action){if(busy)return;const eligible=selected.filter(({b,i})=>!itemBusy(b,i)&&!locked(b)&&(action!=='send'||ready(i)));for(const {b,i} of eligible)keep(b,i,{...choice(b,i),decision:action==='send'?'approved':'redo',awaitingSync:true});await processRows(eligible,action);}
function button(text,action,disabled=false,cls='secondary'){const b=el('button',cls,text);b.type='button';b.disabled=disabled;b.onclick=action;return b}
function image(label,url){const f=el('figure');f.append(el('figcaption','',label));if(safe(url)){const a=el('a');a.href=url;a.target='_blank';a.rel='noopener';const img=el('img');img.src=url;img.alt=label;img.loading='lazy';a.append(img);f.append(a)}else f.append(el('small','','Not available'));return f}
function card({b,i}){const row=el('article','mockup-compact-row');row.dataset.batchOrder=i.id;const head=el('div','mockup-row-head'),identity=el('div','mockup-row-identity');const pick=el('input');pick.type='checkbox';pick.checked=selectedRows.has(key(b,i));pick.disabled=itemBusy(b,i);pick.setAttribute('aria-label','Select order '+i.order);pick.onchange=()=>{pick.checked?selectedRows.add(key(b,i)):selectedRows.delete(key(b,i));redraw()};head.append(pick);identity.append(el('strong','',`#${i.order} · ${i.customer}`),el('small','',(goatOutputKind(b,i)==='updated'?'Updated mock-up · ':goatOutputKind(b,i)==='new'?'New mock-up · ':'')+(i.request||`${i.proofs?.length||0} proofs`)));head.append(identity);const controls=el('div','mockup-row-actions');const disabled=itemBusy(b,i)||busy;controls.append(button('Approve & send',()=>actOnMockups([{b,i}],'send'),disabled||!ready(i)||locked(b),'primary'),button('Redo',()=>{opened.add(i.id);actOnMockups([{b,i}],'redo')},disabled||locked(b)));if(disabled)controls.append(el('small','','Processing'));head.append(controls);row.append(head);const failure=sendFailure(b,i);if(failure){const warning=el('p','notice',failure);warning.setAttribute('role','status');row.append(warning)}
 const details=el('details','mockup-row-details');details.open=opened.has(i.id);details.ontoggle=()=>details.open?opened.add(i.id):opened.delete(i.id);details.append(el('summary','','Edit email / optional redo notes'));
 for(const proof of i.proofs||[]){const p=el('div','mockup-proof');p.append(el('small','',proof.filename));const pair=el('div','mockup-proof-pair');pair.append(image('Original image',proof.originalPreview),image('Latest revised mock-up',proof.preview));p.append(pair);row.append(p)}
 const notes=el('textarea');notes.rows=2;notes.maxLength=6000;notes.placeholder='Optional: what would you like changed? Leave blank to recheck the original request and artwork.';notes.setAttribute('aria-label','Notes for order '+i.order);notes.value=choice(b,i).reason;notes.disabled=disabled;notes.oninput=()=>keep(b,i,{...choice(b,i),reason:notes.value});details.append(notes);
 details.append(el('small','',`To: ${i.email?.to||'Unverified'} · ${i.email?.subject||''}`));const email=el('textarea');email.rows=5;email.maxLength=20000;email.value=choice(b,i).emailBody;email.setAttribute('aria-label','Email for order '+i.order);email.disabled=disabled;email.oninput=()=>keep(b,i,{...choice(b,i),emailBody:email.value});details.append(email,button('Save changes',()=>decide(b,i,choice(b,i).decision),disabled));if(i.hold?.reason)details.append(el('small','',i.hold.reason));row.append(details);return row}
export function renderMockupBatches(state,api,refresh,toast){currentState=state;apiCall=api;refreshState=refresh;notify=toast;host=document.querySelector('#mockup-batches-list');if(!host)return;queueMicrotask(flushPending);const all=rows();document.querySelector('#mockup-batches-count').textContent=all.length;const visible=all,selectable=visible.filter(r=>!itemBusy(r.b,r.i)&&!locked(r.b)),chosen=selectable.filter(r=>selectedRows.has(key(r.b,r.i)));const toolbar=el('div','mockup-category-toolbar'),selection=el('div','mockup-selection-actions');
 const selectLabel=el('label','','Select all'),selectAll=el('input');selectAll.type='checkbox';selectAll.setAttribute('aria-label','Select all mock-ups');selectAll.checked=selectable.length>0&&chosen.length===selectable.length;selectAll.indeterminate=chosen.length>0&&chosen.length<selectable.length;selectAll.disabled=!selectable.length;selectAll.onchange=()=>{for(const r of selectable)selectAll.checked?selectedRows.add(key(r.b,r.i)):selectedRows.delete(key(r.b,r.i));redraw()};selectLabel.prepend(selectAll);selection.append(selectLabel,el('small','',chosen.length+' selected'),button('Approve & send selected',()=>actOnMockups(chosen,'send'),busy||!chosen.some(r=>ready(r.i)),'primary'),button('Redo selected',()=>actOnMockups(chosen,'redo'),busy||!chosen.length));toolbar.append(selection);host.replaceChildren(el('p','meta-line','All new and updated GOAT mock-ups together. Approve & send queues the saved script email and verified proofs. Redo returns the selected order to GOAT using your optional notes.'),toolbar);
 const sending=(state.mockupBatches?.batches||[]).flatMap(b=>b.items.filter(i=>!terminal(i)&&batchItemInSendQueue(b,i,state.runs)));if(sending.length){const notice=el('div','notice');notice.setAttribute('role','status');const link=el('a','','View Run history');link.href='#history';notice.append(el('span','',sending.length+' submitted for sending · '),link);host.append(notice)}const notePending=(state.mockupBatches?.batches||[]).flatMap(b=>b.items.filter(i=>i.sendReceipt?.shopifyNotesRequired===true&&i.shopifyNoteReceipt?.verified!==true));if(notePending.length){const warning=el('div','notice');warning.setAttribute('role','status');warning.append(el('strong','','Emails sent · Shopify notes pending verification'),el('p','','Orders '+notePending.map(i=>'#'+i.order).join(', ')+'. Complete or retry the note updates only; do not resend these emails.'));host.append(warning)}for(const row of visible)host.append(card(row));if(!visible.length)host.append(el('p','meta-line','No mock-ups awaiting review.'));}
