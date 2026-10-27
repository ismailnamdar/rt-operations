import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import http from 'node:http';
import {resolveOrigins,localOrigins} from '../app/origins.mjs';import {createStore} from '../app/store.mjs';import {hashPassword} from '../app/auth.mjs';import {createServer} from '../app/server.mjs';import {MockCarrier} from '../app/parsel.mjs';
const vercel={VERCEL_PROJECT_PRODUCTION_URL:'shuttle.example',VERCEL_BRANCH_URL:'shuttle-git-feature.vercel.app',VERCEL_URL:'shuttle-abc123.vercel.app'};
test('Vercel URLs are trusted and production is canonical',()=>{
 const o=resolveOrigins(vercel);assert.equal(o.canonical,'https://shuttle.example');assert.deepEqual(o.allowed,['https://shuttle.example','https://shuttle-git-feature.vercel.app','https://shuttle-abc123.vercel.app']);
 assert.equal(resolveOrigins({...vercel,SHUTTLE_ORIGIN:'https://custom.example'}).canonical,'https://custom.example');
 assert.equal(resolveOrigins({VERCEL_URL:'localhost:3000'}).canonical,'http://localhost:3000');
});
test('local defaults need no configuration and remote HTTP is refused',()=>{
 assert.deepEqual(resolveOrigins({},{port:43841}).allowed,localOrigins(43841));assert.ok(localOrigins(5000).includes('http://localhost:5000'));
 assert.equal(resolveOrigins({SHUTTLE_ORIGIN:'http://localhost:8080'},{port:43841}).allowed.length,1);
 assert.throws(()=>resolveOrigins({}));assert.throws(()=>resolveOrigins({SHUTTLE_ORIGIN:'http://shuttle.example'}));assert.throws(()=>resolveOrigins({SHUTTLE_ORIGIN:'https://shuttle.example/app'}));
});
test('preview hosts can sign in while unknown hosts and cross-origin posts are rejected',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'shuttle-origins-')),store=await createStore({file:path.join(dir,'state.json')}),password='a-unique-test-password';await store.transaction(s=>{s.users.push({id:'v',email:'viewer@example.invalid',role:'viewer',passwordHash:hashPassword(password)});return true;});
 const {canonical,allowed}=resolveOrigins(vercel),{server}=await createServer({store,provider:new MockCarrier(),origin:canonical,allowedOrigins:allowed});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(async()=>{await new Promise(r=>server.close(r));await store.close();await fs.rm(dir,{recursive:true,force:true});});
 const send=(host,headers={},body)=>new Promise((resolve,reject)=>{const req=http.request({port:server.address().port,host:'127.0.0.1',path:body?'/auth/login':'/health',method:body?'POST':'GET',headers:{Host:host,...headers}},res=>{res.resume();res.on('end',()=>resolve(res))});req.on('error',reject);req.end(body);});
 assert.equal((await send('evil.example')).statusCode,403);assert.equal((await send('shuttle-abc123.vercel.app')).statusCode,200);
 const body=JSON.stringify({email:'viewer@example.invalid',password}),json={'Content-Type':'application/json'};
 assert.equal((await send('shuttle-git-feature.vercel.app',{...json,Origin:'https://shuttle.example'},body)).statusCode,403);
 const login=await send('shuttle-git-feature.vercel.app',{...json,Origin:'https://shuttle-git-feature.vercel.app'},body);assert.equal(login.statusCode,200);assert.match(login.headers['set-cookie'][0],/Secure/);
});
