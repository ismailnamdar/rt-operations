import fs from 'node:fs/promises';import path from 'node:path';import {randomBytes} from 'node:crypto';
const directory=path.resolve(import.meta.dirname,'../.private');await fs.mkdir(directory,{recursive:true,mode:0o700});const file=path.join(directory,'vercel-secrets.env');
await fs.writeFile(file,['CRON_SECRET','SHUTTLE_SETUP_TOKEN','SHUTTLE_STATION_TOKEN','SHUTTLE_WORKFLOW_TOKEN'].map(k=>k+'='+randomBytes(32).toString('hex')).join('\n')+'\n',{mode:0o600,flag:'wx'});
console.log('Private keys saved to .private/vercel-secrets.env. Copy values directly into Vercel; never into chat. Existing files are never overwritten.');
