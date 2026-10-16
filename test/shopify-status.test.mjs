import test from 'node:test';import assert from 'node:assert/strict';
import {blank,createStore} from '../app/store.mjs';import {desiredStatusTags,syncShopifyStatuses} from '../app/shopify-status.mjs';import {stageLabel} from '../app/public/order-stages.js';
import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
test('legacy carrier label, independent hold and redo flags',()=>{const s=blank();s.orderStages={'123':{stage:'awaiting ups'}};s.intents=[{approved:{orders:['123']},redoHold:true}];s.redoRequests=[{orders:['123'],status:'queued'}];assert.equal(stageLabel('awaiting ups'),'Awaiting carrier');assert.deepEqual(desiredStatusTags(s,'123'),['SHUTTLE: Awaiting carrier','SHUTTLE: Hold','SHUTTLE: Redo']);});
test('tag sync preserves unrelated tags, retries uncertain writes, requires identity',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'shuttle-tags-')),store=await createStore({file:path.join(dir,'state.json'),databaseUrl:null});
 try{await store.transaction(s=>{s.orderStages={'123':{stage:'awaiting carrier'}};s.shopifyOrderBindings={'123':{id:'gid://shopify/Order/123',verified:true,verifiedAt:new Date().toISOString()}};});
 let tags=['VIP','SHUTTLE: Awaiting UPS','SHUTTLE: Custom note'],writes=0,uncertain=true;
 const client={order:async id=>({id,name:'#123',tags:[...tags]}),change:async(op,id,values)=>{writes++;tags=op==='tagsAdd'?[...new Set([...tags,...values])]:tags.filter(t=>!values.includes(t));if(uncertain){uncertain=false;throw Error('lost response');}}};
 await syncShopifyStatuses({store,client});assert.equal((await store.read()).shopifyStatusSync['123'].status,'needs_attention');
 await syncShopifyStatuses({store,client});assert.deepEqual(tags,['VIP','SHUTTLE: Custom note','SHUTTLE: Awaiting carrier']);assert.equal((await store.read()).shopifyStatusSync['123'].status,'synced');
 const prior=writes;await syncShopifyStatuses({store,client});assert.equal(writes,prior);
 await store.transaction(s=>{s.shopifyOrderBindings['123'].verified=false;});await syncShopifyStatuses({store,client});assert.equal(writes,prior);
 }finally{await store.close();await fs.rm(dir,{recursive:true,force:true});}
});
