# SHUTTLE on Vercel — Rugtomize

Standalone staff accounts, direct Shopify server API, Supabase PostgreSQL workflow persistence. Store: `47d43a.myshopify.com`. Initial owner: `info@rugtomize.co`. Use the Vercel production hostname first, then connect `shuttle.rugtomize.co`.

## What this release actually enables

- The existing interface behind individual staff logins, one-time owner setup, private single-use invitations/reset links, CSRF checks, durable sign-in throttling and role-restricted APIs.
- Direct Shopify latest-500 order import with resumable pagination, recent-order refresh, signed webhook intake, queued update reconciliation and optional verified SHUTTLE status tags. Existing workflow fields and old records are not deleted. A new isolated `shuttle_hosted` schema is used; existing Supabase tables/artwork links are NOT read or modified by this deployment. Linking those artwork tables requires inspecting their schema separately.
- Vercel request handlers, 15-second browser polling and minute cron; no local disk state or infinite HTTP connections.
- Existing production/shipping screens and durable state. No synthetic customer data or default accounts are seeded in the Vercel runtime.

This is NOT yet a fully connected live email/artwork/shipping system. Gmail ingestion/labels, exact hosted Banda/GOAT execution, Drive image-sheet ingestion and automatic redo file moves, carrier-event ingestion and the Windows station installation require their remaining adapters and live acceptance tests. Gmail sends and real Parsel purchases are disabled in the Vercel runtime; a credential by itself cannot turn them on. Existing physical printing support still needs Windows setup. Some visible original-interface actions report that their hosted integration is unavailable. Do not interpret deployment success as completion of those integrations.

## 1. Prepare the repository

1. Unzip the clean deployment package locally. Do not put private configuration in this folder.
2. Create a **private GitHub repository** and upload/commit the package contents at its root.
3. In Vercel, choose **Add New → Project → Import Git Repository**.
4. Select the private repository. Framework preset: **Other**. Root directory: repository root. The included `vercel.json` supplies the build command, routes and function settings. Node: **24.x**.
5. Use a Vercel plan that supports minute cron jobs and 120-second functions for this commercial application. Do not invite warehouse staff as paid Vercel developers; their SHUTTLE logins are separate.
6. Note the production hostname assigned by Vercel. You can reserve the project name before deployment. Set `SHUTTLE_ORIGIN` to that exact HTTPS origin, without a path; preview deployments are not automatically trusted production hosts.

## 2. Supabase connection — preserve existing data

1. Open the existing Supabase project and make a backup/export of existing application data and artwork-link tables.
2. Click **Connect → Transaction pooler** and select the PostgreSQL connection string. Serverless connections should use the transaction pooler. Keep it private; it includes a database password.
3. Supply the actual database password and copy the result directly into Vercel as `DATABASE_URL`. Preserve TLS certificate verification (use `sslmode=verify-full` with the appropriate trusted CA when required by the connection). Do not set `rejectUnauthorized=false`.
4. The database role needs permission to create/use the new `shuttle_hosted` schema. On first use the app creates only `shuttle_hosted.shuttle_state`, with row-level security enabled. It does not touch existing public tables. Use a dedicated restricted role for this schema after initial provisioning if your database policies require it; do not expose its credentials in the browser.
5. Do not add `shuttle_hosted` to Supabase's exposed Data API schemas. Access is server-side PostgreSQL only. No Supabase service-role key or frontend database key is needed.
6. Test persistence and a backup restore against a separate test project before using live production records. PostgreSQL TLS/permissions and restore are environment-specific and have not been exercised against your project here.

## 3. Private Vercel environment variables

Open **Project → Settings → Environment Variables**. Add production values. Do not prefix secrets with `NEXT_PUBLIC_` or expose them in browser files.

Required:

| Name | Value/source |
|---|---|
| `SHUTTLE_ORIGIN` | `https://YOUR-PROJECT.vercel.app` |
| `DATABASE_URL` | Private Supabase transaction-pooler connection |
| `CRON_SECRET` | Random secret, at least 32 characters |
| `SHUTTLE_SETUP_TOKEN` | Different random secret, at least 32 characters |
| `SHUTTLE_OWNER_EMAIL` | `info@rugtomize.co` |
| `SHOPIFY_STORE` | `47d43a.myshopify.com` |

Run `node scripts/create-secrets.mjs` locally to generate separate secrets into a mode-0600 `.private/vercel-secrets.env` file. The command prints no secrets. Copy directly from that private file into Vercel; never upload the file or paste its contents into chat. Remove the setup token from Vercel after creating the owner and redeploy.

Shopify credentials (choose one supported route):

- Merchant-owned app in the **same Shopify organization** as this store: `SHOPIFY_CLIENT_ID` and `SHOPIFY_CLIENT_SECRET`. The app must be installed and granted access to this store. The server obtains a short-lived token with client credentials and renews it automatically. Shopify staff login is NOT used for SHUTTLE users.
- An existing installed app's valid Admin API access token: `SHOPIFY_ADMIN_TOKEN`. Do not use a Storefront token. Set `SHOPIFY_WEBHOOK_SECRET` to that app's signing secret when receiving webhooks. Externally distributed apps that cannot use client credentials need an authorization-code connector; that connector is not part of this release.

Set `SHOPIFY_TAG_SYNC=0` for the first read test, then `1` when order mapping and stage values have been checked. This controls only tag writes, not sends or purchases.

