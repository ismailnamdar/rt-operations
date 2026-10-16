export function priceExpeditedOptions(quotes){
 if(!quotes.length)return [];
 if(quotes.some(q=>q.currency!=='USD'||q.completeOrderQuote!==true||!Number.isSafeInteger(q.costCents)||q.costCents<0))throw Error('Verified complete-order USD quotes in integer cents required');
 const cheapest=Math.min(...quotes.map(q=>q.costCents));
 return quotes.map(q=>({...q,customerPriceCents:4000+Math.ceil((q.costCents-cheapest)*135/100)}));
}
