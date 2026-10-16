import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {createStore} from '../app/store.mjs';import {hashPassword} from '../app/auth.mjs';import {createServer} from '../app/server.mjs';import {MockCarrier} from '../app/parsel.mjs';
test('HTTP authentication, CSRF, viewer restrictions and station isolation',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'shuttle-auth-')),store=await createStore({file:path.join(dir,'state.json')});const password='a-unique-test-password';await store.transaction(s=>{s.users.push({id:'v',email:'viewer@example.invalid',role:'viewer',passwordHash:hashPassword(password)});return true;});
 // Reserve a port before constructing the origin used by strict request checks.
 const {createServer:raw}=await import('node:net');const probe=raw();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));const origin='http://127.0.0.1:'+port;
 const {server}=await createServer({store,provider:new MockCarrier(),origin,demo:true,stationToken:'station-secret'});await new Promise(r=>server.listen(port,'127.0.0.1',r));t.after(async()=>{await new Promise(r=>server.close(r));await store.close();await fs.rm(dir,{recursive:true,force:true});});
 assert.equal((await fetch(origin+'/api/state')).status,401);
 assert.equal((await fetch(origin+'/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'viewer@example.invalid',password})})).status,403);
 const login=await fetch(origin+'/auth/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({email:'viewer@example.invalid',password})});assert.equal(login.status,200);const cookie=login.headers.get('set-cookie').split(';')[0];const state=await(await fetch(origin+'/api/state',{headers:{Cookie:cookie}})).json();
 assert.equal(state.hosted.user.role,'viewer');assert.equal(state.users,undefined);assert.equal(state.sessions,undefined);
 const headers={Origin:origin,'Content-Type':'application/json',Cookie:cookie,'X-Shuttle-Token':state.token};
 assert.equal((await fetch(origin+'/api/demo/load',{method:'POST',headers,body:'{}'})).status,403);
 assert.equal((await fetch(origin+'/api/warehouse/book',{method:'POST',headers,body:'{"id":"S-TEST-100"}'})).status,403);
 assert.equal((await fetch(origin+'/api/station/claim',{method:'POST',headers,body:'{}'})).status,401);
 assert.equal((await fetch(origin+'/api/station/claim',{method:'POST',headers:{Authorization:'Bearer station-secret'}})).status,200);
 const packet=await(await fetch(origin+'/api/live',{headers:{Cookie:cookie}})).json();assert.equal(packet.full.hosted.user.role,'viewer');
});
