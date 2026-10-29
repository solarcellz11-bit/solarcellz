/**
 * Data contracts for DEP (Direct Energy Partners) DCIDE Distributor Pricing API
 */
export interface DepDistributorPricePayload {
  /** Price in US dollars (number, not cents) */
  price: number;
  /** Free text, max 60 chars. e.g. 'In stock', '2-4 weeks' */
  leadTime: string;
  /** Unique product SKU / model number */
  sku: string;
  /** Live product URL on store.solarcellzusa.com (must start with https://) */
  url: string;
}

export interface DepStoredPrice {
  dcideId: string;
  price: number;
  leadTime?: string;
  sku?: string;
  url?: string;
  updatedAt?: string;
}

export interface DepApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  statusCode?: number;
}

/**
 * Shopify Data Models
 */
export interface ShopifyMetafield {
  id?: number | string;
  namespace: string;
  key: string;
  value: string;
  type?: string;
}

export interface ShopifyVariant {
  id: number | string;
  product_id?: number | string;
  title: string;
  price: string; // e.g. "18450.00"
  sku: string;
  inventory_quantity?: number;
  inventory_item_id?: number | string;
}

export interface ShopifyProduct {
  id: number | string;
  title: string;
  handle: string;
  status: string; // 'active' | 'archived' | 'draft'
  variants: ShopifyVariant[];
  metafields?: ShopifyMetafield[];
}

export interface ShopifyWebhookProductPayload extends ShopifyProduct {
  admin_graphql_api_id?: string;
  updated_at?: string;
}

export interface ShopifyWebhookInventoryPayload {
  inventory_item_id: number;
  location_id: number;
  available: number;
  updated_at: string;
}

/**
 * Product Mapping Configuration
 */
export interface ProductMapping {
  dcideId: string;
  sku: string;
  title?: string;
  category?: string;
  shopifyHandle?: string;
  shopifyUrl?: string;
  defaultLeadTime?: string;
  samplePrice?: number;
}

export interface ProductCatalogMappingFile {
  description: string;
  version: string;
  defaultLeadTimes: Record<string, string>;
  products: ProductMapping[];
}

/**
 * Reconcile & Audit Types
 */
export type DriftType =
  | 'PRICE_MISMATCH'
  | 'LEAD_TIME_MISMATCH'
  | 'MISSING_IN_DEP'
  | 'ORPHANED_IN_DEP'
  | 'SKU_MISMATCH'
  | 'URL_MISMATCH';

export interface DriftItem {
  dcideId: string;
  sku: string;
  title?: string;
  driftType: DriftType;
  shopifyValue: string | number | undefined;
  depValue: string | number | undefined;
  fixed: boolean;
  error?: string;
}

export interface ReconcileReport {
  timestamp: string;
  totalMapped: number;
  totalDepRecords: number;
  syncedMatches: number;
  driftCount: number;
  drifts: DriftItem[];
  success: boolean;
}

