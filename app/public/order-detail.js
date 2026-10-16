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
 if(!intents.length){dialog.append(el('p','Package details and physical item records are awaiting verification.'));for(const [n,url] of order.previews.entries()){const image=el('img','','order-item-image');image.src=url;image.alt='Artwork '+(n+1);dialog.append(image);}return;}
 for(const intent of intents){
  const p=intent.approved;dialog.append(el('h3',intents.length>1?'Package '+intent.id:'Order items'));
  const list=el('div','','order-item-list');for(const unit of groupOrderItems(p.units,order)){
   if(unit.order&&String(unit.order)!==order.order)continue;
   const row=el('article','','order-item-row'),image=el('img','','order-item-image');const url=unit.previewUrl;if(url){image.src=url;image.alt=unit.design;row.append(image);}const facts=el('div');facts.append(el('h4',unit.design),el('p','Size: '+unit.size+' · Quantity: '+unit.quantity));row.append(facts);
   const request=(data.redoRequests||[]).find(r=>r.intentId===intent.id&&unit.units.some(u=>u.id===r.rugId)&&r.status!=='resolved');
   if(request)row.append(el('span','Redo: '+request.reason,'order-status'));
   else if(operate){const redo=el('button','Redo','secondary');redo.onclick=()=>{redo.disabled=true;const form=el('form','','order-redo-form'),select=el('select');select.setAttribute('aria-label','Redo reason for '+unit.design);for(const reason of ['missing','failed quality inspection','sublimation issue']){const option=el('option',reason[0].toUpperCase()+reason.slice(1));option.value=reason;select.append(option);}const affected=el('select');affected.setAttribute('aria-label','Rug to redo');for(const physical of unit.units){const option=el('option',physical.id);option.value=physical.id;affected.append(option);}const submit=el('button','Request redo','secondary');form.append(select);if(unit.units.length>1)form.append(affected);form.append(submit);form.onsubmit=async e=>{e.preventDefault();submit.disabled=true;await act('/api/warehouse/redo',{id:intent.id,rugId:affected.value,reason:select.value});};row.append(form);};row.append(redo);}list.append(row);
  }dialog.append(list);

  if(operate){const jobs=(data.printJobs||[]).filter(j=>j.intentId===intent.id),pending=jobs.some(j=>['queued','claimed'].includes(j.status)),previous=jobs.some(j=>['spooled','failed','uncertain'].includes(j.status))||!!intent.labelAppliedAt;
   const print=el('button',pending?'Print queued':previous?'Reprint label':'Book the label','order-print-button');print.disabled=!intent.booking||pending||intent.redoHold||order.fulfilled;print.onclick=()=>act(previous?'/api/warehouse/reprint':'/api/warehouse/print',{id:intent.id});dialog.append(print);
   if(!intent.booking)dialog.append(el('p','Waiting for your owner approval to book through Parsel.','meta-line'));
   if(intent.redoHold)dialog.append(el('p','Redo requested — label printing is on hold.','warehouse-error'));
  }
 }
 async function act(route,payload){try{await api(route,payload);await refresh(true);toast('Order updated.');}catch(error){toast(error.message);draw(state);}}
}
function dimensions(value){if(typeof value==='string')return value;if(value&&Number.isFinite(value.width)&&Number.isFinite(value.height))return `${value.width} × ${value.height} ${value.unit||''}`;return 'Not recorded';}
