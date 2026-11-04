import {schedulerStore} from './scheduler-store.mjs';
import {stageStore} from './stage-store.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {createAuthSidecar} from './auth-store.mjs';
import {partitionedStore} from './partitioned-store.mjs';
export const blank = () => ({version:1,revision:0,users:[],sessions:[],intents:[],printJobs:[],jobs:[],events:[],settings:{upcomingProductionRunId:'1nOvYd0k_GgVfUcRVckBpMG1NvHVTiqgC',autoPrintUPS:true,autoPrintFedEx:true},snapshot:{results:{review:[],questions:[],gallery:[],history:[],alerts:[],updatedAt:new Date().toISOString(),sourceLabel:'Hosted migration — no live accounts connected'},runs:[],pipeline:{orders:[]},unfulfilled:{orders:[],inventoryComplete:false},schedule:{days:[],version:'initial'},expedited:{orders:[]},mockupBatches:{batches:[]},emailTemplates:[],lukasTodos:[]}});
export async function initializeWorkflowTable(pool,schema){
 if(schema&&!/^[a-z][a-z0-9_]*$/.test(schema))throw Error('Invalid database schema');
 const table=schema?schema+'.shuttle_state':'shuttle_state';let existing;
 try{existing=(await pool.query('SELECT c.relrowsecurity AS rls, EXISTS(SELECT 1 FROM '+table+' WHERE id=1) AS seeded FROM pg_catalog.pg_class c WHERE c.oid=to_regclass($1)',[table])).rows[0];}catch(error){if(!['42P01','3F000'].includes(error.code))throw error;}
 // ALTER TABLE acquires a strong lock even when RLS is already enabled. Normal
 // cold starts must use a metadata read instead of repeating migration DDL.
 if(!existing){if(schema)await pool.query('CREATE SCHEMA IF NOT EXISTS '+schema);await pool.query('CREATE TABLE IF NOT EXISTS '+table+' (id integer PRIMARY KEY CHECK(id=1), payload jsonb NOT NULL)');}
 if(schema&&!existing?.rls)await pool.query('ALTER TABLE '+table+' ENABLE ROW LEVEL SECURITY');
 if(!existing?.seeded)await pool.query('INSERT INTO '+table+'(id,payload) VALUES(1,$1) ON CONFLICT DO NOTHING',[blank()]);
 return table;
}
export async function createStore({file=process.env.SHUTTLE_DATA_FILE||'data/state.json',databaseUrl=process.env.DATABASE_URL,databaseCa=process.env.DATABASE_CA_CERT,schema=null,partitioned=process.env.SHUTTLE_PARTITIONED_STORAGE==='1'}={}) {
  if(databaseUrl){
    // A provided CA enforces verified TLS; URL ssl* parameters would otherwise override it in pg.
    let connectionString=databaseUrl,ssl;if(databaseCa){const url=new URL(databaseUrl);for(const k of [...url.searchParams.keys()])if(k.startsWith('ssl'))url.searchParams.delete(k);connectionString=url.href;ssl={ca:databaseCa.replace(/\\n/g,'\n'),rejectUnauthorized:true};}
    const {Pool}=await import('pg');const pool=new Pool({connectionString,ssl,max:3,idleTimeoutMillis:10000,connectionTimeoutMillis:5000,query_timeout:10000});
    let table;try{table=await initializeWorkflowTable(pool,schema);}catch(error){await pool.end().catch(()=>{});throw error;}
    if(partitioned)try{return await partitionedStore(pool,table);}catch(error){await pool.end().catch(()=>{});throw error;}
    let auth;try{auth=await createAuthSidecar(pool,table);}catch(error){await pool.end().catch(()=>{});throw error;}
    let stages;try{stages=await stageStore(pool,table);}catch(error){await pool.end().catch(()=>{});throw error;}let scheduler;try{scheduler=await schedulerStore(pool,table);}catch(error){await pool.end().catch(()=>{});throw error;}return {...auth,...stages,...scheduler,revision:async()=>{const base=await stages.stageRevision((await pool.query("SELECT payload->>'revision' AS revision FROM "+table+' WHERE id=1')).rows[0].revision),n=await scheduler.schedulerRevision();return base+(n?'~'+n:'');},read:async()=>scheduler.withScheduler(await stages.withStages(structuredClone((await pool.query('SELECT payload FROM '+table+' WHERE id=1')).rows[0].payload))),
      transaction:fn=>workflowTransaction(pool,table,fn),close:()=>pool.end()};
  }
  let tail=Promise.resolve();
  async function read(){try{return JSON.parse(await fs.readFile(file,'utf8'));}catch(e){if(e.code==='ENOENT')return blank();throw e;}}
  return {read,transaction:fn=>{const job=tail.then(async()=>{const s=await read(),before=JSON.stringify(s),result=await fn(s);if(JSON.stringify(s)===before)return structuredClone(result);s.revision++;await fs.mkdir(path.dirname(file),{recursive:true,mode:0o700});const temp=file+'.'+randomUUID()+'.tmp';await fs.writeFile(temp,JSON.stringify(s),{mode:0o600});await fs.rename(temp,file);return structuredClone(result);});tail=job.catch(()=>{});return job;},close:async()=>{await tail;}};
}

export async function workflowTransaction(pool,table,fn){const c=await pool.connect();let discarded=false;try{await c.query('BEGIN');await c.query("SET LOCAL lock_timeout='3s'");await c.query("SET LOCAL statement_timeout='8s'");const s=(await c.query('SELECT payload FROM '+table+' WHERE id=1 FOR UPDATE')).rows[0].payload;const before=JSON.stringify(s),result=await fn(s);if(JSON.stringify(s)===before){await c.query('COMMIT');return structuredClone(result);}s.revision++;await c.query('UPDATE '+table+' SET payload=$1 WHERE id=1',[s]);await c.query('COMMIT');return structuredClone(result);}catch(e){try{await c.query('ROLLBACK');}catch{discarded=true;c.release(true);throw e;}throw e;}finally{if(!discarded)c.release();}}
