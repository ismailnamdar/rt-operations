import {createHash} from 'node:crypto';
import {redoFilename} from './drive-redo.mjs';
import {importDriveProduction} from './drive-production.mjs';

export function driveContentHash(batches){return createHash('sha256').update(JSON.stringify(batches.map(b=>({id:b.folder.id,title:b.folder.title||b.folder.name,parents:[...(b.folder.parent_ids||[])].sort(),created:b.folder.created_at||null,files:b.files.map(f=>({id:f.id,title:f.title||f.name,parents:[...(f.parent_ids||[])].sort(),updated:f.updated_at||null})).sort((a,b)=>a.id.localeCompare(b.id))})).sort((a,b)=>a.id.localeCompare(b.id)))).digest('hex');}
async function persistInventory(store,{rootId,batches,full=false,expectedHash}){
 const checkedAt=new Date().toISOString(),contentHash=driveContentHash(batches);
 const result=await store.transaction(s=>{
  if(expectedHash!==undefined&&s.snapshot.driveProduction?.inventoryHash!==expectedHash)throw Error('Drive inventory changed during intake check; retry next sync');
  if(s.snapshot.driveProduction?.rootId===rootId&&s.snapshot.driveProduction?.contentHash===contentHash)return {unchanged:true,runs:batches.length,files:batches.reduce((n,b)=>n+b.files.length,0)};
  const result=importDriveProduction(s,{rootId,checkedAt,batches});s.snapshot.driveProduction.contentHash=contentHash;return result;
 });
 // Check freshness is operational metadata, not a reason to rewrite every rug.
 const save=store.schedulerTransaction||store.transaction;await save(s=>{if(full)s.driveFullInventoryAt=checkedAt;else s.driveIntakeCheckAt=checkedAt;});return result;
}

