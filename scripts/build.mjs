import fs from 'node:fs/promises';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..');
for(const name of ['api/index.mjs','api/cron.mjs','api/shopify-webhook.mjs','app/public/index.html','app/public/login.html','app/public/team-ui.js'])await fs.access(path.join(root,name));
await fs.mkdir(path.join(root,'dist'),{recursive:true});
await fs.writeFile(path.join(root,'dist','.gitkeep'),'');
console.log('SHUTTLE serverless files prepared. Private configuration is supplied at runtime.');
