# Faster synchronization rollout

The normal deployment immediately enables four concurrent Gmail reads, up to 80 conversations per pass within the existing 45-second budget, grouped persistence, new-history priority even during backfill, shared OAuth/label lookups, concurrent prescan and a five-second visible-tab refresh. All unread and carryover coverage remains required. Failures retain independent retry state. This does not enable sends, buy labels, or start another automation. The existing minute cron remains the recovery executor. Shopify webhook receipts are handled in batches up to 20 per pass; verified changes merge through the same business rules.

## Independent workflow records

The partitioned adapter separates staff/session records, individual Gmail conversations, workflow jobs and review records. Authentication can read/write its own small row without the workflow lock; ordinary workflow updates write only changed conversation/job/review rows. Existing Supabase tables outside the private `shuttle_hosted` schema are untouched.

Activation is an operational cutover, not part of an ordinary deployment:

1. Pause old/new cron and other executors and drain in-flight requests. Reconcile uncertain purchases/sends first. Do not run old code after migration.
2. Take a normal database backup. With private database environment variables loaded, run `CONFIRM_WORKFLOW_MIGRATION=executors-stopped node scripts/migrate-workflow-storage.mjs`. It also preserves the original entire state in the RLS-protected `shuttle_hosted.shuttle_state_migration_backup` table and verifies a JSONB roundtrip before commit. Nothing is added to exposed Supabase API schemas.
3. Set `SHUTTLE_PARTITIONED_STORAGE=1` for the deployment, redeploy, and verify staff login, counts, drafts, receipts and a read-only sync. Leave the existing database URL/CA unchanged.
4. Resume one executor deployment only. Rollback after new writes requires reconciling the new record tables; never restore an old snapshot over later receipts or simply turn the flag off.

This flag is off by default. Do not apply the migration while any old deployment still has active database writers.

## Gmail change notifications

Google setup requires access to the Google Cloud project that owns the Gmail OAuth client. Current documentation: https://developers.google.com/workspace/gmail/api/guides/push and https://docs.cloud.google.com/pubsub/docs/authenticate-push-subscriptions .

1. Enable Cloud Pub/Sub in that same project and create a topic, for example `shuttle-gmail`.
2. Grant only `Pub/Sub Publisher` on that topic to `gmail-api-push@system.gserviceaccount.com`.
3. Create a dedicated push-authentication service account, with no unrelated project roles. Configure the Pub/Sub service agent's required token-creation permission for that account according to Google's authenticated-push guide.
4. Create a push subscription to `https://YOUR-PRODUCTION-HOST/api/gmail/push`, with authentication enabled, that service account, and the exact endpoint URL as audience. Use an acknowledgement deadline sufficient for the bounded sync request (for example 60 seconds). Never put credentials in the URL.
5. Set these private deployment settings: `GMAIL_PUSH_TOPIC=projects/PROJECT/topics/shuttle-gmail`, `GMAIL_PUSH_SUBSCRIPTION=projects/PROJECT/subscriptions/SUBSCRIPTION`, `GMAIL_PUSH_AUDIENCE=https://YOUR-PRODUCTION-HOST/api/gmail/push`, `GMAIL_PUSH_SERVICE_ACCOUNT=ACCOUNT@PROJECT.iam.gserviceaccount.com`.
6. Redeploy. The existing cron renews the whole-mailbox Gmail watch daily. The watch does not restrict to Inbox and does not replace unread/backfill/carryover discovery. Signed notifications are checked for signature, issuer, expiration, audience, exact service-account identity, subscription and mailbox. They persist a receipt before requesting work through the existing Gmail lease; they never advance its cursor by themselves.
7. Send an ordinary test email yourself and verify receipt, thread discovery and review appearance. Retain minute polling to recover missed notifications.

## Shopify webhook activation

The existing owner **Connect Shopify webhooks** control registers/recovers the configured store's subscriptions. Verify the HMAC-authenticated delivery receipt before calling it live. Never register the same business workflow on two active deployments sharing the same store/database. Use the canonical production hostname; callbacks and environment variables are not copied automatically when importing into another Vercel account.
