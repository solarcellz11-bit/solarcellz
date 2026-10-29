import { syncEngine } from '../services/syncEngine.js';
import { env, isMockShopifyActive } from '../config/env.js';

async function main() {
  console.log('===========================================================');
  console.log('⚡ Starting Full Bulk Push: Solar Cellz -> DEP DCIDE');
  console.log(`Store:       ${env.SHOPIFY_STORE_DOMAIN}`);
  console.log(`Shopify:     ${isMockShopifyActive() ? 'MOCK CATALOG' : 'LIVE ADMIN API'}`);
  console.log(`DEP Base:    ${env.DEP_API_BASE_URL}`);
  console.log(`Rate Delay:  ${env.BATCH_DELAY_MS}ms between requests`);
  console.log('===========================================================\n');

  const summary = await syncEngine.syncAllProducts();

  if (summary.failed > 0) {
    console.error(`⚠️  Bulk push finished with ${summary.failed} errors.`);
    process.exit(1);
  } else {
    console.log(`🎉 Bulk push completed successfully! All ${summary.successful} products synced to DEP.`);
    process.exit(0);
  }
}

main().catch((err) => {
  console.error('Fatal error during syncAll:', err);
  process.exit(1);
});