`SHUTTLE_STATION_TOKEN` and `SHUTTLE_WORKFLOW_TOKEN` are separate optional integration credentials; leaving them blank disables those endpoints. Parsel credentials/label hostnames can be supplied later, but do not enable booking in this release. Do not connect production secrets to untrusted preview branches.

## 4. Shopify app access

1. Open Shopify's Dev Dashboard and create or select the merchant-owned app for Rugtomize. If you already have an installed integration, inspect its permissions rather than replacing it.
2. Configure the minimum permissions for the implemented fields: order reads, customer reads for the displayed customer identity, and order writes for tags (`read_orders`, `read_customers`, `write_orders`). Do not request marketplace/quick-sale scopes unless those separate features are actually used. Access to orders older than 60 days requires the appropriate all-orders access; otherwise the import will only see accessible orders and must not be described as a complete older history.
3. Install/authorize the app on `47d43a.myshopify.com`. Copy its server credentials directly to Vercel.
4. Configure webhooks for `orders/create`, `orders/updated`, `orders/fulfilled`, `app/uninstalled` at `https://YOUR-PROJECT.vercel.app/api/shopify/webhook`, API version `2026-10`. Use the app's signing secret. Without subscriptions, automatic later updates do not arrive; manual refresh reads only the most recently created 50 orders.
5. Deploy/redeploy after updating environment variables.

No Shopify customer accounts or staff authentication are required for SHUTTLE. Shopify remains the commerce-data source; order import does not infer artwork approval, carrier acceptance or production dates.

## 5. Set up owner and team

1. Visit `https://YOUR-PROJECT.vercel.app/setup` privately.
2. Enter `info@rugtomize.co`, the private setup key from Vercel and a unique password of at least 14 characters.
3. Sign in at `/login`. Setup refuses a second owner bootstrap after the first succeeds.
4. Remove `SHUTTLE_SETUP_TOKEN` from Vercel and redeploy. The owner account persists in Supabase.
5. Click **Team** in the header. Enter each teammate's work email and role. Generate a private invitation link and share it directly with that teammate. The link expires after 24 hours, works once and lets them choose their own password; SHUTTLE sends no invitation email itself.
6. Ahmad and Bryan: **Warehouse**, no flag-manager permission. Other staff: assign Viewer or Warehouse according to operational need and flag-manager permission as authorized. Owner grants financial/email privileges through existing owner-only controls; flag permission is stored for the forthcoming flag UI, not an automatic purchase permission.
7. Use **Reset existing password** to generate a private reset link. Accepting it revokes existing sessions. Keep another trusted owner account for recovery. Owner recovery without a second owner currently requires a database administrator; public self-service reset and MFA enrollment are not implemented in this release.

## 6. Import and verify

1. Sign in as owner and click **Import Shopify orders**. Each request imports up to 50; minute cron resumes remaining pages up to 500. With fewer accessible orders it stops at available records.
2. Open **Orders**. Compare a few order numbers, purchased quantities, payment/fulfillment fields with Shopify. Production stages remain unverified until actual workflow evidence exists.
3. Verify artwork links in existing Supabase tables are unchanged. This deployment does not automatically merge those external tables into the new schema.
4. Confirm cron execution at **Vercel → Project → Cron Jobs / Functions logs**. Cron requires the matching secret header; unauthenticated calls fail.
5. Enable `SHOPIFY_TAG_SYNC=1` and redeploy after checking mappings/stages. Writes preserve unrelated tags and verify readback. Do not manually create a stage merely to make the sync look successful.
6. Verify account roles, disabled-account behavior, CSRF, no public `.env` access, no secrets/customer data in logs, correct webhook signatures, duplicate delivery handling and persistent data across redeployment.

The app uses the existing `SHUTTLE: <stage>` convention plus independent Hold and Redo tags. `Awaiting carrier` supersedes `Awaiting UPS`. Label booking does not prove carrier acceptance; Shopify fulfillment alone does not manufacture tracking scans.

## 7. Connect your custom domain later

Add `shuttle.rugtomize.co` in Vercel's Domains settings and follow the exact DNS record Vercel provides. Preserve Shopify storefront/email records. Once HTTPS works, change `SHUTTLE_ORIGIN`, update Shopify webhook URLs and redeploy. Keep a single canonical application origin; staff should use the new address after cutover.

## Testing and limits

`npm ci`, `npm run build`, `npm test`. Tests use isolated fake providers and local ledgers, not your Shopify store or Supabase project. No deployment or real store mutation has been performed by generating this package. Live Vercel routing, Supabase TLS/permissions, app authorization, webhook subscriptions and backup restore require checking in your accounts. Review function/database logs without logging request bodies, passwords, tokens or private connection strings.

The current persistence layer serializes state changes into one transaction-locked JSON row. That preserves existing local behavior for this small team, but should be normalized into job/order tables as retained event and order volumes grow. Keep Shopify update subscriptions enabled; manually refreshing the latest 50 does not cover changes to older orders.

Official references:
- https://vercel.com/docs/functions/runtimes/node-js
- https://vercel.com/docs/cron-jobs/manage-cron-jobs
- https://supabase.com/docs/guides/database/connecting-to-postgres/serverless-drivers
- https://shopify.dev/docs/apps/build/authentication-authorization/client-credentials-grant
- https://shopify.dev/docs/api/admin-graphql/latest/queries/orders
