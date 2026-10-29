import { describe, it, expect, beforeEach } from 'vitest';
import { ReconcileService } from '../src/services/reconcileService.js';
import { DepClient } from '../src/services/depClient.js';
import { SyncEngine } from '../src/services/syncEngine.js';

describe('ReconcileService', () => {
  let depClient: DepClient;
  let syncEngine: SyncEngine;
  let reconcileService: ReconcileService;

  beforeEach(() => {
    depClient = new DepClient({ mockMode: true, apiKey: 'mock_test_key' });
    syncEngine = new SyncEngine(depClient);
    reconcileService = new ReconcileService(depClient, syncEngine);
  });

  it('detects missing products in DEP and auto-fixes them', async () => {
    // DEP starts empty
    expect((await depClient.getAllStoredPrices()).data.length).toBe(0);

    const report = await reconcileService.reconcile(true);

    expect(report.driftCount).toBeGreaterThan(0);
    expect(report.drifts.some((d) => d.driftType === 'MISSING_IN_DEP')).toBe(true);

    // After auto-fix, DEP store should now have the mapped products
    const stored = await depClient.getAllStoredPrices();
    expect(stored.data.length).toBeGreaterThan(0);
  });

  it('detects price drift and updates DEP price', async () => {
    // Dynamically pick the first product in mock catalog
    const allProducts = await (await import('../src/services/shopifyClient.js')).getShopifyClient().getAllProducts();
    const firstProd = allProducts[0];
    const dcideId = firstProd.metafields?.find(m => m.key === 'dcide_id')?.value!;
    const expectedPrice = parseFloat(firstProd.variants[0].price);

    // Pre-populate with outdated price ($10 instead of expectedPrice)
    depClient.getMockStore().set(dcideId, {
      dcideId,
      price: 10.0,
      leadTime: 'In stock',
      sku: firstProd.variants[0].sku,
      url: `https://store.solarcellzusa.com/products/${firstProd.handle}`,
    });

    const report = await reconcileService.reconcile(true);
    const priceDrift = report.drifts.find(
      (d) => d.dcideId === dcideId && d.driftType === 'PRICE_MISMATCH'
    );

    expect(priceDrift).toBeDefined();
    expect(priceDrift?.fixed).toBe(true);

    // Check fixed price
    const updated = depClient.getMockStore().get(dcideId);
    expect(updated?.price).toBe(expectedPrice);
  });

  it('removes orphaned records from DEP that are not in Shopify', async () => {
    // Add an orphaned record with unknown dcideId
    depClient.getMockStore().set('999999999999999999999999', {
      dcideId: '999999999999999999999999',
      price: 500.0,
      sku: 'OLD-ORPHANED-SKU',
    });

    const report = await reconcileService.reconcile(true);
    const orphanDrift = report.drifts.find((d) => d.dcideId === '999999999999999999999999');

    expect(orphanDrift).toBeDefined();
    expect(orphanDrift?.driftType).toBe('ORPHANED_IN_DEP');
    expect(orphanDrift?.fixed).toBe(true);
    expect(depClient.getMockStore().has('999999999999999999999999')).toBe(false);
  });
});

