export function productionAddressIssues(s,user){
 const result={};
 function add(runId,order,warnings){if(!warnings.length)return;result[runId]||={};result[runId][order]||=[];for(const w of warnings){const issue=typeof w==='string'?{message:w,blocking:false}:{message:user.role==='owner'?w.message:w.staffMessage||'Parsel reported an address-field issue. Review the supplied address with the owner.',blocking:!!w.blocking};if(!result[runId][order].some(i=>i.message===issue.message&&i.blocking===issue.blocking))result[runId][order].push(issue);}}
 for(const job of s.prescanJobs||[]){if(job.status==='superseded')continue;add(job.runId,job.order,[...(job.live?.addressWarnings||[]),...(job.addressWarnings||[])]);}
 for(const intent of s.intents||[])if(intent.booking)for(const order of intent.approved.orders)add(intent.approved.productionId,String(order),intent.approved.addressWarnings||[]);
 return result;
}
