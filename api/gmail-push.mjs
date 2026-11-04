import {runtime} from '../app/vercel-runtime.mjs';
import {createGmailPushHandler} from '../app/gmail-push.mjs';
export default {fetch:request=>process.env.SHUTTLE_MIGRATION_STANDBY==='1'?Response.json({error:'Migration standby; retain and retry this delivery.'},{status:503}):createGmailPushHandler({env:process.env,getRuntime:runtime})(request)};
