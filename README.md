# Solar Cellz USA × DEP (Direct Energy Partners) API Integration

> Production middleware connecting **Solar Cellz USA** Shopify store (`store.solarcellzusa.com`) to the **Direct Energy Partners (DEP)** DCIDE catalog via the Distributor Pricing API.

---

##  Overview & Architecture

Shopify serves as the **single source of truth**. The middleware pushes price, lead time, SKU, and product URL to DEP's Distributor Pricing API.

```
┌──────────────────────────────────────┐
│  Solar Cellz USA Shopify Store       │
│  (store.solarcellzusa.com)           │
└──────────────────┬───────────────────┘
                   │
                   │ Webhooks: products/update, inventory_levels/update, products/delete
                   ▼
┌───────────────────────────────────────────────────────────────┐
│  Integration Middleware (Node.js / TypeScript)                │
│  - HMAC Signature Verification                                │
│  - Intelligent Lead Time Calculation ("In stock" vs Restock)  │
│  - Rate-Limited Batching & Exponential Backoff Retries        │
│  - Nightly Reconcile Engine (Drift Detection & Auto-Fix)       │
│  - Alert Dispatcher (Email & Webhook notifications)           │
└──────────────────┬────────────────────────────────────────────┘
                   │
                   │ PUT /api/distributor-prices/{dcideId}
                   │ GET /api/distributor-prices (Nightly Reconcile)
                   │ DELETE /api/distributor-prices/{dcideId} (Withdrawn/Archived)
                   ▼
┌──────────────────────────────────────┐
│  DEP DCIDE Online Catalog            │
│  (api.directenergypartners.com)      │
└──────────────────────────────────────┘
```

---

##  Quick Start (Works Offline / In Mock Mode Right Now)

The system includes a **built-in mock mode** with the 58-product match catalog so you can run and test everything end-to-end **immediately**, even before receiving live credentials from Nathan or Ben.

### 1. Install Dependencies
```bash
npm install
```

### 2. Run Automated Test Suite
```bash
npm test
```
*(Runs 14 automated unit & integration tests covering DEP client, lead-time rules, reconcile engine, and webhook routes).*

### 3. Test Phase 2: Push CPS ES-125kW (Single Product Test)
```bash
npm run sync:test-one
```

### 4. Test Bulk Push (Catalog Sync with Rate Throttling)
```bash
npm run sync:all
```

### 5. Test Nightly Reconcile (Audit & Fix Drift)
```bash
npm run sync:reconcile
```

### 6. Start the Webhook Server
```bash
npm run dev
```
The server will start on `http://localhost:3000` with the health check available at `http://localhost:3000/health`.

---

##  Switching to Production (When You Receive API Keys)

When Nathan provides the Shopify Custom App Token and Ben sends the DCIDE API Key, **no code changes are needed**! Simply edit `.env`:

```ini
# 1. DEP DCIDE Settings (from Ben Vanspringel)
DEP_API_BASE_URL=https://api.directenergypartners.com
DCIDE_API_KEY=your_actual_dcide_api_key_here

# 2. Shopify Store Settings (from Nathan Roberts)
SHOPIFY_STORE_DOMAIN=store.solarcellzusa.com
SHOPIFY_ADMIN_ACCESS_TOKEN=shpat_your_shopify_admin_access_token_here
SHOPIFY_WEBHOOK_SECRET=your_shopify_webhook_secret_here

# 3. Switch Mock Mode to False
USE_MOCK_SHOPIFY=false
```

Once saved:
- All calls immediately connect to live Shopify and live DEP API.
- If you want to test with another Shopify test store in the meantime, simply set `SHOPIFY_STORE_DOMAIN` and `SHOPIFY_ADMIN_ACCESS_TOKEN` to that test store.

---

##  Data Mapping & Business Rules

DEP's API accepts 4 fields per product:

| DEP Field | Rule from DEP Docs | Source in Shopify | Update Trigger |
| :--- | :--- | :--- | :--- |
| `dcideId` (URL) | 24-character ID | Metafield `dep.dcide_id` (or `config/product-mappings.json`) | Set once |
| `price` | Non-negative number in USD (not cents) | Variant `price` | Webhook + nightly reconcile |
| `leadTime` | Max 60 characters free text | "In stock" if inventory > 0, else metafield `dep.lead_time` / category default | When edited + nightly |
| `sku` | Unique per product (else 409) | Variant SKU / model number | Set once |
| `url` | Must start with `https://` | Product URL (`https://store.solarcellzusa.com/products/{handle}`) | Set once |

### Discontinued / Out-of-Stock Products:
- **Out of stock (`inventory_quantity === 0`)**: Updates `leadTime` to restock time (e.g. "2-4 weeks").
- **Discontinued or archived**: Sends `DELETE /api/distributor-prices/{dcideId}`. Products are never set to `$0`.

---

## ️ CLI Commands & Operational Scripts

| Command | Description |
| :--- | :--- |
| `npm run sync:test-one` | Push single product (CPS ES-125kW) and verify in DEP (Phase 2 acceptance). |
| `npm run sync:all` | Bulk push entire mapped catalog with configurable pause (`BATCH_DELAY_MS`) to respect rate limits. |
| `npm run sync:reconcile` | Runs `GET /api/distributor-prices`, compares against Shopify, identifies drift, auto-fixes differences, and outputs an audit report. |
| `npm run build` | Compiles TypeScript into production-ready JavaScript (`dist/`). |
| `npm start` | Starts compiled production server. |
| `npm test` | Runs Vitest test suite. |

---

##  Webhook Endpoints

Configure these in Shopify Admin > **Settings** > **Notifications** > **Webhooks**:

| Shopify Event | Endpoint URL | Behavior |
| :--- | :--- | :--- |
| `products/update` | `https://your-domain.com/api/webhooks/shopify/products/update` | Synchronizes changed price, lead time, or title. |
| `inventory_levels/update` | `https://your-domain.com/api/webhooks/shopify/inventory_levels/update` | Automatically switches between "In stock" and restock lead time. |
| `products/delete` | `https://your-domain.com/api/webhooks/shopify/products/delete` | Issues `DELETE` to DEP to withdraw the listing. |

### Development Simulation Endpoint
You can simulate a webhook locally without ngrok by sending:
```bash
curl -X POST http://localhost:3000/api/webhooks/simulate \
  -H "Content-Type: application/json" \
  -d '{"handle": "cps-america-125kw-energy-storage-inverter", "price": 18999.00, "inventory_quantity": 0}'
```

---

##  Alerts & Monitoring

- **401 Unauthorized**: If `DCIDE_API_KEY` is revoked, immediate critical alert is dispatched.
- **409 Conflict**: Logged and dispatched if an SKU collides across two products.
- **Drift Detected**: If nightly reconcile detects price drift or missing items, an audit report is generated and emailed to `nathan@solarcellzusa.com` and `deven@devenwebstudio.com`.
- **Configurable channels**: SMTP Email (`ALERT_EMAIL_ENABLED=true`) and Webhook URL (Slack/Discord).

---

##  Nightly Reconcile Automation

To schedule the nightly reconcile on your server or cloud provider:

### Via Linux Cron (e.g. 2:00 AM UTC):
```bash
0 2 * * * cd /path/to/Solar && /usr/bin/npm run sync:reconcile >> /var/log/dep-reconcile.log 2>&1
```

### Via HTTP Cron (e.g. Cloudflare Workers, Vercel Cron, EasyCron):
Send an authenticated `POST` request to:
```
POST https://your-domain.com/api/sync/reconcile
```

