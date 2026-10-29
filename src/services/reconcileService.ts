import { depClient, DepClient } from './depClient.js';
import { getShopifyClient } from './shopifyClient.js';
import { SyncEngine, syncEngine } from './syncEngine.js';
import { sendAlertNotification } from './alertService.js';
import {
  ReconcileReport,
  DriftItem,
  DepStoredPrice,
  ShopifyProduct,
} from '../types/index.js';

export class ReconcileService {
  private activeDepClient: DepClient;
  private activeSyncEngine: SyncEngine;

  constructor(customDepClient?: DepClient, customSyncEngine?: SyncEngine) {
    this.activeDepClient = customDepClient || depClient;
    this.activeSyncEngine = customSyncEngine || syncEngine;
  }

  /**
   * Performs nightly reconciliation between DEP DCIDE catalog and Shopify.
   * Detects drift, optionally fixes it, and generates an audit report.
   */
  public async reconcile(autoFix: boolean = true): Promise<ReconcileReport> {
    const timestamp = new Date().toISOString();
    console.log(`\n🔍 [Reconcile] Starting reconciliation audit at ${timestamp}...`);

    // 1. Fetch DEP stored prices (GET /api/distributor-prices)
    const depResp = await this.activeDepClient.getAllStoredPrices();
    if (!depResp.success) {
      const err = `Failed to fetch DEP stored prices: ${depResp.error}`;
      console.error(`[Reconcile] ${err}`);
      await sendAlertNotification({
        subject: 'Reconcile Job Failed (DEP GET Failure)',
        message: err,
      });
      return {
        timestamp,
        totalMapped: 0,
        totalDepRecords: 0,
        syncedMatches: 0,
        driftCount: 1,
        drifts: [
          {
            dcideId: 'SYSTEM',
            sku: 'SYSTEM',
            driftType: 'MISSING_IN_DEP',
            shopifyValue: undefined,
            depValue: undefined,
            fixed: false,
            error: err,
          },
        ],
        success: false,
      };
    }

    const depRecords = depResp.data || [];
    const depMap = new Map<string, DepStoredPrice>();
    depRecords.forEach((item) => {
      depMap.set(item.dcideId, item);
    });

    // 2. Fetch current active Shopify products
    const shopifyClient = getShopifyClient();
    const shopifyProducts = await shopifyClient.getAllProducts();

    const drifts: DriftItem[] = [];
    let syncedMatches = 0;
    const visitedDcideIds = new Set<string>();

    // 3. Compare each Shopify product with DEP
    for (const product of shopifyProducts) {
      if (!product.variants || product.variants.length === 0) continue;
      const primaryVariant = product.variants[0];
      const dcideId = this.activeSyncEngine.resolveDcideId(product, primaryVariant);

      if (!dcideId) continue; // Unmapped product, skip
      visitedDcideIds.add(dcideId);

      const expectedPayload = this.activeSyncEngine.transformToDepPayload(
        product,
        primaryVariant,
        dcideId
      );

      const depRecord = depMap.get(dcideId);

      if (!depRecord) {
        // Missing in DEP
        const drift: DriftItem = {
          dcideId,
          sku: expectedPayload.sku,
          title: product.title,
          driftType: 'MISSING_IN_DEP',
          shopifyValue: `$${expectedPayload.price} (${expectedPayload.leadTime})`,
          depValue: 'NOT_FOUND_IN_DEP',
          fixed: false,
        };

        if (autoFix) {
          const syncRes = await this.activeSyncEngine.syncProduct(product);
          drift.fixed = syncRes.success;
          if (!syncRes.success) drift.error = syncRes.error;
        }

        drifts.push(drift);
        continue;
      }

      // Check Price Mismatch (tolerant of floating cents)
      const priceDiff = Math.abs(depRecord.price - expectedPayload.price);
      if (priceDiff > 0.01) {
        const drift: DriftItem = {
          dcideId,
          sku: expectedPayload.sku,
          title: product.title,
          driftType: 'PRICE_MISMATCH',
          shopifyValue: expectedPayload.price,
          depValue: depRecord.price,
          fixed: false,
        };

        if (autoFix) {
          const syncRes = await this.activeSyncEngine.syncProduct(product);
          drift.fixed = syncRes.success;
          if (!syncRes.success) drift.error = syncRes.error;
        }

        drifts.push(drift);
        continue;
      }

      // Check Lead Time Mismatch
      if (depRecord.leadTime && depRecord.leadTime !== expectedPayload.leadTime) {
        const drift: DriftItem = {
          dcideId,
          sku: expectedPayload.sku,
          title: product.title,
          driftType: 'LEAD_TIME_MISMATCH',
          shopifyValue: expectedPayload.leadTime,
          depValue: depRecord.leadTime,
          fixed: false,
        };

        if (autoFix) {
          const syncRes = await this.activeSyncEngine.syncProduct(product);
          drift.fixed = syncRes.success;
          if (!syncRes.success) drift.error = syncRes.error;
        }

        drifts.push(drift);
        continue;
      }

      // In sync!
      syncedMatches++;
    }

    // 4. Check for orphaned products in DEP that no longer exist or are inactive in Shopify
    for (const depItem of depRecords) {
      if (!visitedDcideIds.has(depItem.dcideId)) {
        const drift: DriftItem = {
          dcideId: depItem.dcideId,
          sku: depItem.sku || 'UNKNOWN',
          driftType: 'ORPHANED_IN_DEP',
          shopifyValue: 'NOT_IN_SHOPIFY',
          depValue: `$${depItem.price}`,
          fixed: false,
        };

        if (autoFix) {
          console.log(`[Reconcile] Removing orphaned DCIDE item ${depItem.dcideId} via DELETE...`);
          const delRes = await this.activeDepClient.deletePrice(depItem.dcideId);
          drift.fixed = delRes.success;
          if (!delRes.success) drift.error = delRes.error;
        }

        drifts.push(drift);
      }
    }

    const report: ReconcileReport = {
      timestamp,
      totalMapped: visitedDcideIds.size,
      totalDepRecords: depRecords.length,
      syncedMatches,
      driftCount: drifts.length,
      drifts,
      success: drifts.every((d) => d.fixed || d.driftType === 'ORPHANED_IN_DEP'),
    };

    console.log(`\n================= RECONCILE AUDIT REPORT =================`);
    console.log(`Total Mapped:   ${report.totalMapped}`);
    console.log(`Total on DEP:   ${report.totalDepRecords}`);
    console.log(`Synced Matches: ${report.syncedMatches}`);
    console.log(`Drifts Found:   ${report.driftCount}`);
    if (report.driftCount > 0) {
      console.log(`Drifts Breakdown:`);
      drifts.forEach((d) => {
        console.log(
          `  - [${d.driftType}] ${d.sku} (${d.dcideId}): Shopify='${d.shopifyValue}' vs DEP='${d.depValue}' (Fixed: ${d.fixed})`
        );
      });
    }
    console.log(`==========================================================\n`);

    if (drifts.length > 0) {
      await sendAlertNotification({
        subject: `Nightly Reconcile: ${drifts.length} Drift(s) Detected`,
        message: `Catalog drift detected between Shopify and DEP. ${
          autoFix ? 'Auto-fix was applied.' : 'No auto-fix was applied.'
        }`,
        details: { report },
      });
    }

    return report;
  }
}

export const reconcileService = new ReconcileService();

