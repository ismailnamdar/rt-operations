// Produces a clean allowlisted staging directory. No local ledgers, secrets or customer data.
import fs from 'node:fs/promises';import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..'),destination=process.argv[2];
if(!destination||!path.isAbsolute(destination))throw Error('Provide an absolute EMPTY staging directory');
try{if((await fs.readdir(destination)).length)throw Error('Staging directory must be empty');}catch(e){if(e.code!=='ENOENT')throw e;}
await fs.mkdir(destination,{recursive:true});
for(const name of ['app','api','scripts'])await fs.cp(path.join(root,name),path.join(destination,name),{recursive:true,filter:source=>!source.endsWith('test-preview.mjs')});
for(const name of ['package.json','vercel.json','.gitignore','.env.example','.vercelignore','DEPLOY-VERCEL.md'])await fs.copyFile(path.join(root,name),path.join(destination,name));
await fs.mkdir(path.join(destination,'test'));
for(const name of await fs.readdir(path.join(root,'test')))if(name.endsWith('.test.mjs')&&name!=='drive-real-data.test.mjs')await fs.copyFile(path.join(root,'test',name),path.join(destination,'test',name));
try{await fs.copyFile(path.join(root,'package-lock.json'),path.join(destination,'package-lock.json'));}catch(e){if(e.code!=='ENOENT')throw e;}
console.log('Clean deployment staging directory created. No environment secrets or local state copied.');
