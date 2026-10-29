import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ShopifyProduct, ProductCatalogMappingFile } from '../types/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class MockShopifyClient {
  private products: Map<string, ShopifyProduct> = new Map();

  constructor() {
    this.initializeMockData();
  }

  private initializeMockData(): void {
    try {
      // Find mapping file
      const possiblePaths = [
        path.resolve(process.cwd(), 'config', 'product-mappings.json'),
        path.resolve(__dirname, '..', '..', 'config', 'product-mappings.json'),
      ];

      let mappingPath = possiblePaths.find((p) => fs.existsSync(p));

      if (mappingPath) {
        const raw = fs.readFileSync(mappingPath, 'utf8');
        const mapping: ProductCatalogMappingFile = JSON.parse(raw);

        mapping.products.forEach((p, idx) => {
          const productId = 100000 + idx;
          const variantId = 200000 + idx;

          const shopifyProduct: ShopifyProduct = {
            id: productId,
            title: p.title || p.shopifyHandle || `Solar Product ${idx + 1}`,
            handle: p.shopifyHandle || `product-${p.sku.toLowerCase()}`,
            status: 'active',
            variants: [
              {
                id: variantId,
                product_id: productId,
                title: 'Default Title',
                price: ((p.samplePrice ?? (p as any).currentDepPrice ?? 199.99)).toFixed(2),
                sku: p.sku,
                inventory_quantity: 15,
                inventory_item_id: 300000 + idx,
              },
            ],
            metafields: [
              {
                namespace: 'dep',
                key: 'dcide_id',
                value: p.dcideId,
                type: 'single_line_text_field',
              },
              {
                namespace: 'dep',
                key: 'lead_time',
                value: p.defaultLeadTime || '2-4 weeks',
                type: 'single_line_text_field',
              },
            ],
          };

          this.products.set(String(productId), shopifyProduct);
          if (p.shopifyHandle) {
            this.products.set(p.shopifyHandle, shopifyProduct);
          }
        });

        console.log(`[MockShopifyClient] Initialized with ${mapping.products.length} mock products.`);
      }
    } catch (err: any) {
      console.warn('[MockShopifyClient] Could not load product-mappings.json, using fallback sample:', err.message);
      // Fallback single product (CPS ES-125kW)
      this.products.set('100001', {
        id: 100001,
        title: 'CPS America 125kW Energy Storage Inverter',
        handle: 'cps-america-125kw-energy-storage-inverter',
        status: 'active',
        variants: [
          {
            id: 200001,
            title: 'Default Title',
            price: '18450.00',
            sku: 'CPS-ES-125KW',
            inventory_quantity: 5,
          },
        ],
        metafields: [
          {
            namespace: 'dep',
            key: 'dcide_id',
            value: '65314f89d123456789abcdef',
          },
          {
            namespace: 'dep',
            key: 'lead_time',
            value: '2-4 weeks',
          },
        ],
      });
    }
  }

  public async getAllProducts(): Promise<ShopifyProduct[]> {
    // Return unique products by ID
    const unique = new Map<number | string, ShopifyProduct>();
    for (const prod of this.products.values()) {
      unique.set(prod.id, prod);
    }
    return Array.from(unique.values());
  }

  public async getProductById(id: string | number): Promise<ShopifyProduct | null> {
    return this.products.get(String(id)) || null;
  }

  public async getProductByHandle(handle: string): Promise<ShopifyProduct | null> {
    return this.products.get(handle) || null;
  }

  /**
   * Helper to simulate Shopify price change in tests
   */
  public updatePrice(idOrHandle: string | number, newPrice: number): ShopifyProduct | null {
    const prod = this.products.get(String(idOrHandle));
    if (prod && prod.variants.length > 0) {
      prod.variants[0].price = newPrice.toFixed(2);
      return prod;
    }
    return null;
  }

  /**
   * Helper to simulate Shopify inventory drop to 0 (out of stock)
   */
  public updateInventory(idOrHandle: string | number, qty: number): ShopifyProduct | null {
    const prod = this.products.get(String(idOrHandle));
    if (prod && prod.variants.length > 0) {
      prod.variants[0].inventory_quantity = qty;
      return prod;
    }
    return null;
  }
}

export const mockShopifyClient = new MockShopifyClient();

