import {classifyReviewConversation,REVIEW_ROUTING_VERSION} from './public/review-routing.js';
export function organizeReviewCategories(s){
 const counts={},items=(s.snapshot.results.review||[]).filter(i=>i.status==='pending');let candidates=0;
 for(const item of items){const stamp=item.sourceVersion||item.version||null,prior=item.reviewRouting,result=prior?.classifierVersion===REVIEW_ROUTING_VERSION&&prior.sourceVersion===stamp&&prior.workflowLabel===(item.workflowLabel||'')&&prior.requiresUpdatedMockup===!!item.requiresUpdatedMockup?prior:{...classifyReviewConversation(item),workflowLabel:item.workflowLabel||'',requiresUpdatedMockup:!!item.requiresUpdatedMockup};item.reviewRouting=result;item.responseGroupId=result.group;counts[result.group]=(counts[result.group]||0)+1;if(result.candidateApproval)candidates++;}
 const summary={total:items.length,counts,candidateApprovals:candidates,needsRoutingReview:counts.other||0,checkedAt:new Date().toISOString(),authority:'Grouping only; no sends, filing, archiving or resolution.'};s.snapshot.reviewRouting=summary;return summary;
}
