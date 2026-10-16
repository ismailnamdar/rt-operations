import test from 'node:test';import assert from 'node:assert/strict';import {createShopifyConnection} from '../app/shopify-connection.mjs';
test('server-to-server Shopify grant caches token and never needs staff Shopify login',async()=>{
 let grants=0,calls=0;const client=createShopifyConnection({SHOPIFY_STORE:'test-shop.myshopify.com',SHOPIFY_CLIENT_ID:'test-id',SHOPIFY_CLIENT_SECRET:'test-secret'},{fetchImpl:async(url,options)=>{if(url.endsWith('/oauth/access_token')){grants++;assert.match(options.body.toString(),/grant_type=client_credentials/);return Response.json({access_token:'private-test-token',expires_in:86399});}calls++;assert.equal(options.headers['X-Shopify-Access-Token'],'private-test-token');return Response.json({data:{order:{id:'gid://shopify/Order/1',name:'#1',tags:[]}}});}});
 await Promise.all([client.order('gid://shopify/Order/1'),client.order('gid://shopify/Order/1')]);assert.equal(grants,1);assert.equal(calls,2);
});
