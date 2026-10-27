import {runtime} from '../app/vercel-runtime.mjs';
import {createShopifyWebhookHandler} from '../app/shopify-webhooks.mjs';
export default {fetch:request=>createShopifyWebhookHandler({env:process.env,getRuntime:runtime})(request)};
