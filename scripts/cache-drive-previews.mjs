import fs from 'node:fs/promises';import {createWriteStream} from 'node:fs';import {Readable,Transform} from 'node:stream';import {pipeline} from 'node:stream/promises';import {spawn} from 'node:child_process';import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..'),manifest=JSON.parse(await fs.readFile(path.join(root,'.private','drive-preview-downloads.json'),'utf8')),output=path.join(root,'data','drive-previews'),temporary=path.join(root,'.private','drive-preview-downloads');
let index=0,done=0;const results=[];
await Promise.all(Array.from({length:3},async()=>{while(index<manifest.length){const source=manifest[index++];if(!/^[a-zA-Z0-9_-]+$/.test(source.id))throw Error('Invalid preview identity');const target=path.join(output,source.id+'.jpg'),original=path.join(temporary,source.id+'.source');
 try{
  try{const stat=await fs.stat(target);if(stat.size>50){results.push({id:source.id,status:'cached'});done++;continue;}}catch{}
  if(source.error||!source.url)throw Error('Drive download unavailable');const url=new URL(source.url);if(url.protocol!=='https:'||!url.hostname.endsWith('.oaiusercontent.com'))throw Error('Untrusted preview source');
  const response=await fetch(url,{signal:AbortSignal.timeout(120000),redirect:'error'});if(!response.ok)throw Error('Preview download failed');let bytes=0;
  const limit=new Transform({transform(chunk,encoding,callback){bytes+=chunk.length;if(bytes>110*1024*1024)return callback(Error('Preview source exceeds size limit'));callback(null,chunk);}});
  await pipeline(Readable.fromWeb(response.body),limit,createWriteStream(original,{mode:0o600}));
  await new Promise((resolve,reject)=>{const child=spawn('/usr/bin/sips',['-Z','320','-s','format','jpeg',original,'--out',target],{stdio:'ignore'}),timer=setTimeout(()=>{child.kill('SIGKILL');reject(Error('Preview conversion timed out'));},90000);child.on('error',e=>{clearTimeout(timer);reject(e);});child.on('exit',code=>{clearTimeout(timer);code===0?resolve():reject(Error('Preview conversion failed'));});});
  await fs.chmod(target,0o600);results.push({id:source.id,status:'cached'});
 }catch{await fs.rm(target,{force:true});results.push({id:source.id,status:'needs_attention'});}
 finally{await fs.rm(original,{force:true});}
 done++;if(done%25===0)console.log(JSON.stringify({previews:done,total:manifest.length,failed:results.filter(r=>r.status==='needs_attention').length}));
}}));
await fs.writeFile(path.join(root,'data','drive-preview-cache-report.json'),JSON.stringify({checkedAt:new Date().toISOString(),results},null,2),{mode:0o600});console.log(JSON.stringify({complete:done,cached:results.filter(r=>r.status==='cached').length,failed:results.filter(r=>r.status==='needs_attention').length}));
