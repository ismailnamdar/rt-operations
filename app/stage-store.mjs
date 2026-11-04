// Stage operations read and patch only their fields in the existing workflow row.
// No migration, second writer, mailbox rewrite or change to other workers' data.
const keys=['version','revision','settings','shopifyOrderBindings','shopifyOrders','orderStages','stageEvidenceReceipts','productionFacts','shopifyStatusSync','shopifyTagAccess','shopifyConnection','intents','redoRequests','productionPrescan','shopifyExpeditedScan','carrierStageEvidence'];
const snapshots=['pipeline','unfulfilled','expedited','productionRuns'];
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export function stageStore(pool,table){
 if(!/^(?:[a-z][a-z0-9_]*\.)?shuttle_state$/.test(table))throw Error('Invalid workflow table');
 // jsonb_each detoasts the large workflow object once; repeated payload->key
 // expressions can repeatedly decompress the whole mailbox for one small read.
 const load=async(client,lock=false)=>{const sql="WITH source AS MATERIALIZED (SELECT payload FROM "+table+" WHERE id=1"+(lock?" FOR UPDATE":"")+") SELECT COALESCE(jsonb_object_agg(field.key,CASE WHEN field.key='snapshot' THEN COALESCE((SELECT jsonb_object_agg(item.key,item.value) FROM jsonb_each(field.value) item WHERE item.key=ANY($2::text[])),'{}'::jsonb) ELSE field.value END),'{}'::jsonb)||jsonb_build_object('events','[]'::jsonb) AS payload FROM source CROSS JOIN LATERAL jsonb_each(source.payload) field WHERE field.key=ANY($1::text[])";const row=(await client.query({text:sql,values:[[...keys,'snapshot'],snapshots],query_timeout:45000})).rows[0];if(!row?.payload?.snapshot)throw Error('Workflow stage record missing');return row.payload;};
 async function transaction(fn){const c=await pool.connect();let discarded=false,phase='stage row read';try{
  await c.query('BEGIN');await c.query("SET LOCAL lock_timeout='3s'");await c.query("SET LOCAL statement_timeout='40s'");
  const before=await load(c,true),s=structuredClone(before),result=await fn(s),patches=[];
  for(const k of keys)if(!['version','revision'].includes(k)&&!same(before[k],s[k]))patches.push({path:[k],value:s[k]??null});
  for(const k of snapshots)if(!same(before.snapshot[k],s.snapshot?.[k]))patches.push({path:['snapshot',k],value:s.snapshot?.[k]??null});
  if(patches.length||s.events.length){
   const root={},snapshot={};for(const patch of patches){if(patch.path.length===1)root[patch.path[0]]=patch.value;else snapshot[patch.path[1]]=patch.value;}
   // Compose a small patch first, then merge the large root exactly once. Nested
   // jsonb_set calls repeatedly copy the entire mailbox blob under the row lock.
   const patch="$1::jsonb || jsonb_build_object('revision',COALESCE((payload->>'revision')::bigint,0)+1)"+" || CASE WHEN $2::jsonb='{}'::jsonb THEN '{}'::jsonb ELSE jsonb_build_object('snapshot',COALESCE(payload->'snapshot','{}'::jsonb)||$2::jsonb) END || CASE WHEN $3::jsonb='[]'::jsonb THEN '{}'::jsonb ELSE jsonb_build_object('events',COALESCE(payload->'events','[]'::jsonb)||$3::jsonb) END";
   phase='stage update';await c.query({text:'UPDATE '+table+' SET payload=payload||('+patch+') WHERE id=1',values:[JSON.stringify(root),JSON.stringify(snapshot),JSON.stringify(s.events)],query_timeout:45000});
  }
  await c.query('COMMIT');return structuredClone(result);
 }catch(e){e.stagePhase||=phase;try{await c.query('ROLLBACK');}catch{discarded=true;c.release(true);}throw e;}finally{if(!discarded)c.release();}}
 return {stageRead:()=>load(pool),stageTransaction:transaction,shopifyAuthRead:async()=>structuredClone((await pool.query("SELECT jsonb_build_object('shopifyOAuth',payload->'shopifyOAuth','shopifyConnection',payload->'shopifyConnection') AS payload FROM "+table+' WHERE id=1')).rows[0].payload)};
}
