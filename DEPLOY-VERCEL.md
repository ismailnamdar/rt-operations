# Supabase Auth update — staff sign-in

This update supersedes the custom-password owner setup and invitation steps below. Hosted SHUTTLE now uses Supabase email/password authentication, verified server-side on protected requests. Old local-password sessions cannot bypass Supabase. The local demo remains explicitly separate.

1. In your existing Supabase project, find the project URL and publishable key. Save them in Vercel as `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY`. An existing anon key can be supplied as `SUPABASE_ANON_KEY` for compatibility. Never use a service-role key for this login flow.
2. Retain `DATABASE_URL` for private server-side workflow persistence. Auth keys do not replace the database connection.
3. In Supabase Authentication, disable public signups for this staff-only app. Create/verify the initial owner identity `info@rugtomize.co` using the dashboard's supported user setup flow. Keep passwords private. SHUTTLE grants the configured owner email initial owner access only when no owner already exists. Existing users retain their app roles; a disabled user cannot log in.
4. Redeploy only after credentials and owner access are ready. Without Auth configuration, login fails closed rather than falling back to demo or custom passwords.
5. To add teammates, authorize their exact work email and role from SHUTTLE Team accounts, then provision that same verified identity/password in Supabase Authentication → Users. Existing legacy passwords do not migrate. Password setup/recovery is currently managed in Supabase; the old SHUTTLE reset-link route is disabled in this mode.
6. Test owner/warehouse/viewer sign-in, authorization and logout. Current sessions last up to one hour (or the provider's shorter lifetime), then require sign-in again. Background token refresh and self-service recovery UI are not included in this first adapter.

No Supabase project, auth user, password, policy or existing database record is changed by preparing this source update. The application binds verified Supabase identities to existing SHUTTLE records without replacing workflow data.

---

# SHUTTLE on Vercel — Rugtomize

## October 16 interface merge

SHUTTLE 2.0 is now the interface base for Home, Review, Orders, Mock-ups and Agents/History. The preview's Production run/order page is retained within Production. The separate Label Booker page, shortcut and agent card are removed. The original calendar controls remain on Production. Local compatibility uses the existing loopback SHUTTLE 2.0 runtime for real saved reviews and exact agent actions; Vercel does NOT use that local bridge. Its workflow execution integrations remain explicitly incomplete below. Do not describe a deployed UI as an exact cloud-hosted Hunt/GOAT engine.


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
6. Keep **Settings → Environment Variables → Automatically expose System Environment Variables** enabled. SHUTTLE trusts the production domain (`VERCEL_PROJECT_PRODUCTION_URL`), the branch alias (`VERCEL_BRANCH_URL`) and the deployment's own URL (`VERCEL_URL`), so preview links work without extra configuration. Shopify OAuth, webhook registration and invitation links always use the production domain. Previews use whatever `DATABASE_URL` is scoped to the Preview environment; scope a separate database there unless previews should act on live data, and keep Deployment Protection enabled for previews.

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
| `DATABASE_URL` | Private Supabase transaction-pooler connection |
| `DATABASE_CA_CERT` | Supabase SSL certificate (PEM text from Database Settings → SSL Configuration); enables verified TLS |
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

Add `shuttle.rugtomize.co` in Vercel's Domains settings and follow the exact DNS record Vercel provides. Preserve Shopify storefront/email records. Once HTTPS works, make it the primary production domain (or set the optional `SHUTTLE_ORIGIN` override to its exact HTTPS origin), redeploy and re-run webhook setup so Shopify points at the new address. Keep a single canonical application origin; staff should use the new address after cutover.

## Testing and limits

`npm ci`, `npm run build`, `npm test`. Tests use isolated fake providers and local ledgers, not your Shopify store or Supabase project. No deployment or real store mutation has been performed by generating this package. Live Vercel routing, Supabase TLS/permissions, app authorization, webhook subscriptions and backup restore require checking in your accounts. Review function/database logs without logging request bodies, passwords, tokens or private connection strings.

The current persistence layer serializes state changes into one transaction-locked JSON row. That preserves existing local behavior for this small team, but should be normalized into job/order tables as retained event and order volumes grow. Keep Shopify update subscriptions enabled; manually refreshing the latest 50 does not cover changes to older orders.

Official references:
- https://vercel.com/docs/functions/runtimes/node-js
- https://vercel.com/docs/cron-jobs/manage-cron-jobs
- https://supabase.com/docs/guides/database/connecting-to-postgres/serverless-drivers
- https://shopify.dev/docs/apps/build/authentication-authorization/client-credentials-grant
- https://shopify.dev/docs/api/admin-graphql/latest/queries/orders


## Read-only Production folder synchronization (October 16)

Production is populated from the actual `Pro N` folders directly under DONE READY 4 PRINT (`1m2aiQXNJ9a_n3Mr12VU4W2OCZSYiLAeR`). Runs use immutable folder IDs. Every image/PDF file keeps its own Drive ID and preview. Files without an identifiable order number remain visible as exceptions; filename quantity suffixes do not establish verified physical/shipping quantities. Folder creation dates are not assigned as production dates. Generic inbox-review holds are not applied as production redo holds. No files are moved and no sharing permissions are changed.

The local preview currently has an authenticated October 16 snapshot of Pro 1–5: 527 private cached previews, including two first-page PDF previews. This cache and its source inventory are deliberately excluded from the deployment ZIP.

For hosted refresh:

1. Enable Google Drive API in the Google Cloud project and use the existing web OAuth client's exact loopback callback `http://127.0.0.1:43842/oauth/google/callback`.
2. Privately configure the helper's `GMAIL_CLIENT_ID` and `GMAIL_CLIENT_SECRET`, set `GMAIL_CONNECT_MODE=drive_read_only`, then run `node app/connect-google.mjs` locally. Authorize `info@rugtomize.co`. This mode requests only Drive read-only access, verifies the account via Drive and stores a protected token in `data/drive-credentials.json`. It does not send email or modify Drive.
3. Copy the client ID, client secret and saved refresh token directly into Vercel's private `GDRIVE_CLIENT_ID`, `GDRIVE_CLIENT_SECRET`, `GDRIVE_REFRESH_TOKEN` variables. Do not upload the token file, paste it into chat or put it in public environment variables. Redeploy.
4. The minute scheduler refreshes the complete Pro-folder inventory approximately every five minutes; owners can also use **Refresh Drive folders**. Incomplete reads do not replace the last complete inventory. The current Drive scan gets its own scheduled invocation so Shopify work resumes on later ticks.
5. Private thumbnails are fetched through the authenticated SHUTTLE server from Google's thumbnail service. The browser receives image bytes, not Google tokens or expiring thumbnail links. A missing scope/access/thumbnail remains a visible error rather than a guessed image.

The live direct-Drive adapter is unit-tested with fake network responses; actual Vercel OAuth and thumbnail responses still require deployment verification. The local snapshot was read through the connected Drive plugin and all 527 cached previews were verified in the browser. The uploaded-sheet processing and automatic redo file-move adapters remain separate unfinished work.

### Automatic redo artwork returns
Authorize `info@rugtomize.co` with Google Drive write permission using connection mode `drive_write` (the existing `drive_read_only` grant cannot move files). The server-side OAuth client and refresh token remain private. Set `GDRIVE_WRITE_ENABLED=1` only after granting that permission. Full Drive scope is needed to access pre-existing production artwork; SHUTTLE restricts this operation to the selected source file in its verified Pro folder or the configured intake root. A redo moves that file to DONE READY 4 PRINT and inserts `.redo` before its extension. A follow-up metadata read verifies its name and root-only parent before queue entry is marked verified. Failed/uncertain returns remain flagged for reconciliation; there is no fake success in the local preview. Only selected files move, not every rug in the order.

## October 22 update — Parsel is optional and disconnected by default
SHUTTLE initializes without any Parsel token, URL or shipping settings. Leave `PARSEL_ENABLED` unset or `0`. Existing Parsel environment values are ignored until explicitly enabled. Booking, reconciliation, label retrieval and print requests cannot execute while disconnected. Existing orders, artwork, production records and shipping history are preserved. To configure later, explicitly set `PARSEL_ENABLED=1` and private credentials; live purchases remain disabled pending integration validation. Supabase, authentication and the relevant Google/Shopify connections retain their own setup requirements. This release includes the combined Mock-ups list with one-click Approve & send / Redo. Hosted GOAT processing still requires a hosted worker; the local SHUTTLE bridge is not a Vercel worker.

## Shopify authorization-code flow (apps outside the store-owning organization)
Set `SHOPIFY_AUTH_MODE=oauth`, retain the verified `SHOPIFY_STORE` and app client credentials, and initially request only `SHOPIFY_SCOPES=read_orders`. Generate a private base64 32-byte `SHOPIFY_TOKEN_ENCRYPTION_KEY` and store it server-side; keep it stable across redeployments. This key encrypts OAuth tokens at rest. Never commit credentials, token values or the encryption key.

In the Shopify app's released configuration, add exactly `https://YOUR-SHUTTLE-HOST/auth/shopify/callback` to allowed redirect URLs. For local testing the app must accept the exact local callback `http://127.0.0.1:43841/auth/shopify/callback`; if Shopify requires HTTPS, use the deployed HTTPS callback instead of bypassing browser security. The app distribution configuration must permit installation on the intended store.

Sign into SHUTTLE as Owner and click Connect Shopify. This creates a ten-minute, single-use, browser-bound state and redirects to the fixed configured store. The store owner reviews and approves Shopify's requested access. The callback verifies shop identity, timestamp, state cookie, owner eligibility and Shopify HMAC, exchanges the code server-side and persists encrypted credentials. No order writes occur during this flow. Import orders separately after connection succeeds.

Expired offline tokens currently require reconnecting; background token refresh is not implemented in this adapter. A pending/failed/uncertain exchange requires a fresh Connect Shopify attempt rather than replaying the old callback. Shopify scopes and app distribution remain administrator prerequisites; code alone does not grant store access.

## October 26 live synchronization readiness

The non-demo local launcher now polls Shopify every 60 seconds while its process and computer are running. It uses bounded UPDATED_AT windows, persisted pagination, a five-minute overlap, and a single sync lease. It does not send mail, change Shopify, or buy shipping labels. Initial catch-up can take multiple cycles. Provider outages, search-index delays, inaccessible older orders, or expired authorization can delay results; the UI reports the last successful source check separately from Gmail/agent connectivity.

On Vercel, the existing protected minute cron advances order import, changed-order catch-up, and signed webhook receipts. The minute schedule requires a Vercel plan that permits that frequency. A shared private DATABASE_URL is mandatory; local-file state is not deployed or silently substituted. Existing Supabase tables are preserved; SHUTTLE uses its separate shuttle_hosted schema. Before switching, preserve the current local workflow data through an explicit migration; do not upload private data or local.env to GitHub. Authorize Shopify again for the exact HTTPS deployment origin using the same app and encryption key. Verify all of this before retiring the local process.

Configure orders/create, orders/updated, orders/fulfilled and app/uninstalled deliveries for https://YOUR-ACTUAL-DEPLOYMENT/api/shopify/webhook. The receiver verifies original-body HMAC and shop identity, deduplicates webhook IDs and durably queues processing. It does not register subscriptions automatically. Confirm a genuine delivery, processing receipt, and corresponding interface update after deployment. Fallback polling covers missed accessible order changes. An imported Shopify fulfillment is not carrier acceptance or proof of delivery; workflow stages require their own evidence.

### Parsel and business-rule audit: blocked for live purchases

Local audit found PARSEL_TOKEN and enablement absent. Vercel secrets have not been inspected. The existing provider is deliberately initialized with liveBooking:false and lacks verifyCurrent; credentials alone do not complete shipping readiness. Use scripts/check-parsel.mjs for a read-only credential check after saving a private token. A successful read does not prove write scopes, rate availability, cancellation, ZPL compatibility or printing.

Preserved gates include fixed approved service/rate and spending ceiling, paid/QC/packing evidence, duplicate purchase locks, uncertain-write reconciliation, and separate print-request/spool receipts. Drive redo move/rename and fresh metadata verification are implemented behind Drive authorization. Current local data is cached artwork inventory, not a configured live Drive sync.

Remaining release blockers: validated carrier field limits including UPS company 34 characters; order-wide over-$100 UPS Ground routing; category-wide prescan and numerically interleaved new/reused/redo printing; fresh provider-backed approval/payment/address/deadline/package verification; mandatory actual Shopify fulfillment/tracking verification after expedited booking; Parsel tracking webhook/polling with all-package acceptance/delivery; repeat-redo owner approval and exact physical-unit mappings; 8 AM redo hold release with expedited owner review and post-carrier-acceptance replacement decisions. Existing tests do not establish these missing integrations.

The old new-quote helper now applies the October 26 $48.53 minimum proportionally after the saved relative markup. It never mutates prior quotes. End-to-end customer quote generation is not connected: it must offer only verified overnight/two-day deadline-compatible options and display estimated arrival date/time/destination timezone and price, keeping service names internal.

### Parsel read-only verification — October 26

After privately configuring the token, live shipment listing, shipment detail, label detail and tracking reads succeeded. Four existing UPS labels were examined; one was VOIDED. An existing unaccepted UPS label downloaded from the observed easypost-files.s3.us-west-2.amazonaws.com host and was identified as PNG by its actual bytes. This is not a ZPL, FedEx, rate-purchase, cancellation, or physical-printer test. No shipment draft, purchase, Shopify write or print was performed.

The adapter now rejects incomplete API success envelopes, unverified/voided/accepted/delivered label reuse, mismatched service/tracking, and mislabeled printer formats. It detects PDF/PNG/ZPL bytes and never defaults an undeclared label to PDF. Automatic Windows station delivery requires actual ZPL; browser retrieval serves PNG and PDF with their correct MIME types and extensions. A missing carrier ship date now blocks preflight rather than silently satisfying the handoff check. The live shipment samples omitted ship_date: verify how the provider persists/returns the intended handoff date before enabling purchase.

The token is only in ignored local configuration. Local live launcher shipping remains disabled; adding a token does not establish current prescan evidence, write permission or production purchase approval. Further pilot setup needs a chosen Pro run, confirmed sender/return address, approved package measurements, and the Windows print test. A token-read test cannot certify the full historical Label Booker workflow.

### Paid Shopify shipping → next-production priority

Active nonzero Shopify shipping charges now populate the existing expedited queue. The adapter uses current discounted/refunded shipping amounts, ignores removed lines, and preserves SHUTTLE artwork, deadline and hold evidence. Positive-price shipping selections with unresolved payment remain visible as payment-review cases; they are not payment-verified or purchase-eligible. Free, removed, cancelled, refunded and fulfilled automatic memberships are hidden without deleting the historical row. Existing independent SHUTTLE expedited cases remain preserved.

A resumable initial scan of accessible unfulfilled orders backfills existing selections; subsequent signed webhooks and changed-order polling keep them current. Shopify's app-access window still limits historical coverage. The Home priority table and expedited production filter include paid selections even when no delivery date/calendar window exists. Missing deadlines stay flagged and are not counted twice in the chart. No shipping selection alone approves customer artwork, clears a hold, buys a label, or changes Shopify.

## Vercel webhook activation (prepared; not active locally)

Keep local minute polling until the public deployment and shared database are verified. The canonical receiver is the production domain + /api/shopify/webhook. No temporary tunnel is required or created.

Recommended app-owned setup: use SHOPIFY_WEBHOOK_SOURCE=app and the same private SHOPIFY_CLIENT_SECRET used by the installed app. Once deployed and authorized, the SHUTTLE owner may POST /api/shopify/webhooks/setup with their authenticated session, exact Origin, and X-Shuttle-Token CSRF header. This registers/reuses six exact-endpoint subscriptions: orders/create, orders/updated, orders/paid, orders/cancelled, orders/fulfilled, app/uninstalled. Registration requests only the payload id; the worker fetches current order facts from Shopify. The action never deletes other subscriptions. Uncertain registration is reconciled by re-listing subscriptions on the next attempt; it never blindly repeats a successful creation.

Manual Shopify Admin Notifications setup is an alternative, not an additional required path. For those subscriptions set SHOPIFY_WEBHOOK_SOURCE=manual and privately configure SHOPIFY_WEBHOOK_SECRET from that admin setup. The receiver uses only the selected signing source; it does not silently fall back between app and manual keys. Do not mix differently signed deliveries on this single endpoint. Keep the app's webhook API version at the tested 2026-10 version.

The receiver validates shop identity, topic, original-body HMAC, body size and order identity, deduplicates deliveries and acknowledges only after durable storage. Failed persistence returns 503 for provider retry. Cron re-fetches current Shopify facts, applies the same paid-shipping membership rules, and preserves artwork/approval/hold state. It does not infer carrier acceptance from fulfillment or authorize sends/purchases. The minute worker and overlap polling remain the recovery path for delayed/missed events. A configured subscription is not verified delivery: after activation, confirm a real provider delivery receipt, worker completion, and the matching interface update. Local tests simulate these flows; no actual subscription or public delivery has been created during preparation.

## Hosted Gmail review synchronization

Set server-only GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET and GMAIL_REFRESH_TOKEN in Vercel, then redeploy main. The mailbox is fixed to info@rugtomize.co and verified before each sync. Gmail sending remains disabled in the hosted runtime, even if GMAIL_LIVE_SEND=1. These changes do not implement AI analysis, autonomous artwork approval, production filing or the original Banda/Hunt workflows.

The existing authenticated /api/cron schedule runs Gmail, Drive and Shopify source checks independently. An owner can also use Sync Gmail / Sync Drive. Both manual routes require a verified session and CSRF token; warehouse/viewer roles cannot use them. No server interval is needed on Vercel. Initial discovery imports up to 50 recent incoming messages and exhausts unread-message pagination across Inbox, archives and Spam, excluding Trash. Threads are read in bounded resumable groups; discovery completion is distinct from conversation-read completion and owner resolution. History changes are queued durably before advancing the cursor. Expired Gmail history triggers full incoming-mail recovery with pagination, preserving all existing obligations. Read/archive changes never close an inquiry automatically. Existing production and review data is not replaced.

Owner-written drafts can be saved without enabling sends. Exact source-version changes require re-review. The review queue exposes plain text, full conversation context and source identities. HTML-only/attachment content needs owner inspection; this is not an automatic semantic classifier. Business, design and shipping questions all remain review-required, with no inferred promises, quotes or approvals.

Optional GMAIL_LABEL_SYNC=1 adds only SHUTTLE/Review to unread incoming messages and verifies readback. It does not remove labels, archive, mark read, trash or send. Default 0 performs no mailbox writes. Authorization requires gmail.modify for labeling and drive.readonly for production previews. GDRIVE_WRITE_ENABLED=0 keeps Drive moves and renames off.

Set GDRIVE_CLIENT_ID, GDRIVE_CLIENT_SECRET and GDRIVE_REFRESH_TOKEN for folder synchronization. The Drive client reads Pro folders under the established DONE READY 4 PRINT root and proxies previews through the authenticated app. No public file-sharing changes are made. Existing local carryover files and workflow records are not automatically deployed; migrate those privately into durable workflow state before claiming legacy case coverage.

A successful build/test verifies implementation, not live hosted credentials or cron delivery. Verify hosted sign-in, Gmail source counts/error status, an actual new message update and production thumbnails after deployment. Pending/deleted-source cases remain visible and require reconciliation. Never upload data/, credentials, mail content or provider receipts to Git.
