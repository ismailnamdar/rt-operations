import {randomUUID} from 'node:crypto';
import {fingerprint} from './shipping.mjs';
import {prepareLabelBookerPacking} from './label-booker-preparation.mjs';
export const OWNER_NEXT_RUN='1Pm24b9F0cGQ35xurZUnaCCApYycsHF5D';
export const OWNER_LAST_RUN='1k8DzDKmeyHFiIaHpHK05a_5l5MRSAxn8';
export function prepareEarlyPrescan(s){
 const runs=s.snapshot.productionRuns?.runs||[];
 if(!s.settings.earlyPrescanPolicy&&runs.some(r=>r.id===OWNER_NEXT_RUN)){
  s.settings.earlyPrescanPolicy='owner-2026-11-02';s.settings.lastProductionRunId=OWNER_LAST_RUN;s.settings.upcomingProductionRunId=OWNER_NEXT_RUN;
 }
 const run=runs.find(r=>r.id===s.settings.upcomingProductionRunId);if(!run)return;
 s.prescanJobs||=[];const active=s.prescanJobs.filter(j=>j.kind==='early_intake'&&j.runId===run.id&&j.status!=='superseded');
 const report=run.orders?.length?prepareLabelBookerPacking(s,run.id):null;
 const rows=new Map((report?.orders||[]).map(o=>[o.order,o]));const present=new Set();
 for(const order of run.orders||[]){
  if(!order.rugs?.length)continue;const number=String(order.order);present.add(number);
  const hash=fingerprint(order.rugs.map(r=>({id:r.sourceFileId,name:r.fileName,modified:r.sourceModifiedAt||null,size:r.size})).sort((a,b)=>a.id.localeCompare(b.id)));
  const previous=active.find(j=>j.order===number);if(previous?.sourceFingerprint===hash)continue;
  if(previous)previous.status='superseded';
  s.prescanJobs.push({id:randomUUID(),kind:'early_intake',runId:run.id,order:number,orders:[number],sourceFingerprint:hash,createdAt:new Date().toISOString(),status:'awaiting_live_verification',stage:'packing_prepared',packing:rows.get(number)?.packing||null,issues:rows.get(number)?.issues||[],remainingChecks:report.requires,readyToPurchase:false,isTest:false});
 }
 for(const job of active)if(!present.has(job.order))job.status='superseded';
}
