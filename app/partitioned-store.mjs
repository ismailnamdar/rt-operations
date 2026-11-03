// Opt-in normalized persistence. Run the supplied offline migration before enabling.
// Core workflow updates retain their existing serialization; authentication has
// an independent lock, and only changed conversation/job/review records are saved.
const authKeys=['users','sessions','loginAttempts'];
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const authOf=s=>Object.fromEntries(authKeys.filter(k=>s[k]!==undefined).map(k=>[k,s[k]]));
export function splitState(s){
 const core=structuredClone(s),records={};
 records['auth:staff']=authOf(core);for(const k of authKeys)delete core[k];
 for(const [id,value] of Object.entries(core.gmailConversations||{}))records['mail:'+id]={value};delete core.gmailConversations;
 for(const [kind,rows] of [['job',core.jobs||[]],['review',core.snapshot?.results?.review||[]]]){
  for(const [position,value] of rows.entries()){if(!value.id||records[kind+':'+value.id])throw Error('Cannot partition missing or duplicate record identities');records[kind+':'+value.id]={position,value};}
 }
 delete core.jobs;delete core.snapshot.results.review;core.storageVersion=2;return {core,records};
}
export function joinState(core,records){
 const s=structuredClone(core);Object.assign(s,records['auth:staff']);s.gmailConversations={};s.jobs=[];s.snapshot.results.review=[];
 for(const [id,row] of Object.entries(records))if(id.startsWith('mail:'))s.gmailConversations[id.slice(5)]=row.value;
 for(const [kind,dest] of [['job',s.jobs],['review',s.snapshot.results.review]])dest.push(...Object.entries(records).filter(([id])=>id.startsWith(kind+':')).map(([,row])=>row).sort((a,b)=>a.position-b.position).map(row=>row.value));
 return s;
}
export async function migratePartitionedStorage(pool,table){
 if(!/^[a-z][a-z0-9_]*\.shuttle_state$/.test(table))throw Error('Use a private named workflow schema');
 const c=await pool.connect();try{
  await c.query('BEGIN');await c.query("SET LOCAL lock_timeout='3s'");await c.query("SET LOCAL statement_timeout='8s'");
  const s=(await c.query('SELECT payload FROM '+table+' WHERE id=1 FOR UPDATE')).rows[0].payload;
  if(s.storageVersion===2){await c.query('COMMIT');return {alreadyMigrated:true};}
  if(s.scheduledLease?.until>Date.now()||s.gmailSync?.leaseUntil>Date.now()||(s.prescanJobs||[]).some(j=>['purchasing','booking_uncertain'].includes(j.liveStatus))||(s.jobs||[]).some(j=>['processing','uncertain'].includes(j.status)))throw Error('Stop active executors and reconcile uncertain actions before migration.');
  const backup=table+'_migration_backup',recordsTable=table+'_records';
  await c.query('CREATE TABLE IF NOT EXISTS '+backup+' (id integer PRIMARY KEY,payload jsonb NOT NULL)');await c.query('ALTER TABLE '+backup+' ENABLE ROW LEVEL SECURITY');await c.query('INSERT INTO '+backup+'(id,payload) VALUES(1,$1) ON CONFLICT DO NOTHING',[s]);
  await c.query('CREATE TABLE IF NOT EXISTS '+recordsTable+' (id text PRIMARY KEY,payload jsonb NOT NULL)');await c.query('ALTER TABLE '+recordsTable+' ENABLE ROW LEVEL SECURITY');
  const {core,records}=splitState(s);if(!equal(joinState(core,records),{...s,gmailConversations:s.gmailConversations||{},storageVersion:2})){
   // Object key order is immaterial; compare each restored field recursively via JSONB.
   const match=(await c.query('SELECT $1::jsonb=$2::jsonb AS ok',[joinState(core,records),{...s,gmailConversations:s.gmailConversations||{},storageVersion:2}])).rows[0].ok;if(!match)throw Error('Partition roundtrip verification failed');
  }
  await c.query('INSERT INTO '+recordsTable+'(id,payload) SELECT key,value FROM jsonb_each($1::jsonb) ON CONFLICT(id) DO UPDATE SET payload=EXCLUDED.payload',[JSON.stringify(records)]);
  await c.query('UPDATE '+table+' SET payload=$1 WHERE id=1',[core]);await c.query('COMMIT');return {migrated:true,records:Object.keys(records).length,backup};
 }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
}
export async function partitionedStore(pool,table){
 if(!/^(?:[a-z][a-z0-9_]*\.)?shuttle_state$/.test(table))throw Error('Invalid storage table');const recordsTable=table+'_records';
 const marker=(await pool.query('SELECT payload->>\'storageVersion\' AS version FROM '+table+' WHERE id=1')).rows[0]?.version;
 if(marker!=='2')throw Error('Partitioned storage requires the verified offline migration first.');
 async function load(client,lock=false){
  const core=(await client.query('SELECT payload FROM '+table+' WHERE id=1'+(lock?' FOR UPDATE':''))).rows[0].payload;
  if(core.storageVersion!==2)throw Error('Storage migration marker changed; stop and reconcile older executors.');
  const rows=(await client.query('SELECT id,payload FROM '+recordsTable)).rows,records=Object.fromEntries(rows.map(r=>[r.id,r.payload]));if(!records['auth:staff'])throw Error('Staff records unavailable');return {core,records};
 }
 async function transaction(fn,authOnly=false){
  const c=await pool.connect();let discarded=false;
  try{
   await c.query('BEGIN');await c.query("SET LOCAL lock_timeout='3s'");await c.query("SET LOCAL statement_timeout='8s'");
   let before,s;if(authOnly){const row=(await c.query('SELECT payload FROM '+recordsTable+" WHERE id='auth:staff' FOR UPDATE")).rows[0];if(!row)throw Error('Staff records unavailable');s=structuredClone(row.payload);before={records:{'auth:staff':row.payload}};}else{before=await load(c,true);s=joinState(before.core,before.records);}
   const result=await fn(s);let after;
   if(authOnly)after={records:{'auth:staff':authOf(s)}};else{s.revision++;after=splitState(s);}
   const changes=Object.fromEntries(Object.entries(after.records).filter(([id,value])=>!equal(value,before.records[id])));
   if(!authOnly&&changes['auth:staff']){const current=(await c.query('SELECT payload FROM '+recordsTable+" WHERE id='auth:staff' FOR UPDATE")).rows[0]?.payload;if(!equal(current,before.records['auth:staff']))throw Error('Staff state changed concurrently; retry the authorized change.');}
   if(Object.keys(changes).length)await c.query('INSERT INTO '+recordsTable+'(id,payload) SELECT key,value FROM jsonb_each($1::jsonb) ON CONFLICT(id) DO UPDATE SET payload=EXCLUDED.payload',[JSON.stringify(changes)]);
   if(!authOnly){const removed=Object.keys(before.records).filter(id=>!(id in after.records));if(removed.length)await c.query('DELETE FROM '+recordsTable+' WHERE id=ANY($1::text[])',[removed]);await c.query('UPDATE '+table+' SET payload=$1 WHERE id=1',[after.core]);}
   await c.query('COMMIT');return structuredClone(result);
  }catch(e){try{await c.query('ROLLBACK');}catch{discarded=true;c.release(true);}throw e;}finally{if(!discarded)c.release();}
 }
 return {read:async()=>{const c=await pool.connect();try{await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');const {core,records}=await load(c);await c.query('COMMIT');return joinState(core,records);}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}},transaction:fn=>transaction(fn),authRead:async()=>structuredClone((await pool.query('SELECT payload FROM '+recordsTable+" WHERE id='auth:staff'")).rows[0].payload),authTransaction:fn=>transaction(fn,true),revision:async()=>String((await pool.query("SELECT payload->>'revision' AS revision FROM "+table+' WHERE id=1')).rows[0].revision),close:()=>pool.end()};
}
