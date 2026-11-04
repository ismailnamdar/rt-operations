import {isDeepStrictEqual as equal} from 'node:util';
const maps=[['mail',['gmailConversations']],['carry',['gmailCarryover']],['pending',['gmailSync','pending']],['webhook',['shopifyWebhookReceipts']]];
const arrays=[['job',['jobs']],['review',['snapshot','results','review']],['event',['events']]];
const get=(s,path)=>path.reduce((v,k)=>v?.[k],s);
function put(s,path,value){let parent=s;for(const k of path.slice(0,-1))parent=parent[k]||={};parent[path.at(-1)]=value;}
export function splitRecords(s){const core=structuredClone(s),records={};core.recordCollections={};
 for(const [kind,path]of maps){const values=get(s,path);if(!values||Array.isArray(values)||typeof values!=='object')continue;core.recordCollections[kind]=path;put(core,path,{});for(const [id,value]of Object.entries(values))records[kind+':'+id]={value};}
 for(const [kind,path]of arrays){const values=get(s,path);if(!Array.isArray(values))continue;core.recordCollections[kind]=path;put(core,path,[]);const seen=new Set();for(const [position,value]of values.entries()){let key=typeof value?.id==='string'&&value.id&&!seen.has(value.id)?'id:'+value.id:'position:'+position;seen.add(value?.id);records[kind+':'+key]={position,value};}}
 core.storageVersion=3;return {core,records};}
