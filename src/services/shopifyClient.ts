import axios, { AxiosInstance } from 'axios';
import { env, isMockShopifyActive } from '../config/env.js';
import { ShopifyProduct, ShopifyMetafield } from '../types/index.js';
import { mockShopifyClient, MockShopifyClient } from './mockShopifyClient.js';

export interface IShopifyClient {
  getAllProducts(): Promise<ShopifyProduct[]>;
  getProductById(id: string | number): Promise<ShopifyProduct | null>;
  getProductByInventoryItemId?(inventoryItemId: string | number): Promise<ShopifyProduct | null>;
}

export class LiveShopifyClient implements IShopifyClient {
  private client: AxiosInstance;
  private storeDomain: string;
  private apiVersion: string;

  constructor() {
    this.storeDomain = env.SHOPIFY_STORE_DOMAIN.replace(/^https?:\/\//, '').replace(/\/$/, '');
    this.apiVersion = env.SHOPIFY_API_VERSION;

    this.client = axios.create({
      baseURL: `https://${this.storeDomain}/admin/api/${this.apiVersion}`,
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': env.SHOPIFY_ADMIN_ACCESS_TOKEN,
      },
      timeout: 15000,
    });
  }

  /**
   * Fetches all active products along with their variants and dep.* metafields.
   */
  public async getAllProducts(): Promise<ShopifyProduct[]> {
    try {
      const query = `
        query getProducts($cursor: String) {
          products(first: 100, after: $cursor, query: "status:active") {
            pageInfo {
              hasNextPage
              endCursor
            }
            edges {
              node {
                id
                legacyResourceId
                title
                handle
                status
                variants(first: 20) {
                  edges {
                    node {
                      id
                      legacyResourceId
                      title
                      price
                      sku
                      inventoryQuantity
                      inventoryItem {
                        id
                        legacyResourceId
                      }
                    }
                  }
                }
                metafields(first: 20, namespace: "dep") {
                  edges {
                    node {
                      id
                      namespace
                      key
                      value
                      type
                    }
                  }
                }
              }
            }
          }
        }
      `;

      let hasNextPage = true;
      let cursor: string | null = null;
      const allProducts: ShopifyProduct[] = [];

      while (hasNextPage) {
        const response: any = await this.client.post('/graphql.json', {
          query,
          variables: { cursor },
        });

        if (response.data.errors) {
          throw new Error(`GraphQL Error: ${JSON.stringify(response.data.errors)}`);
        }

        const data: any = response.data.data.products;
        for (const edge of data.edges) {
          const node = edge.node;
          const variants = node.variants.edges.map((vEdge: any) => ({
            id: vEdge.node.legacyResourceId || vEdge.node.id,
            title: vEdge.node.title,
            price: vEdge.node.price,
            sku: vEdge.node.sku || '',
            inventory_quantity: vEdge.node.inventoryQuantity,
            inventory_item_id: vEdge.node.inventoryItem?.legacyResourceId,
          }));

          const metafields = node.metafields.edges.map((mEdge: any) => ({
            id: mEdge.node.id,
            namespace: mEdge.node.namespace,
            key: mEdge.node.key,
            value: mEdge.node.value,
            type: mEdge.node.type,
          }));

          allProducts.push({
            id: node.legacyResourceId || node.id,
            title: node.title,
            handle: node.handle,
            status: node.status.toLowerCase(),
            variants,
            metafields,
          });
        }

        hasNextPage = data.pageInfo.hasNextPage;
        cursor = data.pageInfo.endCursor;
      }

      return allProducts;
    } catch (err: any) {
      console.error('[ShopifyClient] Error fetching products:', err.message);
      throw err;
    }
  }

  /**
   * Fetches single product by Shopify numeric or GraphQL ID
   */
  public async getProductById(id: string | number): Promise<ShopifyProduct | null> {
    try {
      const numericId = String(id).replace(/\D/g, '');
      const response = await this.client.get(`/products/${numericId}.json`);
      const prod = response.data.product;

      // Also fetch metafields for this product
      const metaResp = await this.client.get(`/products/${numericId}/metafields.json`);
      const metafields: ShopifyMetafield[] = metaResp.data.metafields || [];

      return {
        id: prod.id,
        title: prod.title,
        handle: prod.handle,
        status: prod.status,
        variants: prod.variants.map((v: any) => ({
          id: v.id,
          product_id: v.product_id,
          title: v.title,
          price: String(v.price),
          sku: v.sku || '',
          inventory_quantity: v.inventory_quantity,
          inventory_item_id: v.inventory_item_id,
        })),
        metafields,
      };
    } catch (err: any) {
      if (err.response?.status === 404) return null;
      console.error(`[ShopifyClient] Error fetching product ${id}:`, err.message);
      throw err;
    }
  }

  /**
   * Lookup product when inventory_levels webhook fires
   */
  public async getProductByInventoryItemId(inventoryItemId: string | number): Promise<ShopifyProduct | null> {
    try {
      const response = await this.client.get(`/inventory_items/${inventoryItemId}.json`);
      // In Shopify, inventory_item belongs to a variant, fetch variant
      return null;
    } catch (err: any) {
      console.error(`[ShopifyClient] Error fetching inventory item ${inventoryItemId}:`, err.message);
      return null;
    }
  }
}

let liveClientInstance: LiveShopifyClient | null = null;

export function getShopifyClient(): IShopifyClient {
  if (isMockShopifyActive()) {
    return mockShopifyClient;
  }

  if (!liveClientInstance) {
    liveClientInstance = new LiveShopifyClient();
  }
  return liveClientInstance;
}
