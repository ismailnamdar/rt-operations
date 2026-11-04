const rank={'awaiting mockup':0,'awaiting approval':1,'awaiting production':2,'in production':3,'cutting / stitching / packing':4,'awaiting carrier':5,'in transit':6,delivered:7,'ready for pickup':6,'picked up':7};
const scalarKeys=['shopifyTagAccess'];
const mapKeys=['orderStages','shopifyOrderBindings','shopifyOrders','stageEvidenceReceipts','shopifyStatusSync','carrierStageEvidence'];
const baseKeys=['version','revision','settings','shopifyOrderBindings','shopifyOrders','orderStages','productionFacts','stageEvidenceReceipts','carrierStageEvidence','shopifyStatusSync','shopifyTagAccess','shopifyConnection','intents','redoRequests','productionPrescan','shopifyExpeditedScan','stageCorrections'];
const snapshots=['pipeline','unfulfilled','expedited','productionRuns'];
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const time=v=>Date.parse(v||'')||0;
function stageWinner(core,side){if(!core)return side;if(!side)return core;const newer=time(core.updatedAt)>time(side.updatedAt)?core:side,older=newer===core?side:core;if(newer.source!=='owner_assignment'&&newer.source!=='active_redo'&&(rank[newer.stage]??-1)<(rank[older.stage]??-1))return older;return newer;}
export function overlayStageState(core,side={}){
 const s=core;s.settings||={};if(side.tagSyncEnabled!==undefined)s.settings.shopifyTagSyncEnabled=side.tagSyncEnabled;
 for(const key of mapKeys){if(!side[key])continue;s[key]||={};for(const [id,value]of Object.entries(side[key])){
  if(key==='orderStages')s[key][id]=stageWinner(s[key][id],value);
  else if(key==='shopifyOrders'){if(time(value.updatedAt)>=time(s[key][id]?.updatedAt))s[key][id]=value;}
  else if(key==='shopifyOrderBindings'){if(!s[key][id])s[key][id]=value;}
  else s[key][id]=value;
 }}
 for(const key of scalarKeys)if(side[key]&&time(side[key].checkedAt)>=time(s[key]?.checkedAt))s[key]=side[key];
 if(side.productionFacts){const facts=new Map((s.productionFacts||[]).map(f=>[String(f.order),f]));for(const f of Object.values(side.productionFacts))facts.set(String(f.order),f);s.productionFacts=[...facts.values()];}
 if(side.stageCorrections?.length){const identity=r=>JSON.stringify([r.order,r.at,r.actor,r.to]);const seen=new Set((s.stageCorrections||[]).map(identity));s.stageCorrections=[...(s.stageCorrections||[]),...side.stageCorrections.filter(r=>!seen.has(identity(r)))];}
 if(side.events?.length){const seen=new Set((s.events||[]).map(e=>e.id));s.events=[...(s.events||[]),...side.events.filter(e=>!seen.has(e.id))];}
 if(side.snapshotRows){s.snapshot||={};for(const [group,patches]of Object.entries(side.snapshotRows)){s.snapshot[group]||={orders:[]};s.snapshot[group].orders||=[];for(const [order,patch]of Object.entries(patches)){const row=s.snapshot[group].orders.find(r=>String(r.order)===order);if(row){if(time(row.shopifyUpdatedAt)<=time(patch.shopifyUpdatedAt))Object.assign(row,patch);}else s.snapshot[group].orders.push(structuredClone(patch));}}}
 return s;
}
export async function stageStore(pool,table){
 if(!/^(?:[a-z][a-z0-9_]*\.)?shuttle_state$/.test(table))throw Error('Invalid workflow table');const sideTable=table+'_stages';
 let existing;try{existing=(await pool.query('SELECT c.relrowsecurity AS rls,EXISTS(SELECT 1 FROM '+sideTable+' WHERE id=1) AS seeded FROM pg_catalog.pg_class c WHERE c.oid=to_regclass($1)',[sideTable])).rows[0];}catch(e){if(e.code!=='42P01')throw e;}
 if(!existing)await pool.query('CREATE TABLE IF NOT EXISTS '+sideTable+' (id integer PRIMARY KEY CHECK(id=1),payload jsonb NOT NULL)');
 if(!existing?.rls)await pool.query('ALTER TABLE '+sideTable+' ENABLE ROW LEVEL SECURITY');
 if(!existing?.seeded)await pool.query('INSERT INTO '+sideTable+'(id,payload) VALUES(1,$1) ON CONFLICT DO NOTHING',[JSON.stringify({revision:0})]);
 async function sideRead(client=pool,lock=false){const row=(await client.query('SELECT payload FROM '+sideTable+' WHERE id=1'+(lock?' FOR UPDATE':''))).rows[0];if(!row)throw Error('Private stage records missing');return row.payload;}
 async function baseRead(client=pool){const sql="SELECT COALESCE(jsonb_object_agg(field.key,CASE WHEN field.key='snapshot' THEN COALESCE((SELECT jsonb_object_agg(item.key,item.value) FROM jsonb_each(field.value) item WHERE item.key=ANY($2::text[])),'{}'::jsonb) ELSE field.value END),'{}'::jsonb)||jsonb_build_object('events','[]'::jsonb) AS payload FROM "+table+" CROSS JOIN LATERAL jsonb_each(payload) field WHERE id=1 AND field.key=ANY($1::text[])";return (await client.query({text:sql,values:[[...baseKeys,'snapshot'],snapshots],query_timeout:45000})).rows[0].payload;}
 async function stageRead(){return overlayStageState(await baseRead(),await sideRead());}
 async function stageTransaction(fn){const c=await pool.connect();let discarded=false,phase='stage source read';try{await c.query('BEGIN');await c.query("SET LOCAL lock_timeout='3s'");await c.query("SET LOCAL statement_timeout='40s'");
  const base=await baseRead(c);phase='private stage lock';const side=await sideRead(c,true),before=overlayStageState(base,structuredClone(side)),s=structuredClone(before),result=await fn(s),next=structuredClone(side);
  for(const key of mapKeys)for(const [id,value] of Object.entries(s[key]||{}))if(!same(value,before[key]?.[id])){next[key]||={};next[key][id]=value;}
  for(const key of scalarKeys)if(!same(s[key],before[key]))next[key]=s[key];
  if(!same(s.settings?.shopifyTagSyncEnabled,before.settings?.shopifyTagSyncEnabled))next.tagSyncEnabled=s.settings.shopifyTagSyncEnabled;
  const oldFacts=new Map((before.productionFacts||[]).map(f=>[String(f.order),f]));for(const fact of s.productionFacts||[])if(!same(fact,oldFacts.get(String(fact.order)))){next.productionFacts||={};next.productionFacts[String(fact.order)]=fact;}
  for(const group of ['pipeline','unfulfilled','expedited']){const oldRows=new Map((before.snapshot?.[group]?.orders||[]).map(r=>[String(r.order),r]));for(const row of s.snapshot?.[group]?.orders||[]){const prior=oldRows.get(String(row.order))||{},patch={};for(const [key,value]of Object.entries(row))if(!same(value,prior[key]))patch[key]=value;if(Object.keys(patch).length){next.snapshotRows||={};next.snapshotRows[group]||={};next.snapshotRows[group][String(row.order)]={...next.snapshotRows[group][String(row.order)],order:String(row.order),shopifyUpdatedAt:row.shopifyUpdatedAt,...patch};}}}
  const eventIds=new Set((before.events||[]).map(e=>e.id));const added=(s.events||[]).filter(e=>!eventIds.has(e.id));if(added.length)next.events=[...(next.events||[]),...added];
  const correctionIds=new Set((before.stageCorrections||[]).map(r=>JSON.stringify(r)));const corrections=(s.stageCorrections||[]).filter(r=>!correctionIds.has(JSON.stringify(r)));if(corrections.length)next.stageCorrections=[...(next.stageCorrections||[]),...corrections];
  if(!same(next,side)){phase='private stage update';next.revision=(side.revision||0)+1;await c.query({text:'UPDATE '+sideTable+' SET payload=$1::jsonb WHERE id=1',values:[JSON.stringify(next)],query_timeout:45000});}
  await c.query('COMMIT');return structuredClone(result);
 }catch(e){e.stagePhase||=phase;try{await c.query('ROLLBACK');}catch{discarded=true;c.release(true);}throw e;}finally{if(!discarded)c.release();}}
 async function withStages(core){return overlayStageState(core,await sideRead());}
 return {stageRead,stageTransaction,withStages,stageRevision:async core=>{const n=(await sideRead()).revision||0;return n?String(core)+':'+n:String(core);},shopifyAuthRead:async()=>structuredClone((await pool.query("SELECT jsonb_build_object('shopifyOAuth',payload->'shopifyOAuth','shopifyConnection',payload->'shopifyConnection') AS payload FROM "+table+' WHERE id=1')).rows[0].payload)};
}
