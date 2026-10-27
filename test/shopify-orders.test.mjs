import test from 'node:test';import assert from 'node:assert/strict';import {blank} from '../app/store.mjs';import {mergeShopifyOrders} from '../app/shopify-orders.mjs';
const order={id:'gid://shopify/Order/1000',name:'#123',email:'test@example.invalid',customer:{displayName:'Test'},createdAt:'2026-10-15',updatedAt:'2026-10-15',displayFinancialStatus:'PAID',displayFulfillmentStatus:'UNFULFILLED',tags:['VIP'],lineItems:{nodes:[{id:'item',quantity:2}],pageInfo:{hasNextPage:false}}};
test('order import preserves existing artwork, workflow fields and older records',()=>{const s=blank();s.snapshot.pipeline.orders=[{order:'123',previewUrls:['private-artwork-reference'],productionStage:'in production'},{order:'99',note:'keep'}];mergeShopifyOrders(s,[order],{complete:true});assert.equal(s.snapshot.pipeline.orders.length,2);assert.deepEqual(s.snapshot.pipeline.orders[0].previewUrls,['private-artwork-reference']);assert.equal(s.snapshot.pipeline.orders[0].productionStage,'in production');assert.equal(s.shopifyOrderBindings['123'].id,order.id);assert.equal(s.snapshot.pipeline.orders[0].shopifyLineItems[0].quantity,2);});
test('conflicting order identity never silently overwrites its binding',()=>{const s=blank();s.shopifyOrderBindings={'123':{id:'gid://shopify/Order/999'}};assert.throws(()=>mergeShopifyOrders(s,[order]),/Conflicting/);});

test('paginated latest-order import stops at 500 and retains old records',async()=>{
 const {createStore}=await import('../app/store.mjs'),fs=await import('node:fs/promises'),os=await import('node:os'),path=await import('node:path');
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'shuttle-import-')),store=await createStore({file:path.join(dir,'state.json'),databaseUrl:null});
 try{await store.transaction(s=>{s.snapshot.pipeline.orders.push({order:'old',previewUrls:['keep']});});let requests=0;
 const client={request:async(query,{after})=>{const page=Number(after||0);requests++;return {orders:{nodes:Array.from({length:50},(_,i)=>({...order,id:'gid://shopify/Order/'+(page*50+i+1),name:'#'+(page*50+i+1)})),pageInfo:{hasNextPage:true,endCursor:String(page+1)}}};}};
 const {importLatestOrders}=await import('../app/shopify-orders.mjs');const receipt=await importLatestOrders({store,client,pages:20});assert.equal(receipt.imported,500);assert.equal(requests,10);assert.equal((await store.read()).snapshot.pipeline.orders.length,501);await importLatestOrders({store,client,pages:20});assert.equal(requests,10);
 }finally{await store.close();await fs.rm(dir,{recursive:true,force:true});}
});

test('commerce mapping supplies UI fields without inventing workflow and ignores stale updates',()=>{
 const s=blank();mergeShopifyOrders(s,[{...order,updatedAt:'2026-10-26T12:00:00Z',displayFulfillmentStatus:'FULFILLED'}]);
 const row=s.snapshot.unfulfilled.orders[0];assert.equal(row.email,order.email);assert.equal(row.id,order.id);assert.equal(row.financialStatus,'PAID');assert.equal(row.fulfillmentStatus,'FULFILLED');assert.equal(row.category,undefined);assert.equal(row.productionStage,undefined);
 mergeShopifyOrders(s,[{...order,updatedAt:'2026-10-25T12:00:00Z'}]);assert.equal(s.snapshot.unfulfilled.orders[0].fulfillmentStatus,'FULFILLED');
});
test('incremental sync resumes its fixed window after failure, catches older updates, and preserves workflow',async()=>{
 const {syncChangedOrders}=await import('../app/shopify-orders.mjs');let s=blank();s.shopifyOrders={'123':order};s.snapshot.pipeline.orders=[{order:'123',previewUrls:['keep'],productionStage:'in production'}];
 const store={read:async()=>structuredClone(s),transaction:async fn=>fn(s)};let fail=false;const queries=[];
 const client={request:async(_query,v)=>{queries.push(v);if(fail)throw Error('transient');return {orders:{nodes:[{...order,updatedAt:'2026-10-26T12:00:00Z',displayFulfillmentStatus:'FULFILLED'}],pageInfo:{hasNextPage:!v.after,endCursor:'page2'}}};}};
 const now=Date.parse('2026-10-26T13:00:00Z');await syncChangedOrders({store,client,now});const window=structuredClone(s.shopifySync.window);assert.equal(window.cursor,'page2');
 fail=true;await assert.rejects(syncChangedOrders({store,client,now:now+60000}),/transient/);assert.deepEqual(s.shopifySync.window,window);assert.equal(s.shopifySync.lease,undefined);
 fail=false;await syncChangedOrders({store,client,now:now+120000});assert.equal(queries[2].query,queries[0].query);assert.equal(queries[2].after,'page2');assert.equal(s.shopifySync.status,'current');assert.equal(s.shopifySync.window,undefined);assert.equal(s.snapshot.pipeline.orders[0].productionStage,'in production');assert.deepEqual(s.snapshot.pipeline.orders[0].previewUrls,['keep']);
});