export function joinRecords(core,records){const s=structuredClone(core);for(const [kind,path]of Object.entries(core.recordCollections||{})){const rows=Object.entries(records).filter(([id])=>id.startsWith(kind+':'));if(arrays.some(([k])=>k===kind))put(s,path,rows.map(([,r])=>r).sort((a,b)=>a.position-b.position).map(r=>structuredClone(r.value)));else put(s,path,Object.fromEntries(rows.map(([id,r])=>[id.slice(kind.length+1),structuredClone(r.value)])));}delete s.recordCollections;return s;}
export function recordStore(pool,table){if(!/^(?:[a-z][a-z0-9_]*\.)?shuttle_state$/.test(table))throw Error('Invalid workflow table');const recordsTable=table+'_records_v3',cache=new Map();let bytes=0;const cap=16*1024*1024;
 function remember(id,revision,payload){const previous=cache.get(id);if(previous){bytes-=previous.bytes;cache.delete(id);}const size=Buffer.byteLength(JSON.stringify(payload));if(size>cap)return;while(bytes+size>cap&&cache.size){const key=cache.keys().next().value;bytes-=cache.get(key).bytes;cache.delete(key);}cache.set(id,{revision,payload:structuredClone(payload),bytes:size});bytes+=size;}
 async function rows(client){const index=(await client.query('SELECT id,revision FROM '+recordsTable)).rows,result={},missing=[];for(const row of index){const saved=cache.get(row.id);if(saved&&String(saved.revision)===String(row.revision))result[row.id]=structuredClone(saved.payload);else missing.push(row.id);}if(missing.length)for(const row of (await client.query('SELECT id,revision,payload FROM '+recordsTable+' WHERE id=ANY($1::text[])',[missing])).rows){result[row.id]=row.payload;remember(row.id,row.revision,row.payload);}if(Object.keys(result).length!==index.length)throw Error('Workflow record coverage incomplete');return result;}
 async function load(client,core){if(core.storageVersion!==3)return core;return joinRecords(core,await rows(client));}
 async function save(client,before,s){const oldRecords=await rows(client),after=splitRecords(s),changed=Object.fromEntries(Object.entries(after.records).filter(([id,v])=>!equal(oldRecords[id],v)));
 if(Object.keys(changed).length)await client.query('INSERT INTO '+recordsTable+'(id,payload) SELECT key,value FROM jsonb_each($1::jsonb) ON CONFLICT(id) DO UPDATE SET payload=EXCLUDED.payload,revision='+recordsTable+'.revision+1',[JSON.stringify(changed)]);
 const removed=Object.keys(oldRecords).filter(id=>!(id in after.records));if(removed.length)await client.query('DELETE FROM '+recordsTable+' WHERE id=ANY($1::text[])',[removed]);
 await client.query('UPDATE '+table+' SET payload=$1::jsonb WHERE id=1',[JSON.stringify(after.core)]);
 }
 async function read(){const c=await pool.connect();try{await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');const core=(await c.query('SELECT payload FROM '+table+' WHERE id=1')).rows[0].payload,s=await load(c,core);await c.query('COMMIT');return s;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}
 async function upgrade(){const c=await pool.connect();try{await c.query('BEGIN');await c.query("SET LOCAL lock_timeout='3s'");await c.query("SET LOCAL statement_timeout='45s'");const s=(await c.query('SELECT payload FROM '+table+' WHERE id=1 FOR UPDATE')).rows[0].payload;if(s.storageVersion===3){await c.query('COMMIT');return {alreadyOptimized:true};}if(s.storageVersion===2)throw Error('Legacy v2 storage needs a separate migration');
 const scheduled=(await c.query('SELECT payload FROM '+table+'_scheduler WHERE id=1 FOR UPDATE')).rows[0]?.payload;
 if(scheduled?.scheduledLease?.until>Date.now()||s.scheduledLease?.until>Date.now()||s.gmailSync?.leaseUntil>Date.now()||(s.jobs||[]).some(j=>['processing','uncertain'].includes(j.status))||(s.prescanJobs||[]).some(j=>j.leaseUntil>Date.now()||['purchasing','booking_uncertain'].includes(j.liveStatus))||(s.printJobs||[]).some(j=>['claimed','printing'].includes(j.status)))throw Object.assign(Error('Active or uncertain work must finish or be reconciled before storage migration. No data changed.'),{status:409});
 const backup=table+'_backup_v3';await c.query('CREATE TABLE IF NOT EXISTS '+backup+' (id integer PRIMARY KEY,payload jsonb NOT NULL)');await c.query('ALTER TABLE '+backup+' ENABLE ROW LEVEL SECURITY');await c.query('INSERT INTO '+backup+'(id,payload) VALUES(1,$1::jsonb) ON CONFLICT DO NOTHING',[JSON.stringify(s)]);if(!(await c.query('SELECT payload=$1::jsonb AS ok FROM '+backup+' WHERE id=1',[JSON.stringify(s)])).rows[0]?.ok)throw Error('Existing backup does not match current state; preserve it and create a separately reviewed backup before migration');
 await c.query('CREATE TABLE IF NOT EXISTS '+recordsTable+' (id text PRIMARY KEY,revision bigint NOT NULL DEFAULT 1,payload jsonb NOT NULL)');await c.query('ALTER TABLE '+recordsTable+' ENABLE ROW LEVEL SECURITY');
 const {core,records}=splitRecords(s);core.revision=(s.revision||0)+1;const restored=joinRecords(core,records);if(!equal(restored,{...s,storageVersion:3,revision:core.revision}))throw Error('Storage roundtrip mismatch');
 await c.query('INSERT INTO '+recordsTable+'(id,payload) SELECT key,value FROM jsonb_each($1::jsonb) ON CONFLICT(id) DO UPDATE SET payload=EXCLUDED.payload,revision='+recordsTable+'.revision+1',[JSON.stringify(records)]);
 const stored=Object.fromEntries((await c.query('SELECT id,payload FROM '+recordsTable)).rows.map(r=>[r.id,r.payload]));if(!(await c.query('SELECT $1::jsonb=$2::jsonb AS ok',[JSON.stringify(joinRecords(core,stored)),JSON.stringify(restored)])).rows[0].ok)throw Error('Stored record verification failed');
 await c.query('CREATE OR REPLACE FUNCTION '+table+`_guard_v3() RETURNS trigger LANGUAGE plpgsql AS $guard$
 DECLARE entry record; path text[]; value jsonb;
 BEGIN IF OLD.payload->>'storageVersion'='3' THEN
 IF NEW.payload->>'storageVersion' IS DISTINCT FROM '3' THEN RAISE EXCEPTION 'Storage migration marker cannot be removed'; END IF;
 FOR entry IN SELECT * FROM jsonb_each(OLD.payload->'recordCollections') LOOP
 SELECT array_agg(v) INTO path FROM jsonb_array_elements_text(entry.value) v;
 value:=NEW.payload #> path;
 IF (jsonb_typeof(value)='object' AND value<>'{}'::jsonb) OR (jsonb_typeof(value)='array' AND value<>'[]'::jsonb) THEN RAISE EXCEPTION 'Legacy workflow writer rejected after migration'; END IF;
 END LOOP; END IF; RETURN NEW; END $guard$`);
 await c.query('CREATE TRIGGER workflow_record_guard_v3 BEFORE UPDATE ON '+table+' FOR EACH ROW EXECUTE FUNCTION '+table+'_guard_v3()');
 await c.query('UPDATE '+table+' SET payload=$1::jsonb WHERE id=1',[JSON.stringify(core)]);await c.query('COMMIT');cache.clear();bytes=0;return {optimized:true,records:Object.keys(records).length,backupCreated:true,revision:core.revision};
 }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}
 async function operational(core){if(core.storageVersion!==3)return core;core.gmailSync||={};core.gmailSync.pending={};core.shopifyWebhookReceipts={};
 for(const row of (await pool.query("SELECT id,jsonb_build_object('error',payload->'value'->'error','providerStatus',payload->'value'->'providerStatus','status',payload->'value'->'status') AS value FROM "+recordsTable+" WHERE id LIKE 'pending:%' OR id LIKE 'webhook:%'")).rows){if(row.id.startsWith('pending:'))core.gmailSync.pending[row.id.slice(8)]=row.value;else core.shopifyWebhookReceipts[row.id.slice(8)]=row.value;}return core;}
 return {load,save,read,upgrade,operational};
}
