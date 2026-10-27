const day=value=>{if(!value)return null;if(/^\d{4}-\d{2}-\d{2}$/.test(value))return value;const date=new Date(value);return Number.isFinite(date.getTime())?new Intl.DateTimeFormat('en-CA',{timeZone:'America/Los_Angeles'}).format(date):null;};
export function expeditedUrgency(order,days,today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Los_Angeles'}).format(new Date())){
 const upcoming=[...new Set(days)].filter(d=>d>=today).sort().slice(0,2),deadline=day(order.deliveryDeadline);
 return {urgent:upcoming.length===2&&!!deadline&&deadline>=upcoming[0]&&deadline<=upcoming[1],upcoming:upcoming[0]||null,following:upcoming[1]||null,deliveryDeadline:deadline,missingDates:upcoming.length<2||!deadline};
}

export function needsNextProduction(row,window){
 if(row.expeditedActive===false||row.cancelledAt||row.fulfillmentStatus==='FULFILLED')return false;
 if(row.shopifyPaidShippingSelected&&row.nextProductionRequired)return true;
 return !!(!row.productionHold&&window&&/^\d{4}-\d{2}-\d{2}$/.test(row.deadline||'')&&row.deadline>=window.start&&row.deadline<=window.end);
}
