import {Pool} from 'pg';
import {migratePartitionedStorage} from '../app/partitioned-store.mjs';
if(process.env.CONFIRM_WORKFLOW_MIGRATION!=='executors-stopped')throw Error('Pause old and new executors first; then set CONFIRM_WORKFLOW_MIGRATION=executors-stopped.');
if(!process.env.DATABASE_URL)throw Error('Supply DATABASE_URL privately in the environment.');
let connectionString=process.env.DATABASE_URL,ssl;
if(process.env.DATABASE_CA_CERT){const url=new URL(connectionString);for(const k of [...url.searchParams.keys()])if(k.startsWith('ssl'))url.searchParams.delete(k);connectionString=url.href;ssl={ca:process.env.DATABASE_CA_CERT.replace(/\\n/g,'\n'),rejectUnauthorized:true};}
const pool=new Pool({connectionString,ssl,max:1,connectionTimeoutMillis:5000,query_timeout:10000});
try{console.log(JSON.stringify(await migratePartitionedStorage(pool,'shuttle_hosted.shuttle_state')));}finally{await pool.end();}
