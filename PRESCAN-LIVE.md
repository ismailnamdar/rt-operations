# Automatic production prescan and Gideon

The existing authenticated minute cron checks Drive, refreshes Shopify, then processes bounded prescan work. No additional scheduler or AI call is needed for these checks.

- A production run's explicit date is its carrier handoff date. Folder creation time is not a production date. Set the date in Gideon; it appears on the production run too.
- Held and pickup orders are excluded. Unnumbered/UGC artwork remains visible but is not a shipment.
- Existing labels are paginated and matched by exact order references; linked shipment reads are cached. Shopify tracking is independently refreshed. Existing labels and replacement/redo cases require reconciliation before another label can be bought.
- Address verification uses Parsel `/addresses/verify`. Rate preparation creates an unpurchased shipment with `buy_cheapest_rate:false`, the production `ship_date`, and actual order references. Unknown packages, payments, deadlines and destination changes stay flagged.
- Gideon contains prescan results, plain-language response fields, address/package correction controls and the exact ready-order purchase total. Production contains artwork and label controls, without a second prescan report or approval form.
- Owner approval is bound to the displayed report revision, rate IDs, price ceilings and verified artwork scope. Fresh checks precede purchases. An uncertain purchase is reconciled by its exact shipment ID; it is never replayed blindly. Booking does not auto-print.
- Shopify fulfillment creation includes exact remaining line-item IDs and quantities, disables customer notification and verifies tracking/fulfillment afterward. Missing merchant-managed fulfillment permissions block automatic booking. Add and reauthorize `read_merchant_managed_fulfillment_orders` and `write_merchant_managed_fulfillment_orders` alongside existing `read_orders` as appropriate for the store's own fulfillment location.
- The private existing `PARSEL_TOKEN` and connected Shopify client enable the prescan worker. `PARSEL_ENABLED=1` and verified `PARSEL_LABEL_HOSTS` remain necessary for the existing warehouse label-download/print provider; they do not bypass owner approvals. The observed label host is `easypost-files.s3.us-west-2.amazonaws.com`; verify any additional host before adding it.

## Gideon conversations

Owner messages are durable and idempotent. They are suggestions/analysis jobs, never free-form commands executed by the server. The UI says when no AI worker is connected. Codex/ChatGPT allowance is not automatically available to a Vercel function.

An explicitly configured worker uses the existing private `SHUTTLE_WORKFLOW_TOKEN` to POST `/api/workflow/gideon/claim`, then POST `/api/workflow/gideon/result` with its `jobId`, returned `claimToken`, `text` and `model`. Claims expire; results cannot mutate operations. The worker must apply the saved operating knowledge and current provider evidence. No worker or polling automation is started by deploying this code.

Do not put tokens, sender/customer data, database credentials or private state into Git. Staff payloads exclude owner conversations, addresses, prescan reports and provider claims.
