// Small private operational records. Never copy mailbox/order payloads here.
const publicView=s=>JSON.stringify(Object.fromEntries(['lastScheduledRun','lastLivePrescan'].filter(k=>s[k]).map(k=>[k,Object.fromEntries(Object.entries(s[k]).filter(([field])=>field!=='at'))])));
const allowed=new Set(['scheduledLease','lastScheduledRun','lastLivePrescan','driveFullInventoryAt','driveIntakeCheckAt','storageUpgradeUntil','storageUpgradeReadyAt']);
export async function schedulerStore(pool,table){
 if(!/^(?:[a-z][a-z0-9_]*\.)?shuttle_state$/.test(table))throw Error('Invalid workflow table');
 const side=table+'_scheduler';let existing;
 try{existing=(await pool.query('SELECT c.relrowsecurity AS rls,EXISTS(SELECT 1 FROM '+side+' WHERE id=1) AS seeded FROM pg_catalog.pg_class c WHERE c.oid=to_regclass($1)',[side])).rows[0];}catch(e){if(e.code!=='42P01')throw e;}
 if(!existing)await pool.query('CREATE TABLE IF NOT EXISTS '+side+' (id integer PRIMARY KEY CHECK(id=1),payload jsonb NOT NULL)');
 if(!existing?.rls)await pool.query('ALTER TABLE '+side+' ENABLE ROW LEVEL SECURITY');
 if(!existing?.seeded)await pool.query('INSERT INTO '+side+'(id,payload) VALUES(1,$1::jsonb) ON CONFLICT DO NOTHING',[JSON.stringify({revision:0})]);
 async function read(client=pool,lock=false){const row=(await client.query('SELECT payload FROM '+side+' WHERE id=1'+(lock?' FOR UPDATE':''))).rows[0];if(!row)throw Error('Scheduler records missing');return row.payload;}
 async function transaction(fn){const c=await pool.connect();let discarded=false;
 try{await c.query('BEGIN');await c.query("SET LOCAL lock_timeout='3s'");await c.query("SET LOCAL statement_timeout='8s'");const before=await read(c,true),s=structuredClone(before);
 // Honor a previous deployment's still-active lease without rewriting its state.
 const legacy=(await c.query("SELECT payload->'scheduledLease' AS lease FROM "+table+' WHERE id=1')).rows[0]?.lease;
 if(legacy?.until>Date.now()&&(!s.scheduledLease||legacy.until>s.scheduledLease.until))s.scheduledLease=legacy;
 const baseline=JSON.stringify(s),result=await fn(s);
 if(Object.keys(s).some(k=>k!=='revision'&&k!=='publicRevision'&&!allowed.has(k)))throw Error('Only scheduler metadata may be persisted');
 if(JSON.stringify(s)!==baseline){s.revision=(before.revision||0)+1;s.publicRevision=(before.publicRevision||0)+(publicView(s)!==publicView(before)?1:0);await c.query('UPDATE '+side+' SET payload=$1::jsonb WHERE id=1',[JSON.stringify(s)]);}
 await c.query('COMMIT');return structuredClone(result);
 }catch(e){try{await c.query('ROLLBACK');}catch{discarded=true;c.release(true);}throw e;}finally{if(!discarded)c.release();}}
 async function withScheduler(s){const meta=await read();for(const key of ['lastScheduledRun','lastLivePrescan'])if(meta[key]&&Date.parse(meta[key].at||0)>=Date.parse(s[key]?.at||0))s[key]=meta[key];for(const key of ['driveFullInventoryAt','driveIntakeCheckAt'])if(meta[key]&&Date.parse(meta[key])>=(Date.parse(s[key])||0))s[key]=meta[key];Object.defineProperty(s,'schedulerStorageRevision',{value:meta.publicRevision||0,enumerable:false});return s;}
 return {schedulerTransaction:transaction,withScheduler,schedulerRevision:async()=>Number((await read()).publicRevision||0)};
}
