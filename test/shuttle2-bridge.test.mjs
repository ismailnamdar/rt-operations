import test from 'node:test';import assert from 'node:assert/strict';import {Shuttle2Bridge} from '../app/shuttle2-bridge.mjs';
test('bridge restricts targets and forwards exact workflow payload with server-only source token',async()=>{
 const calls=[];const source={token:'source-private-csrf',results:{review:[]},runs:[],connection:{ready:true}};
 const bridge=new Shuttle2Bridge('http://127.0.0.1:43821',{fetchImpl:async(url,options)=>{calls.push({url:String(url),options});return Response.json(String(url).endsWith('/api/state')?source:{run:{id:'kept-by-original-runtime'}});}});
 assert.throws(()=>new Shuttle2Bridge('https://external.example'));assert.throws(()=>new Shuttle2Bridge('http://127.0.0.1:43821/other'));
 const payload={mode:'banda',approvalOnly:true,requestId:'owner-click'};const result=await bridge.request('POST','/api/run',payload);
 assert.equal(result.status,200);assert.equal(calls[1].options.headers['X-Shuttle-Token'],source.token);assert.deepEqual(JSON.parse(calls[1].options.body),payload);assert.equal(bridge.handles('POST','/api/warehouse/book'),false);
 await assert.rejects(bridge.request('POST','http://outside.example/api/run',payload));
});
test('source outage preserves cached unresolved reviews and disables running',async()=>{let offline=false;const bridge=new Shuttle2Bridge('http://127.0.0.1:43821',{fetchImpl:async()=>{if(offline)throw Error('offline');return Response.json({token:'private',results:{review:[{id:'unresolved',status:'pending'}]},runs:[],connection:{ready:true}});}});await bridge.snapshot();offline=true;const value=await bridge.snapshot();assert.equal(value.results.review[0].id,'unresolved');assert.equal(value.connection.ready,false);});
