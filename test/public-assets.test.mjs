import test from 'node:test';import assert from 'node:assert/strict';import {createServer} from '../app/server.mjs';
test('compiled assets load without reading private workflow data; API data still requires authentication',async t=>{
 let reads=0;const store={read:async()=>{reads++;return {users:[],sessions:[]};}};const app=await createServer({store,origin:'http://localhost'});
 async function get(url){let status,headers,body;await app.handler({method:'GET',url,headers:{host:'localhost'}},{setHeader(){},writeHead(s,h){status=s;headers=h;},end(b){body=b;}});return {status,headers,body};}
 for(const name of ['app.js','startup-guard.js','gideon-gold.svg','login.js'])assert.equal((await get('/'+name)).status,200);assert.equal(reads,0);
 assert.equal((await get('/api/state')).status,401);assert.equal(reads,1);await new Promise(resolve=>app.server.close(resolve));
});
