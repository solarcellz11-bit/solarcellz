# Solar Cellz USA x Direct Energy Partners (DEP) API Integration

Production middleware connecting Solar Cellz USA Shopify store (`store.solarcellzusa.com`) to the Direct Energy Partners (DEP) DCIDE catalog via the Distributor Pricing API.

---

## Overview and Architecture

Shopify serves as the single source of truth. The middleware pushes price, lead time, SKU, and product URL to DEP's Distributor Pricing API on live events and runs a nightly reconciliation job to audit and maintain catalog synchronization.

```
+--------------------------------------+
|  Solar Cellz USA Shopify Store       |
|  (store.solarcellzusa.com)           |
+------------------+-------------------+
                   |
                   | Webhooks: products/update, inventory_levels/update, products/delete
                   v
+---------------------------------------------------------------+
|  Integration Middleware (Node.js / TypeScript)                |
|  - HMAC Signature Verification                                |
|  - Dynamic Lead Time Calculation ("In stock" vs Restock)      |
|  - Rate-Limited Batching and Exponential Backoff Retries      |
|  - Nightly Reconcile Engine (Drift Detection and Auto-Fix)    |
|  - Alert Dispatcher (Email and Webhook notifications)         |
+------------------+--------------------------------------------+
                   |
                   | PUT /api/distributor-prices/{dcideId}
                   | GET /api/distributor-prices (Nightly Reconcile)
                   | DELETE /api/distributor-prices/{dcideId} (Withdrawn/Archived)
                   v
+--------------------------------------+
|  DEP DCIDE Online Catalog            |
|  (directenergypartners.com)          |
+--------------------------------------+
```

---

## Features

- **Instant Price and Stock Synchronization**: Webhook-driven synchronization updating DEP in real-time when changes occur in Shopify.
- **Dynamic Lead-Time Logic**: Automatically sets "In stock" when inventory is greater than 0, or calculates restock lead time when stock reaches 0.
- **Automated Lifecycle Management**: Archived or deleted Shopify products are automatically withdrawn from DEP via DELETE requests.
- **Nightly Reconciliation Engine**: Automated 2:00 AM UTC audit comparing DEP stored prices against Shopify, automatically healing any discrepancies.
- **Enterprise Resilience**: Exponential backoff retries, rate-limit throttling, and alerting on HTTP 401/409 responses.

---

## Environment Configuration

Configure the following environment variables in `.env` or your hosting provider dashboard:

```ini
PORT=3000
NODE_ENV=production

# DEP DCIDE Distributor Pricing API
DEP_API_BASE_URL=https://directenergypartners.com
DCIDE_API_KEY=your_dcide_api_key

# Solar Cellz Shopify Store
SHOPIFY_STORE_DOMAIN=p2bgv0-0e.myshopify.com
SHOPIFY_PUBLIC_DOMAIN=store.solarcellzusa.com
SHOPIFY_ADMIN_ACCESS_TOKEN=your_shopify_admin_access_token
SHOPIFY_API_VERSION=2024-10
SHOPIFY_WEBHOOK_SECRET=your_shopify_webhook_secret

# Sync and Rate Limiting Settings
USE_MOCK_SHOPIFY=false
BATCH_DELAY_MS=200
MAX_RETRIES=3
RETRY_DELAY_MS=500

# Lead Time Defaults
DEFAULT_LEAD_TIME_IN_STOCK=In stock
DEFAULT_LEAD_TIME_RESTOCK=2-4 weeks

# Alert Notifications (Optional)
ALERT_EMAIL_ENABLED=false
ALERT_EMAIL_TO=alerts@solarcellzusa.com
ALERT_EMAIL_FROM=alerts@solarcellzusa.com
SMTP_HOST=smtp.mailgun.org
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
ALERT_WEBHOOK_URL=
```

---

## Data Mapping and Business Rules

DEP's API accepts four fields per product:

| DEP Field | Rule | Shopify Source | Trigger |
| :--- | :--- | :--- | :--- |
| `dcideId` | 24-character ID in URL | Product mapping catalog (`config/product-mappings.json`) or metafield `dep.dcide_id` | Set once |
| `price` | Non-negative number in USD | Variant price | Webhook + nightly reconcile |
| `leadTime` | Max 60 characters free text | "In stock" when inventory > 0, else metafield `dep.lead_time` / category default | When edited + nightly |
| `sku` | Unique per product | Variant SKU / model number | Set once |
| `url` | Must start with `https://` | Product URL (`https://store.solarcellzusa.com/products/{handle}`) | Set once |

### Discontinued and Out-of-Stock Handling
- **Out of stock (`inventory_quantity == 0`)**: Updates `leadTime` to restock time (e.g., "5-9 days" or "2-4 weeks").
- **Discontinued or archived**: Dispatches `DELETE /api/distributor-prices/{dcideId}`. Products are removed cleanly, never set to $0.

---

## Deployment and Webhook Setup

### 1. Cloud Deployment (Vercel)
Deploy this repository to Vercel or any Node.js environment:
1. Connect the repository in Vercel.
2. Add the environment variables from `.env`.
3. Deploy. The built-in `vercel.json` automatically configures serverless routing and schedules the nightly reconcile cron job at 2:00 AM UTC.

### 2. Shopify Webhook Configuration
Register the following webhooks in Shopify Admin under **Settings** > **Notifications** > **Webhooks**:

| Event | Format | Endpoint URL |
| :--- | :--- | :--- |
| `Product update` | JSON | `https://your-domain.com/api/webhooks/shopify/products/update` |
| `Inventory levels update` | JSON | `https://your-domain.com/api/webhooks/shopify/inventory_levels/update` |
| `Product deletion` | JSON | `https://your-domain.com/api/webhooks/shopify/products/delete` |

---

## Available Commands

| Command | Description |
| :--- | :--- |
| `npm run build` | Compiles TypeScript source to production JavaScript (`dist/`). |
| `npm start` | Starts the production server. |
| `npm run dev` | Runs the development server with live reload. |
| `npm test` | Executes the unit and integration test suite. |
| `npm run sync:all` | Performs a full bulk catalog sync with rate throttling. |
| `npm run sync:reconcile` | Runs the full catalog reconciliation audit and auto-heals discrepancies. |
| `npm run sync:test-one` | Pushes a single mapped product to DEP to verify API connectivity. |
