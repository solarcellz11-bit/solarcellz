import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'http';
import app from '../src/server.js';
import { depClient } from '../src/services/depClient.js';

describe('Webhooks API', () => {
  let server: http.Server;
  let baseUrl: string;

  beforeAll(async () => {
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const addr = server.address();
        if (typeof addr === 'object' && addr !== null) {
          baseUrl = `http://localhost:${addr.port}`;
        }
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  beforeEach(() => {
    depClient.getMockStore().clear();
  });

  it('health endpoint returns 200 with system status', async () => {
    const res = await fetch(`${baseUrl}/health`);
    const data = (await res.json()) as any;

    expect(res.status).toBe(200);
    expect(data.status).toBe('healthy');
    expect(data.shopify.mode).toBe('MOCK_CATALOG');
  });

  it('processes products/update webhook successfully', async () => {
    const productPayload = {
      id: 100000,
      title: 'CPS America 125kW Energy Storage Inverter',
      handle: 'cps-america-125kw-energy-storage-inverter',
      status: 'active',
      variants: [
        {
          id: 200000,
          title: 'Default Title',
          price: '19999.00',
          sku: 'CPS-ES-125KW',
          inventory_quantity: 10,
        },
      ],
      metafields: [
        {
          namespace: 'dep',
          key: 'dcide_id',
          value: '65314f89d123456789abcdef',
        },
      ],
    };

    const res = await fetch(`${baseUrl}/api/webhooks/shopify/products/update`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Topic': 'products/update',
      },
      body: JSON.stringify(productPayload),
    });

    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.success).toBe(true);
    expect(data.result.price).toBe(19999.0);
    expect(data.result.leadTime).toBe('In stock');
  });

  it('processes inventory_levels/update webhook to reflect out of stock', async () => {
    // Dynamically use the first product in mock catalog
    const allProducts = await (await import('../src/services/shopifyClient.js')).getShopifyClient().getAllProducts();
    const targetProduct = allProducts[0];
    const dcideId = targetProduct.metafields?.find((m) => m.key === 'dcide_id')?.value!;
    const invItemId = targetProduct.variants[0].inventory_item_id!;
    const expectedRestockLeadTime = targetProduct.metafields?.find((m) => m.key === 'lead_time')?.value || '2-4 weeks';

    // 1. Send inventory_levels update with available = 0
    const invRes = await fetch(`${baseUrl}/api/webhooks/shopify/inventory_levels/update`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        inventory_item_id: invItemId,
        available: 0,
      }),
    });

    expect(invRes.status).toBe(200);
    const stored = depClient.getMockStore().get(dcideId);
    expect(stored).toBeDefined();
    expect(stored?.leadTime).toBe(expectedRestockLeadTime);
  });
});
