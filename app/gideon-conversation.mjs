import {randomUUID} from 'node:crypto';
import {requireRole} from './auth.mjs';
import {fail,record} from './shipping.mjs';
import {prescanReport} from './live-prescan.mjs';
export function gideonConversation(s,user){
 if(user.role!=='owner')return null;
 const messages=(s.gideonMessages||[]).filter(m=>m.ownerId===user.id).slice(-100);
 return {messages,workerConnected:Date.now()-Date.parse(s.gideonWorker?.lastSeenAt||'')<120000,pending:(s.jobs||[]).filter(j=>j.mode==='gideon'&&j.actor===user.id&&['queued','processing'].includes(j.status)).length};
}
export function askGideon(s,user,{text,requestId,runId}){
 requireRole(user,['owner']);if(typeof text!=='string'||!text.trim()||text.length>8000)fail('Enter an instruction of up to 8,000 characters',400);
 if(typeof requestId!=='string'||!/^[-\w]{8,100}$/.test(requestId))fail('A unique message request ID is required',400);
 const prior=(s.gideonMessages||[]).find(m=>m.ownerId===user.id&&m.requestId===requestId);if(prior)return {id:prior.id,duplicate:true};
 const context=runId?prescanReport(s,runId):null,message={id:randomUUID(),ownerId:user.id,requestId,runId:runId||null,role:'user',text:text.trim(),at:new Date().toISOString(),status:'queued'};
 s.gideonMessages||=[];s.gideonMessages.push(message);const job={id:randomUUID(),mode:'gideon',status:'queued',actor:user.id,createdAt:message.at,messageId:message.id,runId:runId||null,instruction:message.text,context,permissions:'Suggest and explain only. Do not send email, purchase labels, move files, or execute code. Operational changes require authenticated owner controls and current provider verification.'};s.jobs.push(job);record(s,'gideon_message_queued',user,{messageId:message.id,jobId:job.id});return {id:message.id,jobId:job.id,queued:true};
}
export function claimGideon(s){
 const now=Date.now();s.gideonWorker={lastSeenAt:new Date().toISOString()};const job=s.jobs.find(j=>j.mode==='gideon'&&(j.status==='queued'||j.status==='processing'&&j.leaseUntil<now));if(!job)return {job:null};
 job.status='processing';job.claimToken=randomUUID();job.leaseUntil=now+300000;const message=s.gideonMessages.find(m=>m.id===job.messageId);message.status='processing';return {job};
}
export function answerGideon(s,{jobId,claimToken,text,model}){
 const job=s.jobs.find(j=>j.id===jobId&&j.mode==='gideon');if(!job||job.status!=='processing'||job.claimToken!==claimToken||job.leaseUntil<Date.now())fail('Gideon worker claim expired or does not match',409);
 if(typeof text!=='string'||!text.trim()||text.length>16000)fail('Gideon answer is missing or too long',400);
 const message={id:randomUUID(),ownerId:job.actor,runId:job.runId,role:'assistant',text:text.trim(),at:new Date().toISOString(),status:'suggestion',model:String(model||'Connected AI worker').slice(0,100),jobId};if(job.reviewAI){const r=job.reviewAI,item=s.snapshot.results.review.find(i=>i.id===r.reviewId);if(item&&item.status==='pending'&&item.version===r.version&&item.sourceVersion===r.sourceVersion&&item.threadId===r.threadId){item.draftSuggestion={text:message.text,reason:'AI response requested by you. Review verified facts before sending.',jobId:job.id,model:message.model,sourceVersion:r.sourceVersion};item.aiRequest={...item.aiRequest,status:'ready'};}else {job.resultStale=true;if(item?.aiRequest?.jobId===job.id)item.aiRequest.status='stale';}}
 s.gideonMessages.push(message);s.gideonMessages.find(m=>m.id===job.messageId).status='answered';job.status='review';job.summary='Gideon suggestion available; no operational changes executed.';delete job.claimToken;delete job.leaseUntil;s.gideonWorker={lastSeenAt:message.at};return {ok:true,messageId:message.id};
}
