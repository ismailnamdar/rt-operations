import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';
import {createStore} from '../app/store.mjs';import {bootstrapOwner,inviteUser,acceptInvitation} from '../app/accounts.mjs';import {login,sessionFor} from '../app/auth.mjs';
test('one-time owner setup, invitation roles, single-use reset and durable login limits',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'shuttle-accounts-')),store=await createStore({file:path.join(dir,'state.json'),databaseUrl:null}),password='a-long-private-password';
 try{
 const config={setupToken:'s'.repeat(64),ownerEmail:'owner@example.invalid'};
 await assert.rejects(bootstrapOwner(store,{email:config.ownerEmail,password,token:'wrong'},config));
 await bootstrapOwner(store,{email:config.ownerEmail,password,token:config.setupToken},config);
 await assert.rejects(bootstrapOwner(store,{email:config.ownerEmail,password,token:config.setupToken},config),/already complete/);
 const owner=(await store.read()).users[0];
 await assert.rejects(inviteUser(store,{role:'warehouse'},{email:'team@example.invalid'},'https://example.invalid'));
 const invite=await inviteUser(store,owner,{email:'team@example.invalid',role:'warehouse'},'https://example.invalid'),token=new URLSearchParams(new URL(invite.url).hash.slice(1)).get('token');
 assert.equal(JSON.stringify(await store.read()).includes(token),false);
 await acceptInvitation(store,{token,password});await assert.rejects(acceptInvitation(store,{token,password}),/invalid or expired/);
 const signed=await login(store,'team@example.invalid',password);assert.equal(signed.user.role,'warehouse');assert.ok(sessionFor(await store.read(),signed.token));
 const reset=await inviteUser(store,owner,{email:'team@example.invalid',purpose:'reset',role:'owner'},'https://example.invalid');await acceptInvitation(store,{token:new URLSearchParams(new URL(reset.url).hash.slice(1)).get('token'),password:password+'-new'});
 assert.equal(sessionFor(await store.read(),signed.token),null);assert.equal((await store.read()).users.find(u=>u.email==='team@example.invalid').role,'warehouse');
 for(let i=0;i<10;i++)await assert.rejects(login(store,'owner@example.invalid','wrong'));
 await assert.rejects(login(store,'owner@example.invalid',password),e=>e.status===429);
 }finally{await store.close();await fs.rm(dir,{recursive:true,force:true});}
});
