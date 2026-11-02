import test from 'node:test';import assert from 'node:assert/strict';
import {servePublicResource} from '../app/public-resources.mjs';
const env={VERCEL_URL:'shuttle.example',SUPABASE_URL:'https://project.supabase.co',SUPABASE_PUBLISHABLE_KEY:'public-test-key'};
const response=()=>({writeHead(status,headers){this.status=status;this.headers=headers;},end(bytes){this.body=bytes?Buffer.from(bytes).toString():'';}});
test('login, scripts and auth metadata work without database configuration or customer-state access',async()=>{
 for(const url of ['/login','/login.js','/api/index?__shuttle_path=/login','/auth/config']){const res=response();assert.equal(await servePublicResource({method:'GET',url,headers:{host:'shuttle.example'}},res,env),true);assert.equal(res.status,200);assert.equal(res.headers['X-Content-Type-Options'],'nosniff');assert.ok(!res.body.includes(env.SUPABASE_PUBLISHABLE_KEY));}
 const res=response();await servePublicResource({method:'GET',url:'/',headers:{host:'shuttle.example'}},res,env);assert.equal(res.status,302);assert.equal(res.headers.Location,'/login');
});
test('public fast path does not serve private state, HTML dashboard, credentials or authenticated root',async()=>{
 for(const url of ['/api/state','/index.html','/.env','/app/store.mjs','/%2e%2e/.env'])assert.equal(await servePublicResource({method:'GET',url,headers:{host:'shuttle.example'}},response(),env),false);
 assert.equal(await servePublicResource({method:'GET',url:'/',headers:{host:'shuttle.example',cookie:'shuttle_session=existing'}},response(),env),false);
 assert.equal(await servePublicResource({method:'POST',url:'/auth/login',headers:{host:'shuttle.example'}},response(),env),false);
 const res=response();await servePublicResource({method:'GET',url:'/login',headers:{host:'foreign.example'}},res,env);assert.equal(res.status,403);
});
