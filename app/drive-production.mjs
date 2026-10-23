import {detectProductionRollover} from './control-center.mjs';
import {createHash} from 'node:crypto';
export function productionFile(file){
 const fileName=file.title||file.name||'',name=fileName.replace(/^(?:copy of\s+)+/i,''),match=name.match(/^(\d{4,6})(?=[. _-]|$)/),dimensions=name.match(/^\d{4,6}[. _-](\d+(?:\.\d+)?)(in|ft)?x(\d+(?:\.\d+)?)(in|ft)?/i);
 const size=dimensions?dimensions[1]+(dimensions[2]||'')+'x'+dimensions[3]+(dimensions[4]||''):'Size unverified';
 const shape=/\bcircle\b|\.round\b/i.test(name)?'circle':/\brunner\b/i.test(name)?'runner':/\bcustom\b/i.test(name)?'custom':/\.sq(?:\.|$)|\bsquare\b/i.test(name)?'square':undefined;
 return {id:file.id,order:match?.[1]||null,design:fileName,designId:file.id,sourceFileId:file.id,fileName,size,...(shape?{shape}:{}),quantity:1,quantityVerified:false,previewUrl:'/api/production/preview?id='+encodeURIComponent(file.id),source:'google_drive'};
}
export function importDriveProduction(s,inventory){
 if(!inventory.rootId||!inventory.checkedAt||!Array.isArray(inventory.batches))throw Error('Drive inventory is incomplete');
 const seen=new Set(),runs=[];
 for(const batch of inventory.batches){
  if(!batch.complete||!batch.folder?.id||!(batch.folder.parent_ids||[]).includes(inventory.rootId))throw Error('Production folder parent or coverage is unverified');
  const orders=new Map(),unmatchedFiles=[];
  for(const file of batch.files){
   if(!/^[a-zA-Z0-9_-]+$/.test(file.id)||seen.has(file.id)||!(file.parent_ids||[]).includes(batch.folder.id))throw Error('Drive file identity or membership conflicts');seen.add(file.id);
   const unit=productionFile(file);if(!unit.order){unmatchedFiles.push(unit);continue;}
   if(!orders.has(unit.order))orders.set(unit.order,{order:unit.order,hold:false,source:'google_drive',productionCategory:'orders',rugs:[],intakeUnits:[],previewUrls:[],sourceFileIds:[]});
   const order=orders.get(unit.order);order.rugs.push(unit);order.intakeUnits.push(unit);order.previewUrls.push(unit.previewUrl);order.sourceFileIds.push(file.id);if(/\.exp(?:\.|$)/i.test(unit.fileName))order.productionCategory='expedited';
  }
  // Folder creation is provenance, not proof of a production date.
  runs.push({id:batch.folder.id,name:batch.folder.title||batch.folder.name,folderId:batch.folder.id,folderUrl:batch.folder.url,folderCreatedAt:batch.folder.created_at,source:'google_drive',orders:[...orders.values()].sort((a,b)=>Number(a.order)-Number(b.order)),unmatchedFiles,fileCount:batch.files.length,checkedAt:inventory.checkedAt});
 }
 detectProductionRollover(s,runs,inventory.checkedAt);
 s.snapshot.productionRuns={source:'google_drive',rootId:inventory.rootId,checkedAt:inventory.checkedAt,runs};
 s.snapshot.driveProduction={rootId:inventory.rootId,checkedAt:inventory.checkedAt,fileIds:[...seen],fileCount:seen.size,folderCount:runs.length,unmatchedCount:runs.reduce((n,r)=>n+r.unmatchedFiles.length,0),inventoryHash:createHash('sha256').update(JSON.stringify(inventory)).digest('hex')};
 return {runs:runs.length,files:seen.size,orders:runs.reduce((n,r)=>n+r.orders.length,0),unmatched:s.snapshot.driveProduction.unmatchedCount};
}
