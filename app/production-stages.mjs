import {ORDER_STAGES,normalizeStage} from './public/order-stages.js';
import {requireRole} from './auth.mjs';import {fail,record} from './shipping.mjs';
export function setOrderStage(s,user,{order,stage}){
 stage=normalizeStage(stage);requireRole(user,['owner','warehouse']);if(!ORDER_STAGES.includes(stage))fail('Unknown order stage',400);
 order=String(order);if(!s.intents.some(i=>i.approved.orders.some(n=>String(n)===order)))fail('Order not found in production',404);
 if(user.role==='warehouse'&&!['awaiting production','in production','cutting / stitching / packing','awaiting carrier'].includes(stage))fail('This stage needs owner or verified shipment updates',403);
 s.orderStages||={};s.orderStages[order]={stage,updatedAt:new Date().toISOString(),updatedBy:user.id};record(s,'order_stage_changed',user,{order,stage});return s.orderStages[order];
}

// Owner corrections teach case-specific evidence; no automatic rule or release is inferred.
export function assignOrderStage(s,user,{order,stage,note=''}){
 requireRole(user,['owner']);order=String(order);stage=normalizeStage(stage);
 if(!ORDER_STAGES.includes(stage))fail('Unknown order stage',400);
 const binding=s.shopifyOrderBindings?.[order];if(!binding?.verified||!binding.id)fail('Refresh this Shopify order before assigning its stage',409);
 if(typeof note!=='string'||note.length>2000)fail('Stage note is too long',400);
 const previous=s.orderStages?.[order]||null;s.orderStages||={};const at=new Date().toISOString();
 s.orderStages[order]={stage,updatedAt:at,updatedBy:user.id,source:'owner_assignment'};
 s.stageCorrections||=[];s.stageCorrections.push({order,from:previous?.stage||null,to:stage,note,at,actor:user.id,shopifyOrderId:binding.id,shopifyUpdatedAt:s.shopifyOrders?.[order]?.updatedAt||null,ruleStatus:'example_only'});
 s.settings.shopifyTagSyncEnabled=true;s.shopifyStatusSync||={};s.shopifyStatusSync[order]={...s.shopifyStatusSync[order],status:'pending'};
 record(s,'order_stage_owner_assigned',user,{order,previous:previous?.stage||null,stage,note});return {stage:s.orderStages[order],message:'Stage saved with correction history. No approval, hold or shipping gate was changed.'};
}
