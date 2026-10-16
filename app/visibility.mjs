// Limit staff payloads as well as UI controls. Print-station claims never reach browsers.
const publicPrintJob=({claimToken,...job})=>job;
const staffOrder=row=>Object.fromEntries(['order','productionStage','createdAt','fulfillmentStatus','previewUrls','previews','shape','size','quantity','productionId'].filter(k=>row[k]!==undefined).map(k=>[k,row[k]]));
export function visibleSnapshot(snapshot,user){
 snapshot.productionShipping.printJobs=snapshot.productionShipping.printJobs.map(publicPrintJob);
 if(user.role==='owner')return snapshot;
 snapshot.results={...snapshot.results,review:[],questions:[],alerts:[],history:[]};snapshot.runs=[];snapshot.approvalQueue=[];snapshot.lukasTodos=[];snapshot.emailTemplates=[];snapshot.mockupBatches={batches:[]};snapshot.shopifyStatus={configured:snapshot.shopifyStatus.configured,items:{}};
 snapshot.pipeline={orders:(snapshot.pipeline?.orders||[]).map(staffOrder)};snapshot.unfulfilled={orders:(snapshot.unfulfilled?.orders||[]).map(staffOrder),inventoryComplete:false};snapshot.expedited={orders:[]};
 snapshot.productionShipping.intents=snapshot.productionShipping.intents.map(i=>({...i,approved:Object.fromEntries(['id','orders','productionId','units','carrier','service','shipDate','package','previewUrls','proofHash','sourceVersion'].filter(k=>i.approved[k]!==undefined).map(k=>[k,i.approved[k]])),booking:i.booking?Object.fromEntries(['id','tracking','carrier','service','format','isTest'].map(k=>[k,i.booking[k]])):null}));
 return snapshot;
}
