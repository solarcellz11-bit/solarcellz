import { reconcileService } from '../services/reconcileService.js';
import { env } from '../config/env.js';

async function main() {
  console.log('===========================================================');
  console.log(' Running Catalog Reconcile & Audit (Shopify vs DEP DCIDE)');
  console.log(`DEP Endpoint:   ${env.DEP_API_BASE_URL}`);
  console.log(`Auto-fix Drift: ENABLED`);
  console.log('===========================================================\n');

  const report = await reconcileService.reconcile(true);

  if (report.driftCount > 0) {
    console.log(`ℹ️  Found ${report.driftCount} drifts. Auto-fix applied.`);
  } else {
    console.log(' Catalog is 100% in sync! No discrepancies detected.');
  }

  process.exit(report.success ? 0 : 1);
}

main().catch((err) => {
  console.error('Fatal error during reconcile:', err);
  process.exit(1);
});

