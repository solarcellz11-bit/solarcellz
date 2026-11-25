import express, { Request, Response } from 'express';
import { env, isMockShopifyActive } from './config/env.js';
import { webhookRouter } from './webhooks/router.js';
import { syncEngine } from './services/syncEngine.js';
import { reconcileService } from './services/reconcileService.js';
import { sendAlertNotification } from './services/alertService.js';

const app = express();

// Middleware to capture raw body for Shopify HMAC verification
app.use(
  express.json({
    verify: (req: Request, _res: Response, buf: Buffer) => {
      (req as any).rawBody = buf;
    },
  })
);

// Mount webhooks router
app.use('/api/webhooks', webhookRouter);

// Health check endpoint
app.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    environment: env.NODE_ENV,
    shopify: {
      domain: env.SHOPIFY_STORE_DOMAIN,
      mode: isMockShopifyActive() ? 'MOCK_CATALOG' : 'LIVE_ADMIN_API',
      configured: Boolean(env.SHOPIFY_ADMIN_ACCESS_TOKEN),
    },
    dep: {
      baseUrl: env.DEP_API_BASE_URL,
      keyConfigured: Boolean(env.DCIDE_API_KEY && !env.DCIDE_API_KEY.startsWith('mock_')),
    },
  });
});

// Trigger full bulk push on demand
app.post('/api/sync/all', async (_req: Request, res: Response) => {
  try {
    const summary = await syncEngine.syncAllProducts();
    res.status(200).json(summary);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Trigger nightly reconciliation on demand or via Vercel Cron (GET / POST)
app.all('/api/sync/reconcile', async (_req: Request, res: Response) => {
  try {
    const report = await reconcileService.reconcile(true);
    res.status(200).json(report);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Test alert notification endpoint
app.post('/api/test/alert', async (req: Request, res: Response) => {
  const sent = await sendAlertNotification({
    subject: 'Manual Alert Test',
    message: req.body.message || 'Testing notification dispatch from Solar Cellz × DEP middleware.',
    details: { test: true, requestedAt: new Date().toISOString() },
  });
  res.status(200).json({ dispatched: sent });
});

const PORT = env.PORT || 3000;

if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`\n======================================================`);
    console.log(`️  Solar Cellz × DEP Middleware Server Running!`);
    console.log(` Listening on: http://localhost:${PORT}`);
    console.log(`️  Shopify Mode: ${isMockShopifyActive() ? 'MOCK (Ready for live token)' : 'LIVE'}`);
    console.log(` DEP Endpoint: ${env.DEP_API_BASE_URL}`);
    console.log(`======================================================\n`);
  });
}

export default app;
