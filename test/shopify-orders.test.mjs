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
