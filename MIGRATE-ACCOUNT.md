# Move SHUTTLE to the owner's accounts

Authorized destination: Supabase sfjjhpfurijeotfdpbmr (Rugtomize organization), Vercel team rug7, existing repository ismailnamdar/rt-operations main. The current production project dfkqyubbgggpcuuuegnz and existing deployment must remain available until verified cutover. Do not create a fork or replace main with an old ZIP.

## Before destination deployment

- Use a Vercel plan that supports the commercial app and its minute cron. Current destination is Hobby. The owner must complete any paid plan upgrade/terms acceptance.
- Import the existing GitHub repository through the Git provider's repository list. Account currently has the GitHub identity Rugtomize connected, but repository-level Vercel app access still needs verification. Pasting the repository URL led to a clone flow; do not create a duplicate repository accidentally.
- Framework Other; root repository root; Node 24.x; build/output/routes supplied by vercel.json.
- Add SHUTTLE_MIGRATION_STANDBY=1 to destination Production and Preview before the first deployment. This blocks cron, business POST actions, worker/station claims, OAuth callbacks and webhook intake until cutover. It does not alter the source live deployment.

## Preserve data before switching

Use Supabase's supported backup/restore procedure with access to both source and target. Preserve schema definitions, data, roles/policies as applicable, and all custom schemas, especially every table in shuttle_hosted. Include shuttle_state, shuttle_state_records_v3, shuttle_state_auth, shuttle_state_stages, shuttle_state_scheduler and migration backups/triggers. Include unique public artwork-link tables if present. Keep source backups private and outside Git. Restore into the new project and independently compare row counts, record identities, JSON data and workflow receipts before enabling operations.

Preserve Supabase Auth users/identities and their UUIDs through the supported Auth migration process; do not silently clear or rebind existing supabaseId values. Copying workflow tables alone does not migrate staff authentication. Existing access tokens/sessions are project-specific: staff may need to sign in again. Project Auth settings, signup restrictions, redirect URLs and email/SMTP settings need separate verification. Any actual Supabase Storage objects require a separate object transfer; database metadata alone is not the files. Drive-hosted artwork remains linked to its existing files and permissions.

## Destination environment

Change only project-specific values:
SUPABASE_URL=https://sfjjhpfurijeotfdpbmr.supabase.co
SUPABASE_PUBLISHABLE_KEY=[new project's publishable key, entered privately]
DATABASE_URL=[new project's private PostgreSQL transaction-pooler URL]
DATABASE_CA_CERT=[new project's appropriate CA certificate]
SHUTTLE_OWNER_EMAIL=info@rugtomize.co
SHUTTLE_MIGRATION_STANDBY=1
SHUTTLE_PARTITIONED_STORAGE=0

Copy required source configuration securely from the existing deployment owner: CRON_SECRET, Shopify client configuration/scopes, SHOPIFY_TOKEN_ENCRYPTION_KEY, Gmail and Drive OAuth settings, Parsel token/settings, station and workflow authorization where used. Keep the exact encryption key required to decrypt imported Shopify OAuth records; generating a replacement key without token recovery would break that connection. No secrets in chat, Git, screenshots or frontend variables. Scope destination Preview to standby and an isolated database.

## Cutover gate

Verify restored storage reports version 3; owner login and role restrictions; review/order/production counts and previews; existing tags, holds, approvals, redos and label receipts; fresh Gmail/Shopify/Parsel reads. New deployment origin must be known before updating OAuth callbacks and webhook/push destinations. Do not infer working sends, label purchases or physical printing from a successful build.

Pause old external executors and source cron at a coordinated point, reconcile in-flight/uncertain writes, take a final consistent delta/backup and restore/verify it. Never run two independent databases against the same business workflows. Only after verification remove destination standby and point callbacks/webhooks/station/worker to the new origin. Preserve rollback source; do not delete old data or revoke keys during this first transfer.

Official migration reference: https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore
