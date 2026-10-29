import { describe, it, expect, beforeEach } from 'vitest';
import { DepClient } from '../src/services/depClient.js';
import { DepDistributorPricePayload } from '../src/types/index.js';

describe('DepClient', () => {
  let client: DepClient;

  beforeEach(() => {
    client = new DepClient({
      mockMode: true,
      apiKey: 'mock_test_key',
    });
  });

  it('successfully upserts price in mock mode', async () => {
    const payload: DepDistributorPricePayload = {
      price: 18450.0,
      leadTime: '2-4 weeks',
      sku: 'CPS-ES-125KW',
      url: 'https://store.solarcellzusa.com/products/cps-america-125kw',
    };

    const res = await client.upsertPrice('65314f89d123456789abcdef', payload);
    expect(res.success).toBe(true);
    expect(res.statusCode).toBe(200);

    const stored = await client.getAllStoredPrices();
    expect(stored.data.length).toBe(1);
    expect(stored.data[0].price).toBe(18450.0);
    expect(stored.data[0].sku).toBe('CPS-ES-125KW');
  });

  it('rejects invalid payload: non-https url', async () => {
    const payload: DepDistributorPricePayload = {
      price: 100,
      leadTime: 'In stock',
      sku: 'TEST',
      url: 'http://insecure.url.com',
    };

    await expect(client.upsertPrice('65314f89d123456789abcdef', payload)).rejects.toThrow(
      /must start with https:\/\//
    );
  });

  it('rejects invalid payload: lead time exceeds 60 chars', async () => {
    const payload: DepDistributorPricePayload = {
      price: 100,
      leadTime: 'A'.repeat(65),
      sku: 'TEST',
      url: 'https://store.solarcellzusa.com',
    };

    await expect(client.upsertPrice('65314f89d123456789abcdef', payload)).rejects.toThrow(
      /at most 60 characters/
    );
  });

  it('deletes stored price on DELETE call', async () => {
    const payload: DepDistributorPricePayload = {
      price: 50,
      leadTime: 'In stock',
      sku: 'BRK-60A',
      url: 'https://store.solarcellzusa.com/products/breaker',
    };

    await client.upsertPrice('65314f89d123456789abcde4', payload);
    expect((await client.getAllStoredPrices()).data.length).toBe(1);

    const delRes = await client.deletePrice('65314f89d123456789abcde4');
    expect(delRes.success).toBe(true);

    const afterDel = await client.getAllStoredPrices();
    expect(afterDel.data.length).toBe(0);
  });
});

