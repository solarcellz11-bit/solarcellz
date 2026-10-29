import { describe, it, expect, beforeEach } from 'vitest';
import { SyncEngine } from '../src/services/syncEngine.js';
import { DepClient } from '../src/services/depClient.js';
import { ShopifyProduct } from '../src/types/index.js';

describe('SyncEngine', () => {
  let syncEngine: SyncEngine;
  let mockDepClient: DepClient;

  beforeEach(() => {
    mockDepClient = new DepClient({ mockMode: true, apiKey: 'mock_test_key' });
    syncEngine = new SyncEngine(mockDepClient);
  });

  it('determines "In stock" when inventory_quantity > 0', () => {
    const product: ShopifyProduct = {
      id: 1,
      title: 'Solar Panel',
      handle: 'solar-panel',
      status: 'active',
      variants: [
        {
          id: 10,
          title: 'Default',
          price: '215.00',
          sku: 'CAN-CS6R-410MS',
          inventory_quantity: 45,
        },
      ],
    };

    const leadTime = syncEngine.determineLeadTime(product, product.variants[0]);
    expect(leadTime).toBe('In stock');
  });

  it('determines restock lead time when inventory_quantity is 0', () => {
    const product: ShopifyProduct = {
      id: 1,
      title: 'Battery System',
      handle: 'battery-system',
      status: 'active',
      variants: [
        {
          id: 10,
          title: 'Default',
          price: '9850.00',
          sku: 'FORTRESS-EVLT-18.5',
          inventory_quantity: 0,
        },
      ],
      metafields: [
        {
          namespace: 'dep',
          key: 'lead_time',
          value: '4-6 weeks',
        },
      ],
    };

    const leadTime = syncEngine.determineLeadTime(product, product.variants[0]);
    expect(leadTime).toBe('4-6 weeks');
  });

  it('syncs active product and upserts to DEP', async () => {
    const product: ShopifyProduct = {
      id: 1001,
      title: 'CPS Inverter',
      handle: 'cps-america-125kw-energy-storage-inverter',
      status: 'active',
      variants: [
        {
          id: 2001,
          title: 'Default',
          price: '18450.00',
          sku: 'CPS-ES-125KW',
          inventory_quantity: 2,
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

    const result = await syncEngine.syncProduct(product);
    expect(result.success).toBe(true);
    expect(result.dcideId).toBe('65314f89d123456789abcdef');
    expect(result.price).toBe(18450.0);
    expect(result.leadTime).toBe('In stock');

    const stored = await mockDepClient.getAllStoredPrices();
    expect(stored.data.length).toBe(1);
    expect(stored.data[0].price).toBe(18450.0);
  });

  it('deletes product from DEP if product status is archived or draft', async () => {
    const product: ShopifyProduct = {
      id: 1001,
      title: 'Discontinued Inverter',
      handle: 'cps-america-125kw-energy-storage-inverter',
      status: 'archived',
      variants: [
        {
          id: 2001,
          title: 'Default',
          price: '18450.00',
          sku: 'CPS-ES-125KW',
          inventory_quantity: 0,
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

    // Pre-populate DEP
    mockDepClient.getMockStore().set('65314f89d123456789abcdef', {
      dcideId: '65314f89d123456789abcdef',
      price: 18450.0,
      sku: 'CPS-ES-125KW',
    });

    const result = await syncEngine.syncProduct(product);
    expect(result.success).toBe(true);
    expect(mockDepClient.getMockStore().has('65314f89d123456789abcdef')).toBe(false);
  });
});

