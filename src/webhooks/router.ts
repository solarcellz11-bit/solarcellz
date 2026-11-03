import { Router, Request, Response } from 'express';
import { verifyShopifyHmac } from './verifyHmac.js';
import { syncEngine } from '../services/syncEngine.js';
import { depClient } from '../services/depClient.js';
import { getShopifyClient } from '../services/shopifyClient.js';
import { ShopifyProduct } from '../types/index.js';

export const webhookRouter = Router();

// Apply HMAC verification middleware to all incoming Shopify webhooks
webhookRouter.use('/shopify', verifyShopifyHmac);

/**
 * POST /api/webhooks/shopify/products/update
 * Triggered on price, title, handle, or status changes in Shopify
 */
webhookRouter.post('/shopify/products/update', async (req: Request, res: Response): Promise<void> => {
  const product: ShopifyProduct = req.body;
  const topic = req.get('X-Shopify-Topic') || 'products/update';
  console.log(`\n [Webhook] Received ${topic} for product ID: ${product.id} (${product.handle})`);

  try {
    const result = await syncEngine.syncProduct(product);

    if (result.success) {
      console.log(`[Webhook] Successfully pushed update for ${result.sku} (${result.dcideId}) to DEP.`);
      res.status(200).json({ success: true, result });
    } else {
      console.warn(`[Webhook] Product ${product.handle} not synced: ${result.error}`);
      res.status(200).json({ success: false, reason: result.error });
    }
  } catch (err: any) {
    console.error(`[Webhook] Error processing products/update:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/webhooks/shopify/products/delete
 * Triggered when a product is deleted from Shopify
 */
webhookRouter.post('/shopify/products/delete', async (req: Request, res: Response): Promise<void> => {
  const { id } = req.body;
  console.log(`\n [Webhook] Received products/delete for product ID: ${id}`);

  try {
    // Check if we have mapped DCIDE ID in memory/mapping
    const shopifyClient = getShopifyClient();
    const existing = await shopifyClient.getProductById(id);
    let dcideId: string | null = null;

    if (existing && existing.variants.length > 0) {
      dcideId = syncEngine.resolveDcideId(existing, existing.variants[0]);
    }

    if (dcideId) {
      console.log(`[Webhook] Deleting product from DEP: DCIDE ID ${dcideId}...`);
      await depClient.deletePrice(dcideId);
      res.status(200).json({ success: true, deletedDcideId: dcideId });
    } else {
      res.status(200).json({ success: true, note: 'No DCIDE mapping found for deleted product' });
    }
  } catch (err: any) {
    console.error(`[Webhook] Error processing products/delete:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/webhooks/shopify/inventory_levels/update
 * Triggered when stock count changes (in stock vs out of stock)
 */
webhookRouter.post('/shopify/inventory_levels/update', async (req: Request, res: Response): Promise<void> => {
  const { inventory_item_id, available } = req.body;
  console.log(`\n [Webhook] Received inventory_levels/update: Item ${inventory_item_id} -> Available: ${available}`);

  try {
    const shopifyClient = getShopifyClient();
    // In mock mode or live mode, fetch products and locate matching variant
    const products = await shopifyClient.getAllProducts();
    const matchingProduct = products.find((p) =>
      p.variants.some((v) => String(v.inventory_item_id) === String(inventory_item_id))
    );

    if (matchingProduct) {
      // Update variant's inventory quantity
      const variant = matchingProduct.variants.find(
        (v) => String(v.inventory_item_id) === String(inventory_item_id)
      );
      if (variant) {
        variant.inventory_quantity = available;
      }

      const syncRes = await syncEngine.syncProduct(matchingProduct);
      console.log(`[Webhook] Inventory sync result for ${matchingProduct.handle}:`, syncRes.leadTime);
      res.status(200).json({ success: true, syncRes });
    } else {
      res.status(200).json({ success: true, note: 'Inventory item not mapped to tracked product' });
    }
  } catch (err: any) {
    console.error(`[Webhook] Error processing inventory_levels/update:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/webhooks/simulate
 * Development endpoint to simulate Shopify webhook triggers locally
 */
webhookRouter.post('/simulate', async (req: Request, res: Response): Promise<void> => {
  const { handle, price, inventory_quantity } = req.body;
  const shopifyClient = getShopifyClient();
  const products = await shopifyClient.getAllProducts();

  const product = handle
    ? products.find((p) => p.handle === handle)
    : products[0];

  if (!product) {
    res.status(404).json({ error: 'Product not found to simulate' });
    return;
  }

  if (typeof price === 'number') {
    product.variants[0].price = price.toFixed(2);
  }
  if (typeof inventory_quantity === 'number') {
    product.variants[0].inventory_quantity = inventory_quantity;
  }

  const result = await syncEngine.syncProduct(product);
  res.status(200).json({
    message: 'Simulated webhook processed',
    product: {
      handle: product.handle,
      price: product.variants[0].price,
      inventory: product.variants[0].inventory_quantity,
    },
    syncResult: result,
  });
});