const ROOT='1m2aiQXNJ9a_n3Mr12VU4W2OCZSYiLAeR';
export class GoogleDriveProduction{
 constructor({clientId,clientSecret,refreshToken,fetchImpl=fetch,rootId=ROOT,writeEnabled=false}){Object.assign(this,{clientId,clientSecret,refreshToken,fetch:fetchImpl,rootId,writeEnabled});this.previews=new Map();}
 configured(){return !!(this.clientId&&this.clientSecret&&this.refreshToken);}
 async token(){if(!this.configured())throw Error('Read-only Google Drive authorization is not configured');if(this.cachedToken?.until>Date.now()+60000)return this.cachedToken.value;const response=await this.fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'refresh_token',client_id:this.clientId,client_secret:this.clientSecret,refresh_token:this.refreshToken}),signal:AbortSignal.timeout(10000),redirect:'error'});if(!response.ok)throw Error('Google Drive authorization needs attention');const result=await response.json();if(!result.access_token)throw Error('Google Drive token unavailable');this.cachedToken={value:result.access_token,until:Date.now()+(result.expires_in||3600)*1000};return result.access_token;}
 async get(route,query={}){const url=new URL('https://www.googleapis.com/drive/v3/'+route);for(const [k,v] of Object.entries(query))url.searchParams.set(k,String(v));const response=await this.fetch(url,{headers:{Authorization:'Bearer '+await this.token()},signal:AbortSignal.timeout(10000),redirect:'error'});if(!response.ok)throw Error('Google Drive read failed');return response.json();}
 async children(parent,filter){if(!/^[a-zA-Z0-9_-]+$/.test(parent))throw Error('Invalid Drive parent');const files=[];let pageToken;do{const page=await this.get('files',{q:`'${parent}' in parents and trashed = false and (${filter})`,pageSize:1000,fields:'nextPageToken,incompleteSearch,files(id,name,mimeType,parents,size,createdTime,modifiedTime)',supportsAllDrives:true,includeItemsFromAllDrives:true,...(pageToken?{pageToken}:{})});if(page.incompleteSearch||!Array.isArray(page.files))throw Error('Drive folder inventory incomplete');files.push(...page.files);pageToken=page.nextPageToken;}while(pageToken);return files;}
 async sync(store){const folders=(await this.children(this.rootId,"mimeType = 'application/vnd.google-apps.folder'")).filter(f=>/^pro\s*[_-]?\s*\d+$/i.test(f.name)),batches=[];
  for(const folder of folders){const files=await this.children(folder.id,"mimeType contains 'image/' or mimeType = 'application/pdf'");batches.push({complete:true,folder:{id:folder.id,title:folder.name,parent_ids:folder.parents,created_at:folder.createdTime,url:'https://drive.google.com/drive/folders/'+folder.id},files:files.map(f=>({id:f.id,title:f.name,mime_type:f.mimeType,parent_ids:f.parents,size:f.size,created_at:f.createdTime,updated_at:f.modifiedTime}))});}
  return persistInventory(store,{rootId:this.rootId,batches,full:true});
 }
 async syncIntake(store,runId=null){
  const current=await store.read(),runs=current.snapshot.productionRuns?.runs||[],target=runs.find(r=>r.id===(runId||current.settings.upcomingProductionRunId));
  if(!target?.folderId||current.snapshot.driveProduction?.rootId!==this.rootId)return {waitingForInventory:true};
  const folder=await this.get('files/'+target.id,{fields:'id,parents,trashed',supportsAllDrives:true});if(folder.trashed||!folder.parents?.includes(this.rootId))throw Error('Upcoming production folder is outside verified intake');
  const files=await this.children(target.id,"mimeType contains 'image/' or mimeType = 'application/pdf'");
  const batches=runs.map(run=>({complete:true,folder:{id:run.id,title:run.name,parent_ids:[this.rootId],created_at:run.folderCreatedAt,url:run.folderUrl},files:run.id===target.id?files.map(f=>({id:f.id,title:f.name,parent_ids:f.parents,updated_at:f.modifiedTime})):run.orders.flatMap(o=>o.rugs).concat(run.unmatchedFiles||[]).map(f=>({id:f.sourceFileId||f.id,title:f.fileName,parent_ids:[run.id],updated_at:f.sourceModifiedAt}))}));
  return persistInventory(store,{rootId:this.rootId,batches,expectedHash:current.snapshot.driveProduction.inventoryHash});
 }
 async returnRedoFile({fileId,folderId}){
  if(!this.writeEnabled)throw Error('Drive write authorization is required');
  if(![fileId,folderId,this.rootId].every(id=>/^[a-zA-Z0-9_-]+$/.test(id)))throw Error('Invalid Drive identity');
  const fields='id,name,parents,trashed',meta=await this.get('files/'+fileId,{fields,supportsAllDrives:true});
  if(meta.id!==fileId||meta.trashed||!meta.parents?.some(p=>p===folderId||p===this.rootId))throw Error('Redo artwork is outside its verified production location');
  const name=redoFilename(meta.name);if(!(meta.parents.includes(this.rootId)&&!meta.parents.includes(folderId)&&meta.name===name)){
   const url=new URL('https://www.googleapis.com/drive/v3/files/'+fileId);url.searchParams.set('supportsAllDrives','true');url.searchParams.set('fields',fields);if(!meta.parents.includes(this.rootId))url.searchParams.set('addParents',this.rootId);if(meta.parents.includes(folderId))url.searchParams.set('removeParents',folderId);
   const response=await this.fetch(url,{method:'PATCH',headers:{Authorization:'Bearer '+await this.token(),'Content-Type':'application/json'},body:JSON.stringify({name}),redirect:'error',signal:AbortSignal.timeout(15000)});if(!response.ok)throw Error('Redo file update failed');
  }
  const verified=await this.get('files/'+fileId,{fields,supportsAllDrives:true});if(verified.id!==fileId||verified.trashed||verified.name!==name||verified.parents?.length!==1||verified.parents[0]!==this.rootId)throw Error('Redo file move or rename is not verified');
  this.previews.delete(fileId);return {fileId,name,parents:verified.parents,fromFolderId:folderId};
 }
 async preview(id,inventory,folderIds){if(!inventory?.fileIds.includes(id))throw Error('Preview is outside the production inventory');const cached=this.previews.get(id);if(cached?.until>Date.now())return cached;
  const metadata=await this.get('files/'+encodeURIComponent(id),{fields:'id,parents,thumbnailLink',supportsAllDrives:true});if(metadata.id!==id||!metadata.parents?.some(parent=>parent===this.rootId||folderIds.includes(parent)))throw Error('Artwork is no longer in a production folder');if(!metadata.thumbnailLink)throw Error('Drive thumbnail is unavailable');const url=new URL(metadata.thumbnailLink);if(url.protocol!=='https:'||url.username||url.password||!(url.hostname==='googleusercontent.com'||url.hostname.endsWith('.googleusercontent.com')))throw Error('Untrusted thumbnail host');
  const response=await this.fetch(url,{headers:{Authorization:'Bearer '+await this.token()},signal:AbortSignal.timeout(10000),redirect:'error'}),type=response.headers.get('content-type')?.split(';')[0];if(!response.ok||!['image/jpeg','image/png','image/webp'].includes(type))throw Error('Thumbnail could not be read');let size=0;const chunks=[];for await(const chunk of response.body){size+=chunk.length;if(size>4*1024*1024)throw Error('Thumbnail exceeds preview size limit');chunks.push(Buffer.from(chunk));}const result={bytes:Buffer.concat(chunks),type,until:Date.now()+5*60000};if(this.previews.size>=100)this.previews.delete(this.previews.keys().next().value);this.previews.set(id,result);return result;
 }
}
