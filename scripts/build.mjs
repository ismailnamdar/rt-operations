import fs from 'node:fs/promises';
import path from 'node:path';
const projectRoot=path.resolve(import.meta.dirname,'..');
for(const name of ['api/index.mjs','api/cron.mjs','api/shopify-webhook.mjs','app/public/index.html','app/public/login.html','app/public/team-ui.js'])await fs.access(path.join(projectRoot,name));
await fs.mkdir(path.join(projectRoot,'dist'),{recursive:true});
await fs.writeFile(path.join(projectRoot,'dist','.gitkeep'),'');
console.log('SHUTTLE serverless files prepared. Private configuration is supplied at runtime.');
