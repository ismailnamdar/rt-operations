export const SHEET_GROUPS=[['expedited','Expedited'],['picture','Picture'],['ugc','UGC'],['orders','Orders']];
export function sheetItems(order,data){
 const units=(data?.intents||[]).filter(i=>i.approved.orders.some(n=>String(n)===order.order)).flatMap(i=>i.approved.units.filter(u=>u.order?String(u.order)===order.order:i.approved.orders.length===1));
 const source=order.intakeUnits?.length?order.intakeUnits:units.length?units:order.previews.map((previewUrl,index)=>({...order.rugs[index],previewUrl}));
 return source.flatMap((unit,index)=>Array.from({length:Number.isSafeInteger(unit.quantity)&&unit.quantity>0?unit.quantity:1},()=>({...unit,previewUrl:unit.previewUrl||order.previews[index],size:unit.size||'Size unverified'})));
}
export function sheetGroup(order){const value=String(order.productionCategory||'').toLowerCase();return SHEET_GROUPS.some(([key])=>key===value)?value:'orders';}
