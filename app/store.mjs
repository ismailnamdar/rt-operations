import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
export const blank = () => ({version:1,revision:0,users:[],sessions:[],intents:[],printJobs:[],jobs:[],events:[],settings:{autoPrintUPS:true,autoPrintFedEx:true},snapshot:{results:{review:[],questions:[],gallery:[],history:[],alerts:[],updatedAt:new Date().toISOString(),sourceLabel:'Hosted migration — no live accounts connected'},runs:[],pipeline:{orders:[]},unfulfilled:{orders:[],inventoryComplete:false},schedule:{days:[],version:'initial'},expedited:{orders:[]},mockupBatches:{batches:[]},emailTemplates:[],lukasTodos:[]}});
export async function createStore({file=process.env.SHUTTLE_DATA_FILE||'data/state.json',databaseUrl=process.env.DATABASE_URL,schema=null}={}) {
  if(databaseUrl){
    const {Pool}=await import('pg');const pool=new Pool({connectionString:databaseUrl,max:3,idleTimeoutMillis:10000,connectionTimeoutMillis:10000});
    if(schema&&!/^[a-z][a-z0-9_]*$/.test(schema))throw Error('Invalid database schema');
    if(schema)await pool.query('CREATE SCHEMA IF NOT EXISTS '+schema);
    const table=schema?schema+'.shuttle_state':'shuttle_state';
    await pool.query('CREATE TABLE IF NOT EXISTS '+table+' (id integer PRIMARY KEY CHECK(id=1), payload jsonb NOT NULL)');
    if(schema)await pool.query('ALTER TABLE '+table+' ENABLE ROW LEVEL SECURITY');
    await pool.query('INSERT INTO '+table+'(id,payload) VALUES(1,$1) ON CONFLICT DO NOTHING',[blank()]);
    return {read:async()=>structuredClone((await pool.query('SELECT payload FROM '+table+' WHERE id=1')).rows[0].payload),
      transaction:async fn=>{const c=await pool.connect();try{await c.query('BEGIN');const s=(await c.query('SELECT payload FROM '+table+' WHERE id=1 FOR UPDATE')).rows[0].payload;const result=await fn(s);s.revision++;await c.query('UPDATE '+table+' SET payload=$1 WHERE id=1',[s]);await c.query('COMMIT');return structuredClone(result);}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}},close:()=>pool.end()};
  }
  let tail=Promise.resolve();
  async function read(){try{return JSON.parse(await fs.readFile(file,'utf8'));}catch(e){if(e.code==='ENOENT')return blank();throw e;}}
  return {read,transaction:fn=>{const job=tail.then(async()=>{const s=await read(),result=await fn(s);s.revision++;await fs.mkdir(path.dirname(file),{recursive:true,mode:0o700});const temp=file+'.'+randomUUID()+'.tmp';await fs.writeFile(temp,JSON.stringify(s),{mode:0o600});await fs.rename(temp,file);return structuredClone(result);});tail=job.catch(()=>{});return job;},close:async()=>{await tail;}};
}
