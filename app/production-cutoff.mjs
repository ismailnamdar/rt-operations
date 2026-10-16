import {requireRole} from './auth.mjs';import {fail,record} from './shipping.mjs';
export function upcomingIntake(s,through=new Date().toISOString()){
 const last=(s.productionCutoffs||[]).at(-1),start=last?.cutoffAt,end=Date.parse(through);
 const within=at=>Number.isFinite(Date.parse(at))&&Date.parse(at)<=end&&(!start||Date.parse(at)>Date.parse(start));
 return {from:start||null,through,approvalWindowVerified:!!start,approvals:start?(s.productionApprovals||[]).filter(a=>a.verified===true&&within(a.approvedAt)&&!a.cutoffRunId):[],redos:(s.redoRequests||[]).filter(r=>r.status!=='resolved'&&!r.cutoffRunId&&within(r.requestedAt))};
}
export function cutOffProduction(s,user,{runId},now=new Date().toISOString()){
 requireRole(user,['owner']);const existing=(s.productionCutoffs||[]).find(c=>c.runId===runId);if(existing)return existing;
 const run=(s.snapshot.productionRuns?.runs||[]).find(r=>r.id===runId);if(!run)fail('Choose an imported Pro production run before cutting it off',400);
 const last=(s.productionCutoffs||[]).at(-1);if(last&&Date.parse(now)<=Date.parse(last.cutoffAt))fail('Cutoff must be later than the previous cutoff');
 const intake=upcomingIntake(s,now),cutoff={runId,runName:run.name||runId,cutoffAt:now,previousCutoffAt:intake.from,recordedBy:user.id,orders:structuredClone(run.orders||[]),approvalIds:intake.approvals.map(a=>a.id),redoIds:intake.redos.map(r=>r.id),driveFilesMoved:false};
 s.productionCutoffs||=[];s.productionCutoffs.push(cutoff);for(const entry of [...intake.approvals,...intake.redos])entry.cutoffRunId=runId;
 record(s,'production_cutoff_recorded',user,{runId,cutoffAt:now,approvalIds:cutoff.approvalIds,redoIds:cutoff.redoIds});return cutoff;
}
