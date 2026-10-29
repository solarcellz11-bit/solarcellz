import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { env } from '../config/env.js';
import {
  ShopifyProduct,
  ShopifyVariant,
  DepDistributorPricePayload,
  ProductCatalogMappingFile,
  ProductMapping,
} from '../types/index.js';
import { depClient, DepClient } from './depClient.js';
import { getShopifyClient } from './shopifyClient.js';
import { sendAlertNotification } from './alertService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface SyncResult {
  dcideId: string;
  sku: string;
  title?: string;
  price: number;
  leadTime: string;
  url: string;
  success: boolean;
  statusCode?: number;
  error?: string;
}

export interface BulkSyncSummary {
  totalProcessed: number;
  successful: number;
  failed: number;
  results: SyncResult[];
  startTime: string;
  endTime: string;
  durationMs: number;
}

export class SyncEngine {
  private localMappings: Map<string, ProductMapping> = new Map();
  private defaultLeadTimes: Record<string, string> = {};
  private activeDepClient: DepClient;

  constructor(customDepClient?: DepClient) {
    this.activeDepClient = customDepClient || depClient;
    this.loadLocalMappings();
  }

  private loadLocalMappings(): void {
    try {
      const possiblePaths = [
        path.resolve(process.cwd(), 'config', 'product-mappings.json'),
        path.resolve(__dirname, '..', '..', 'config', 'product-mappings.json'),
      ];

      const mappingPath = possiblePaths.find((p) => fs.existsSync(p));

      if (mappingPath) {
        const raw = fs.readFileSync(mappingPath, 'utf8');
        const data: ProductCatalogMappingFile = JSON.parse(raw);
        this.defaultLeadTimes = data.defaultLeadTimes || {};

        data.products.forEach((p) => {
          this.localMappings.set(p.dcideId, p);
          if (p.sku) this.localMappings.set(p.sku.toLowerCase(), p);
          if (p.shopifyHandle) this.localMappings.set(p.shopifyHandle.toLowerCase(), p);
        });

        console.log(`[SyncEngine] Loaded ${data.products.length} product mappings.`);
      }
    } catch (err: any) {
      console.warn('[SyncEngine] Warning: Could not read product-mappings.json:', err.message);
    }
  }

  /**
   * Resolves DCIDE ID from Shopify metafield or local mapping sheet
   */
  public resolveDcideId(product: ShopifyProduct, variant?: ShopifyVariant): string | null {
    // 1. Check Shopify product metafield 'dep.dcide_id'
    const metafield = product.metafields?.find(
      (m) => m.namespace === 'dep' && m.key === 'dcide_id'
    );
    if (metafield && metafield.value?.trim()) {
      return metafield.value.trim();
    }

    // 2. Check by SKU
    if (variant?.sku && this.localMappings.has(variant.sku.toLowerCase())) {
      return this.localMappings.get(variant.sku.toLowerCase())!.dcideId;
    }

    // 3. Check by handle
    if (product.handle && this.localMappings.has(product.handle.toLowerCase())) {
      return this.localMappings.get(product.handle.toLowerCase())!.dcideId;
    }

    return null;
  }

  /**
   * Computes the lead time according to DEP rules:
   * "In stock" when inventory > 0, or custom restock lead time when 0.
   */
  public determineLeadTime(product: ShopifyProduct, variant: ShopifyVariant, mapping?: ProductMapping): string {
    const qty = variant.inventory_quantity;

    // If inventory is tracked and positive, show "In stock"
    if (typeof qty === 'number' && qty > 0) {
      return env.DEFAULT_LEAD_TIME_IN_STOCK; // "In stock"
    }

    // 1. Product metafield: dep.lead_time
    const metaLeadTime = product.metafields?.find(
      (m) => m.namespace === 'dep' && m.key === 'lead_time'
    )?.value?.trim();

    if (metaLeadTime) {
      return metaLeadTime.slice(0, 60);
    }

    // 2. Mapping file specific lead time
    if (mapping?.defaultLeadTime) {
      return mapping.defaultLeadTime.slice(0, 60);
    }

    // 3. Category default if category known
    if (mapping?.category && this.defaultLeadTimes[mapping.category]) {
      return this.defaultLeadTimes[mapping.category].slice(0, 60);
    }

    // 4. Global fallback
    return env.DEFAULT_LEAD_TIME_RESTOCK.slice(0, 60);
  }

