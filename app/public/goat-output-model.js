// View-only grouping: never changes batch identities, decisions, proof versions or send receipts.
export function goatReviewPages(rows,size=25){const pages=[];for(let index=0;index<rows.length;index+=size)pages.push(rows.slice(index,index+size));return pages;}
export function goatOutputKind(batch,item){const value=String(item.processingKind||batch.processingKind||item.kind||'').toLowerCase();return ['new','first_mockup','new_order'].includes(value)?'new':['updated','revision','revised','redo'].includes(value)?'updated':'unclassified';}
