import {runtime} from '../app/vercel-runtime.mjs';
import {createShopifyWebhookHandler} from '../app/shopify-webhooks.mjs';
export default {fetch:request=>process.env.SHUTTLE_MIGRATION_STANDBY==='1'?Response.json({error:'Migration standby; retain and retry this delivery.'},{status:503}):createShopifyWebhookHandler({env:process.env,getRuntime:runtime})(request)};
