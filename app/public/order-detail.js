import {shippingDetails,shippingTime} from './production-pages.js';
import {groupOrderItems} from './order-items.js';
import {stageLabel} from './order-stages.js';
const el=(tag,text='',cls='')=>{const node=document.createElement(tag);node.textContent=text;node.className=cls;return node;};
let opened=null;
export function orderStatus(order,data){return stageLabel(data?.orderStages?.[order.order]?.stage||order.productionStage);}
export function refreshOrderDetail(state){if(opened&&document.querySelector('#warehouse-order-dialog')?.open)draw(state);}
export function openOrderDetail(order,state,api,refresh,toast){
 opened={order,api,refresh,toast};let dialog=document.querySelector('#warehouse-order-dialog');
 if(!dialog){dialog=el('dialog','','warehouse-order-dialog');dialog.id='warehouse-order-dialog';dialog.setAttribute('aria-label','Order details');document.body.append(dialog);dialog.addEventListener('close',()=>{opened=null;});}
 draw(state);dialog.showModal();
}
function draw(state){
 const {order,api,refresh,toast}=opened,dialog=document.querySelector('#warehouse-order-dialog'),data=state.productionShipping||{},operate=['owner','warehouse'].includes(state.hosted?.user.role);
 dialog.replaceChildren();const heading=el('div','','order-detail-heading'),close=el('button','×','icon-button');close.setAttribute('aria-label','Close order details');close.onclick=()=>dialog.close();heading.append(el('h2','Order #'+order.order),close);dialog.append(heading,el('span',orderStatus(order,data),'order-status'));

 const intents=(data.intents||[]).filter(i=>i.approved.orders.some(n=>String(n)===order.order));
 if(!intents.length){dialog.append(el('p','Artwork from the production folder. Shipping/package and physical quantities are awaiting verification.','dialog-caption'));const list=el('div','','order-item-list');const units=order.intakeUnits?.length?order.intakeUnits:order.rugs?.length?order.rugs:order.previews.map((previewUrl,index)=>({id:String(index),previewUrl,size:'Size unverified'}));for(const unit of units){const row=el('article','','order-item-row'),image=el('img','','order-item-image');if(unit.previewUrl){image.src=unit.previewUrl;image.alt=unit.fileName||unit.design||'Production artwork';row.append(image);}const facts=el('div');facts.append(el('h4',unit.fileName||unit.design||'Production artwork'),el('p','Size: '+(unit.size||'Size unverified')));row.append(facts);if(operate){const redo=el('button','Redo','secondary');redo.onclick=()=>showRedo(row,redo,unit,()=>({productionId:order.productionId,order:order.order,rugId:unit.id}));const pending=(data.redoRequests||[]).find(r=>r.productionId===order.productionId&&r.rugId===unit.id&&r.status!=='resolved');if(pending){redo.disabled=true;redo.textContent='Redo requested';facts.append(el('p','Flagged for source verification','meta-line'));}row.append(redo);}list.append(row);}dialog.append(list);if(operate){const print=el('button','Print label','order-print-button');print.disabled=true;dialog.append(print,el('p','A saved Parsel label must be connected to this order before printing.','meta-line'));}return;}
 for(const intent of intents){
  const receipt=shippingDetails(order,data).find(r=>r.id===intent.id);if(receipt){const meta=el('div','','shipped-label-meta');meta.append(el('p','Label booked: '+shippingTime(receipt.bookedAt)),el('p',[receipt.carrier,receipt.service].filter(Boolean).join(' · ')),el('p','Tracking: '+(receipt.tracking||'Not recorded')),el('p','First printed: '+shippingTime(receipt.printedAt)),el('p','Print requested by: '+(receipt.printedBy||'Not recorded')),el('p','Printer station: '+(receipt.printerStation||'Not recorded')),el('p','Delivery: '+receipt.deliveryStatus));dialog.append(meta);}const p=intent.approved;dialog.append(el('h3',intents.length>1?'Package '+intent.id:'Order items'));
  const list=el('div','','order-item-list');for(const unit of groupOrderItems(p.units,order)){
   if(unit.order&&String(unit.order)!==order.order)continue;
   const row=el('article','','order-item-row'),image=el('img','','order-item-image');const url=unit.previewUrl;if(url){image.src=url;image.alt=unit.design;row.append(image);}const facts=el('div');facts.append(el('h4',unit.design),el('p','Size: '+unit.size+' · Quantity: '+unit.quantity));row.append(facts);
   const request=(data.redoRequests||[]).find(r=>r.intentId===intent.id&&unit.units.some(u=>u.id===r.rugId)&&r.status!=='resolved');
   if(request)row.append(el('span','Redo: '+request.reason,'order-status'));
   else if(operate){const redo=el('button','Redo','secondary');redo.onclick=()=>{redo.disabled=true;const form=el('form','','order-redo-form'),select=el('select');select.setAttribute('aria-label','Redo reason for '+unit.design);for(const reason of ['missing','failed quality inspection','sublimation issue']){const option=el('option',reason[0].toUpperCase()+reason.slice(1));option.value=reason;select.append(option);}const affected=el('select');affected.setAttribute('aria-label','Rug to redo');for(const physical of unit.units){const option=el('option',physical.id);option.value=physical.id;affected.append(option);}const submit=el('button','Request redo','secondary');form.append(select);if(unit.units.length>1)form.append(affected);form.append(submit);form.onsubmit=async e=>{e.preventDefault();submit.disabled=true;await act('/api/warehouse/redo',{id:intent.id,rugId:affected.value,reason:select.value});};row.append(form);};row.append(redo);}list.append(row);
  }dialog.append(list);

  if(operate){const jobs=(data.printJobs||[]).filter(j=>j.intentId===intent.id),pending=jobs.some(j=>['queued','claimed'].includes(j.status)),previous=jobs.some(j=>['spooled','failed','uncertain'].includes(j.status))||!!intent.labelAppliedAt;
   const print=el('button',pending?'Print queued':previous?'Reprint label':'Print label','order-print-button');print.disabled=state.hosted?.carrier==='disconnected'||!intent.booking||pending||intent.redoHold||order.fulfilled;print.onclick=()=>act(previous?'/api/warehouse/reprint':'/api/warehouse/print',{id:intent.id});dialog.append(print);
   if(!intent.booking)dialog.append(el('p','Waiting for your owner approval to book through Parsel.','meta-line'));
   if(intent.redoHold)dialog.append(el('p','Redo requested — label printing is on hold.','warehouse-error'));
  }
 }
 function showRedo(row,button,unit,payload){button.disabled=true;const form=el('form','','order-redo-form'),select=el('select');select.setAttribute('aria-label','Redo reason for '+(unit.fileName||unit.design||unit.id));for(const reason of ['missing','failed quality inspection','sublimation issue']){const option=el('option',reason);option.value=reason;select.append(option);}const submit=el('button','Request redo','secondary'),cancel=el('button','Cancel','secondary');cancel.type='button';cancel.onclick=()=>{form.remove();button.disabled=false;};form.append(select,submit,cancel);form.onsubmit=async e=>{e.preventDefault();submit.disabled=true;await act('/api/warehouse/redo',{...payload(),reason:select.value});};row.append(form);}
 async function act(route,payload){try{await api(route,payload);await refresh(true);toast('Order updated.');}catch(error){toast(error.message);draw(state);}}
}
function dimensions(value){if(typeof value==='string')return value;if(value&&Number.isFinite(value.width)&&Number.isFinite(value.height))return `${value.width} × ${value.height} ${value.unit||''}`;return 'Not recorded';}
