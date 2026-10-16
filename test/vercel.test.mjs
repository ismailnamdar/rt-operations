import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import http from 'node:http';
import {createStore} from '../app/store.mjs';import {createVercelRuntime,validateDeployment} from '../app/vercel-runtime.mjs';
const env={DATABASE_URL:'postgres://not-used-in-this-test',SHUTTLE_ORIGIN:'https://example.invalid',CRON_SECRET:'c'.repeat(64),SHUTTLE_SETUP_TOKEN:'s'.repeat(64),SHUTTLE_OWNER_EMAIL:'owner@example.invalid'};
test('Vercel rejects disk-only persistence and demo deployment',()=>{assert.throws(()=>validateDeployment({...env,DATABASE_URL:''}));assert.throws(()=>validateDeployment({...env,SHUTTLE_DEMO:'1'}));assert.throws(()=>validateDeployment({...env,SHUTTLE_ORIGIN:'http://example.invalid'}));});
test('serverless runtime serves owner setup, isolated staff logins, invites and polling',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'shuttle-vercel-')),store=await createStore({file:path.join(dir,'state.json'),databaseUrl:null});const server=http.createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port,origin='https://127.0.0.1:'+port,base='http://127.0.0.1:'+port,app=await createVercelRuntime({env:{...env,SHUTTLE_ORIGIN:origin},store});server.on('request',app.handler);
 t.after(async()=>{await new Promise(r=>server.close(r));await store.close();await fs.rm(dir,{recursive:true,force:true});});
 assert.equal((await fetch(base+'/setup')).status,200);assert.equal((await fetch(base+'/account.css')).status,200);assert.equal((await fetch(base+'/api/state')).status,401);
 const send=(url,body,headers={})=>fetch(base+url,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',...headers},body:JSON.stringify(body)}),password='a-private-test-password';
 const setup=await send('/auth/bootstrap',{email:env.SHUTTLE_OWNER_EMAIL,password},{Authorization:'Bearer '+env.SHUTTLE_SETUP_TOKEN});assert.equal(setup.status,200);
 const auth=await send('/auth/login',{email:env.SHUTTLE_OWNER_EMAIL,password});assert.equal(auth.status,200);assert.match(auth.headers.get('set-cookie'),/Secure/);const cookie=auth.headers.get('set-cookie').split(';')[0];
 const state=await(await fetch(base+'/api/state',{headers:{Cookie:cookie}})).json();assert.equal(state.hosted.transport,'poll');assert.equal(state.hosted.demo,false);assert.equal(state.users,undefined);assert.equal(state.hosted.gmail.sendingEnabled,false);
 const events=await(await fetch(base+'/api/events',{headers:{Cookie:cookie}})).json();assert.equal(events.transport,'poll');
 const invite=await send('/api/team/invite',{email:'warehouse@example.invalid',role:'warehouse'},{Cookie:cookie,'X-Shuttle-Token':state.token});assert.equal(invite.status,200);assert.match((await invite.json()).url,/\/accept#token=/);
 assert.equal((await send('/api/team/invite',{email:'bad@example.invalid'},{Cookie:cookie})).status,403);
 assert.equal((await fetch(base+'/.env',{headers:{Cookie:cookie}})).status,404);
});
