import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
const root=path.resolve(import.meta.dirname,'..');
for(const name of ['api/index.mjs','api/cron.mjs','api/shopify-webhook.mjs','app/public/index.html','app/public/login.html','app/public/team-ui.js'])await fs.access(path.join(root,name));
// Validate source without initializing databases or calling live integrations.
// Previously the build only checked file existence, hiding module errors until
// Vercel's function-packaging step or the first live request.
let modules=0;
for(const dir of ['api','app']){
 for(const name of await fs.readdir(path.join(root,dir),{recursive:true})){
  if(!/\.(?:mjs|js)$/.test(name))continue;
  execFileSync(process.execPath,['--check',path.join(root,dir,name)],{stdio:'pipe'});
  modules++;
 }
}
for(const name of ['index','cron','shopify-webhook','gmail-push'])await import(new URL('../api/'+name+'.mjs',import.meta.url));
console.log(`SHUTTLE preflight passed: ${modules} source modules and all 4 function import graphs. No provider calls made.`);
await fs.mkdir(path.join(root,'dist'),{recursive:true});
await fs.writeFile(path.join(root,'dist','.gitkeep'),'');
console.log('SHUTTLE serverless files prepared. Private configuration is supplied at runtime.');
