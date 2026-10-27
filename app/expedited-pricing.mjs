export function priceExpeditedOptions(quotes){
 if(!quotes.length)return [];
 if(quotes.some(q=>q.currency!=='USD'||q.completeOrderQuote!==true||!Number.isSafeInteger(q.costCents)||q.costCents<0))throw Error('Verified complete-order USD quotes in integer cents required');
 const cheapest=Math.min(...quotes.map(q=>q.costCents));
 const marked=quotes.map(q=>({...q,customerPriceCents:4000+Math.ceil((q.costCents-cheapest)*135/100)}));
 return enforceExpeditedMinimum(marked); 
}

// Applies to new quotes only. Existing sent quotes, selections and bookings are immutable.
export function enforceExpeditedMinimum(options){
 if(!options.length)return [];
 if(options.some(o=>!Number.isSafeInteger(o.customerPriceCents)||o.customerPriceCents<=0))throw Error('Positive marked-up prices in cents required');
 const cheapest=Math.min(...options.map(o=>o.customerPriceCents)),factor=cheapest<4853?4853/cheapest:1;
 return options.map(o=>({...o,customerPriceCents:Math.round(o.customerPriceCents*factor)}));
}
