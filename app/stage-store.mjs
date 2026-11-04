// Stage operations read and patch only their fields in the existing workflow row.
// No migration, second writer, mailbox rewrite or change to other workers' data.
const keys=['version','revision','settings','shopifyOrderBindings','shopifyOrders','orderStages','stageEvidenceReceipts','productionFacts','shopifyStatusSync','shopifyTagAccess','shopifyConnection','intents','redoRequests','productionPrescan','shopifyExpeditedScan','carrierStageEvidence'];
const snapshots=['pipeline','unfulfilled','expedited','productionRuns'];
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export function stageStore(pool,table){
 if(!/^(?:[a-z][a-z0-9_]*\.)?shuttle_state$/.test(table))throw Error('Invalid workflow table');
 const projection=`jsonb_build_object(${keys.map(k=>`'${k}',payload->'${k}'`).join(',')},'snapshot',jsonb_build_object(${snapshots.map(k=>`'${k}',payload#>'{snapshot,${k}}'`).join(',')}),'events','[]'::jsonb)`;
 const load=async(client,lock=false)=>{const row=(await client.query('SELECT '+projection+' AS payload FROM '+table+' WHERE id=1'+(lock?' FOR UPDATE':''))).rows[0];if(!row)throw Error('Workflow stage record missing');return row.payload;};
 async function transaction(fn){const c=await pool.connect();let discarded=false;try{
  await c.query('BEGIN');await c.query("SET LOCAL lock_timeout='3s'");await c.query("SET LOCAL statement_timeout='8s'");
  const before=await load(c,true),s=structuredClone(before),result=await fn(s),patches=[];
  for(const k of keys)if(!['version','revision'].includes(k)&&!same(before[k],s[k]))patches.push({path:[k],value:s[k]??null});
  for(const k of snapshots)if(!same(before.snapshot[k],s.snapshot?.[k]))patches.push({path:['snapshot',k],value:s.snapshot?.[k]??null});
  if(patches.length||s.events.length){let expression='payload';const args=[];for(const patch of patches){args.push(patch.path,JSON.stringify(patch.value));expression=`jsonb_set(${expression},$${args.length-1}::text[],$${args.length}::jsonb,true)`;}
   if(s.events.length){args.push(JSON.stringify(s.events));expression=`jsonb_set(${expression},'{events}',COALESCE(payload->'events','[]'::jsonb)||$${args.length}::jsonb,true)`;}
   expression=`jsonb_set(${expression},'{revision}',to_jsonb(COALESCE((payload->>'revision')::bigint,0)+1),true)`;await c.query('UPDATE '+table+' SET payload='+expression+' WHERE id=1',args);
  }
  await c.query('COMMIT');return structuredClone(result);
 }catch(e){try{await c.query('ROLLBACK');}catch{discarded=true;c.release(true);}throw e;}finally{if(!discarded)c.release();}}
 return {stageRead:()=>load(pool),stageTransaction:transaction,shopifyAuthRead:async()=>structuredClone((await pool.query("SELECT jsonb_build_object('shopifyOAuth',payload->'shopifyOAuth','shopifyConnection',payload->'shopifyConnection') AS payload FROM "+table+' WHERE id=1')).rows[0].payload)};
}