  /**
   * Converts a Shopify product & variant into DEP Distributor Pricing payload
   */
  public transformToDepPayload(
    product: ShopifyProduct,
    variant: ShopifyVariant,
    dcideId: string
  ): DepDistributorPricePayload {
    const priceNum = parseFloat(variant.price);
    if (isNaN(priceNum) || priceNum <= 0) {
      throw new Error(`Invalid price '${variant.price}' for product ${product.handle}`);
    }

    const mapping = this.localMappings.get(dcideId);
    const leadTime = this.determineLeadTime(product, variant, mapping);

    const cleanDomain = env.SHOPIFY_STORE_DOMAIN.replace(/^https?:\/\//, '').replace(/\/$/, '');
    const productUrl = mapping?.shopifyUrl || `https://${cleanDomain}/products/${product.handle}`;

    return {
      price: Math.round(priceNum * 100) / 100, // round to 2 decimal places
      leadTime,
      sku: variant.sku || mapping?.sku || `SKU-${product.id}`,
      url: productUrl,
    };
  }

  /**
   * Synchronizes a single Shopify product to DEP DCIDE
   */
  public async syncProduct(product: ShopifyProduct): Promise<SyncResult> {
    if (!product.variants || product.variants.length === 0) {
      return {
        dcideId: '',
        sku: '',
        title: product.title,
        price: 0,
        leadTime: '',
        url: '',
        success: false,
        error: 'Product has no variants',
      };
    }

    const primaryVariant = product.variants[0];
    const dcideId = this.resolveDcideId(product, primaryVariant);

    if (!dcideId) {
      return {
        dcideId: '',
        sku: primaryVariant.sku,
        title: product.title,
        price: parseFloat(primaryVariant.price) || 0,
        leadTime: '',
        url: '',
        success: false,
        error: 'No mapped DCIDE ID found for product',
      };
    }

    // If product is archived or draft, withdraw from DEP via DELETE
    if (product.status !== 'active') {
      console.log(`[SyncEngine] Product ${product.handle} is ${product.status}. Withdrawing with DELETE...`);
      const delRes = await this.activeDepClient.deletePrice(dcideId);
      return {
        dcideId,
        sku: primaryVariant.sku,
        title: product.title,
        price: 0,
        leadTime: 'Deleted (archived/draft)',
        url: '',
        success: delRes.success,
        statusCode: delRes.statusCode,
        error: delRes.error,
      };
    }

    try {
      const payload = this.transformToDepPayload(product, primaryVariant, dcideId);
      const res = await this.activeDepClient.upsertPrice(dcideId, payload);

      return {
        dcideId,
        sku: payload.sku,
        title: product.title,
        price: payload.price,
        leadTime: payload.leadTime,
        url: payload.url,
        success: res.success,
        statusCode: res.statusCode,
        error: res.error,
      };
    } catch (err: any) {
      return {
        dcideId,
        sku: primaryVariant.sku,
        title: product.title,
        price: parseFloat(primaryVariant.price) || 0,
        leadTime: '',
        url: '',
        success: false,
        error: err.message,
      };
    }
  }

  /**
   * Full bulk push of all mapped products with rate-limit pauses
   */
  public async syncAllProducts(): Promise<BulkSyncSummary> {
    const startTime = new Date();
    const shopifyClient = getShopifyClient();
    const products = await shopifyClient.getAllProducts();

    console.log(`[SyncEngine] Starting bulk push for ${products.length} products...`);
    const results: SyncResult[] = [];

    for (let i = 0; i < products.length; i++) {
      const product = products[i];
      const result = await this.syncProduct(product);
      results.push(result);

      if (result.success) {
        console.log(
          `[${i + 1}/${products.length}] [OK] ${result.sku} (${result.dcideId}) -> $${result.price} | ${result.leadTime}`
        );
      } else {
        console.warn(`[${i + 1}/${products.length}] [FAILED] ${product.title}: ${result.error}`);
      }

      // Pause between requests to respect DEP rate limits
      if (i < products.length - 1 && env.BATCH_DELAY_MS > 0) {
        await new Promise((res) => setTimeout(res, env.BATCH_DELAY_MS));
      }
    }

    const endTime = new Date();
    const successful = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    const summary: BulkSyncSummary = {
      totalProcessed: products.length,
      successful,
      failed,
      results,
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
      durationMs: endTime.getTime() - startTime.getTime(),
    };

    console.log(`\n================== BULK SYNC SUMMARY ==================`);
    console.log(`Total: ${summary.totalProcessed} | Success: ${successful} | Failed: ${failed}`);
    console.log(`Duration: ${(summary.durationMs / 1000).toFixed(2)}s`);
    console.log(`=======================================================\n`);

    if (failed > 0) {
      await sendAlertNotification({
        subject: `Bulk Sync Completed with ${failed} Failures`,
        message: `${failed} products failed to sync to DEP during bulk push.`,
        details: {
          failedItems: results.filter((r) => !r.success),
        },
      });
    }

    return summary;
  }
}

export const syncEngine = new SyncEngine();

