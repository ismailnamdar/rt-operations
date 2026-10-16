import {ORDER_STAGES,normalizeStage} from './public/order-stages.js';
import {requireRole} from './auth.mjs';import {fail,record} from './shipping.mjs';
export function setOrderStage(s,user,{order,stage}){
 stage=normalizeStage(stage);requireRole(user,['owner','warehouse']);if(!ORDER_STAGES.includes(stage))fail('Unknown order stage',400);
 order=String(order);if(!s.intents.some(i=>i.approved.orders.some(n=>String(n)===order)))fail('Order not found in production',404);
 if(user.role==='warehouse'&&!['awaiting production','in production','cutting / stitching / packing','awaiting carrier'].includes(stage))fail('This stage needs owner or verified shipment updates',403);
 s.orderStages||={};s.orderStages[order]={stage,updatedAt:new Date().toISOString(),updatedBy:user.id};record(s,'order_stage_changed',user,{order,stage});return s.orderStages[order];
}
