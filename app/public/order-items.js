export function groupOrderItems(units,order){
 const groups=new Map();for(const [index,unit] of units.entries()){
  if(unit.order&&String(unit.order)!==order.order)continue;
  const previewUrl=unit.previewUrl||order.previews[index],identity=unit.designId||unit.proofHash||previewUrl||unit.id;
  const key=JSON.stringify([identity,unit.size,unit.dimensions||null,unit.shape||null]);
  if(!groups.has(key))groups.set(key,{...unit,previewUrl,quantity:0,units:[]});
  const group=groups.get(key);group.quantity+=Number.isSafeInteger(unit.quantity)&&unit.quantity>0?unit.quantity:1;group.units.push(unit);
 }return [...groups.values()];
}
