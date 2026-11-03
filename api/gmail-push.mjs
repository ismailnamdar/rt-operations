import {runtime} from '../app/vercel-runtime.mjs';
import {createGmailPushHandler} from '../app/gmail-push.mjs';
export default {fetch:request=>createGmailPushHandler({env:process.env,getRuntime:runtime})(request)};
