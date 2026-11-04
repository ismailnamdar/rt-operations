// Online auth sidecar: staff authorization remains in the original workflow
// record. Session/rate-limit writes never lock or rewrite the email/production
// payload. Legacy sessions remain valid until expiry or explicit revocation.
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export async function createAuthSidecar(pool,table){
 if(!/^(?:[a-z][a-z0-9_]*\.)?shuttle_state$/.test(table))throw Error('Invalid workflow table');
 const authTable=table+'_auth';
 let existing;try{existing=(await pool.query('SELECT c.relrowsecurity AS rls,EXISTS(SELECT 1 FROM '+authTable+' WHERE id=1) AS seeded FROM pg_catalog.pg_class c WHERE c.oid=to_regclass($1)',[authTable])).rows[0];}catch(e){if(e.code!=='42P01')throw e;}
 if(!existing)await pool.query('CREATE TABLE IF NOT EXISTS '+authTable+' (id integer PRIMARY KEY CHECK(id=1),payload jsonb NOT NULL)');
 if(!existing?.rls)await pool.query('ALTER TABLE '+authTable+' ENABLE ROW LEVEL SECURITY');
 if(!existing?.seeded)await pool.query('INSERT INTO '+authTable+'(id,payload) VALUES(1,$1) ON CONFLICT DO NOTHING',[{sessions:[],revoked:{},loginAttempts:null}]);
 async function legacy(client){const s=(await client.query("SELECT jsonb_build_object('users',payload->'users','sessions',payload->'sessions','loginAttempts',payload->'loginAttempts') AS payload FROM "+table+' WHERE id=1')).rows[0]?.payload;if(!Array.isArray(s?.users)||!Array.isArray(s?.sessions))throw Error('Staff authorization is unavailable');return s;}
 function combine(core,side){const revoked=side.revoked||{},sessions=new Map();for(const session of [...core.sessions,...side.sessions||[]])if(session.expiresAt>Date.now()&&!revoked[session.hash])sessions.set(session.hash,session);return {users:structuredClone(core.users),sessions:[...sessions.values()],loginAttempts:structuredClone(side.loginAttempts??core.loginAttempts??{})};}
 async function authRead(){
  // One SQL snapshot prevents a concurrent logout from being missed between reads.
  const row=(await pool.query("SELECT jsonb_build_object('users',w.payload->'users','sessions',w.payload->'sessions','loginAttempts',w.payload->'loginAttempts') AS core,a.payload AS side FROM "+table+' w CROSS JOIN '+authTable+' a WHERE w.id=1 AND a.id=1')).rows[0];if(!row)throw Error('Staff authorization is unavailable');return combine(row.core,row.side);
 }
 async function authTransaction(fn){
  const c=await pool.connect();let discarded=false;
  try{await c.query('BEGIN');await c.query("SET LOCAL lock_timeout='3s'");await c.query("SET LOCAL statement_timeout='8s'");const side=(await c.query('SELECT payload FROM '+authTable+' WHERE id=1 FOR UPDATE')).rows[0].payload,core=await legacy(c),s=combine(core,side),before=structuredClone(s.sessions),usersBefore=structuredClone(s.users);const result=await fn(s);
   if(!equal(usersBefore,s.users)){
    // First owner bootstrap or first identity binding only. Existing staff logins
    // take the sidecar lock alone; roles never come from editable user metadata.
    const current=(await c.query("SELECT payload->'users' AS users FROM "+table+' WHERE id=1 FOR UPDATE')).rows[0]?.users;if(!equal(current,usersBefore))throw Error('Staff access changed; retry sign-in');await c.query("UPDATE "+table+" SET payload=jsonb_set(payload,'{users}',$1::jsonb) WHERE id=1",[JSON.stringify(s.users)]);
   }
   const revoked=Object.fromEntries(Object.entries(side.revoked||{}).filter(([,expires])=>expires>Date.now())),remaining=new Set(s.sessions.map(x=>x.hash));for(const session of before)if(!remaining.has(session.hash))revoked[session.hash]=session.expiresAt;
   await c.query('UPDATE '+authTable+' SET payload=$1 WHERE id=1',[{sessions:s.sessions.filter(x=>x.expiresAt>Date.now()),loginAttempts:s.loginAttempts,revoked}]);await c.query('COMMIT');return structuredClone(result);
  }catch(e){try{await c.query('ROLLBACK');}catch{discarded=true;c.release(true);}throw e;}finally{if(!discarded)c.release();}
 }
 return {authRead,authTransaction};
}
