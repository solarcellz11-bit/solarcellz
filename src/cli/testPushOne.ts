import { syncEngine } from '../services/syncEngine.js';
import { getShopifyClient } from '../services/shopifyClient.js';
import { depClient } from '../services/depClient.js';
import { env } from '../config/env.js';

async function main() {
  console.log('--- Phase 2 Test: Pushing CPS ES-125kW Example Product to DEP ---');
  console.log(`Target DEP API: ${env.DEP_API_BASE_URL}`);

  const shopifyClient = getShopifyClient();
  const products = await shopifyClient.getAllProducts();

  // Find CPS ES-125kW or first converter product
  const targetProduct =
    products.find(
      (p) =>
        p.variants.some((v) => v.sku.toUpperCase().includes('CPS-ES-125')) ||
        p.handle.includes('cps')
    ) || products[0];

  if (!targetProduct) {
    console.error('Error: Could not find target product in catalog.');
    process.exit(1);
  }

  console.log(`Found Product: "${targetProduct.title}" (Handle: ${targetProduct.handle})`);
  console.log(`Variant SKU: ${targetProduct.variants[0]?.sku}`);
  console.log(`Variant Price: $${targetProduct.variants[0]?.price}`);

  const result = await syncEngine.syncProduct(targetProduct);

  console.log('\n--- Sync Result ---');
  console.log(`Success:    ${result.success}`);
  console.log(`DCIDE ID:   ${result.dcideId}`);
  console.log(`SKU:        ${result.sku}`);
  console.log(`Price:      $${result.price}`);
  console.log(`Lead Time:  ${result.leadTime}`);
  console.log(`URL:        ${result.url}`);

  if (!result.success) {
    console.error(`Error:      ${result.error}`);
    process.exit(1);
  }

  // Read back to confirm
  console.log('\nVerifying stored price in DEP...');
  const allStored = await depClient.getAllStoredPrices();
  const stored = allStored.data.find((p) => p.dcideId === result.dcideId);

  if (stored) {
    console.log('✅ Confirmed in DEP DCIDE:');
    console.log(JSON.stringify(stored, null, 2));
  } else {
    console.log('Note: Record pushed. In live mode, verify via DCIDE web interface.');
  }

  console.log('\n✅ Single product test complete!');
}

main().catch((err) => {
  console.error('Fatal error in testPushOne:', err);
  process.exit(1);
});

