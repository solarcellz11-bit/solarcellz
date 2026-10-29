import axios, { AxiosInstance, AxiosError } from 'axios';
import { env } from '../config/env.js';
import { DepDistributorPricePayload, DepStoredPrice } from '../types/index.js';
import { sendAlertNotification } from './alertService.js';

export interface DepClientOptions {
  baseUrl?: string;
  apiKey?: string;
  maxRetries?: number;
  retryDelayMs?: number;
  mockMode?: boolean;
}

export class DepClient {
  private client: AxiosInstance;
  private apiKey: string;
  private maxRetries: number;
  private retryDelayMs: number;
  private mockMode: boolean;

  // In-memory store for mock testing
  private mockStore: Map<string, DepStoredPrice> = new Map();

  constructor(options?: DepClientOptions) {
    this.apiKey = options?.apiKey || env.DCIDE_API_KEY;
    const baseUrl = options?.baseUrl || env.DEP_API_BASE_URL;
    this.maxRetries = options?.maxRetries ?? env.MAX_RETRIES;
    this.retryDelayMs = options?.retryDelayMs ?? env.RETRY_DELAY_MS;
    this.mockMode =
      options?.mockMode ??
      (process.env.NODE_ENV === 'test' || this.apiKey.startsWith('mock_') || this.apiKey === '');

    this.client = axios.create({
      baseURL: baseUrl,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      timeout: 10000,
    });
  }

  public setApiKey(key: string): void {
    this.apiKey = key;
    this.client.defaults.headers.common['Authorization'] = `Bearer ${key}`;
    this.mockMode = key.startsWith('mock_') || key === '';
  }

  public getMockStore(): Map<string, DepStoredPrice> {
    return this.mockStore;
  }

  /**
   * PUT /api/distributor-prices/{dcideId}
   * Upsert price, lead time, sku, and url for a single product.
   */
  public async upsertPrice(
    dcideId: string,
    payload: DepDistributorPricePayload
  ): Promise<{ success: boolean; data?: any; error?: string; statusCode?: number }> {
    this.validatePayload(dcideId, payload);

    if (this.mockMode) {
      // Mock in-memory response
      this.mockStore.set(dcideId, {
        dcideId,
        price: payload.price,
        leadTime: payload.leadTime,
        sku: payload.sku,
        url: payload.url,
        updatedAt: new Date().toISOString(),
      });
      return { success: true, statusCode: 200, data: { dcideId, ...payload } };
    }

    return this.executeWithRetry(async () => {
      const response = await this.client.put(`/api/distributor-prices/${dcideId}`, payload);
      return {
        success: true,
        statusCode: response.status,
        data: response.data,
      };
    }, `upsertPrice [${dcideId}]`);
  }

  /**
   * GET /api/distributor-prices
   * Fetch all stored distributor prices for Solar Cellz on DCIDE.
   */
  public async getAllStoredPrices(): Promise<{
    success: boolean;
    data: DepStoredPrice[];
    error?: string;
    statusCode?: number;
  }> {
    if (this.mockMode) {
      return {
        success: true,
        statusCode: 200,
        data: Array.from(this.mockStore.values()),
      };
    }

    return this.executeWithRetry(async () => {
      const response = await this.client.get('/api/distributor-prices');
      const items = Array.isArray(response.data)
        ? response.data
        : response.data?.docs || response.data?.items || [];
      return {
        success: true,
        statusCode: response.status,
        data: items,
      };
    }, 'getAllStoredPrices');
  }

  /**
   * DELETE /api/distributor-prices/{dcideId}
   * Withdraw a product that is discontinued or unmapped.
   */
  public async deletePrice(
    dcideId: string
  ): Promise<{ success: boolean; error?: string; statusCode?: number }> {
    if (this.mockMode) {
      this.mockStore.delete(dcideId);
      return { success: true, statusCode: 200 };
    }

    return this.executeWithRetry(async () => {
      const response = await this.client.delete(`/api/distributor-prices/${dcideId}`);
      return {
        success: true,
        statusCode: response.status,
      };
    }, `deletePrice [${dcideId}]`);
  }

  /**
   * GET /api/distributor-prices/manufacturers/products
   * Search or list DCIDE catalog products.
   */
  public async searchProducts(query?: string): Promise<{ success: boolean; data: any[] }> {
    if (this.mockMode) {
      return { success: true, data: [] };
    }

    return this.executeWithRetry(async () => {
      const response = await this.client.get('/api/distributor-prices/manufacturers/products', {
        params: query ? { q: query } : {},
      });
      return {
        success: true,
        data: response.data,
      };
    }, 'searchProducts');
  }

  /**
   * Validates payload per DEP Distributor Pricing API specifications
   */
  private validatePayload(dcideId: string, payload: DepDistributorPricePayload): void {
    if (!dcideId || dcideId.length !== 24) {
      console.warn(`[DEP Client] Warning: DCIDE ID '${dcideId}' is not 24 characters.`);
    }
    if (typeof payload.price !== 'number' || isNaN(payload.price) || payload.price < 0) {
      throw new Error(`Invalid price for ${dcideId}: must be a non-negative number in USD.`);
    }
    if (!payload.leadTime || payload.leadTime.length > 60) {
      throw new Error(
        `Invalid leadTime for ${dcideId}: must be non-empty and at most 60 characters (got ${payload.leadTime?.length}).`
      );
    }
    if (!payload.sku || payload.sku.trim() === '') {
      throw new Error(`Invalid sku for ${dcideId}: SKU must not be empty.`);
    }
    if (!payload.url || !payload.url.startsWith('https://')) {
      throw new Error(`Invalid url for ${dcideId}: must start with https://.`);
    }
  }

  /**
   * Retries transient network failures and 5xx / 429 status codes.
   * Immediately flags 401 (invalid API key) and 409 (SKU collision).
   */
  private async executeWithRetry<T extends Record<string, any>>(
    operation: () => Promise<T>,
    actionName: string
  ): Promise<T & { error?: string; statusCode?: number }> {
    let attempt = 0;
    let lastError: any = null;

    while (attempt <= this.maxRetries) {
      try {
        const result = await operation();
        return result as T & { error?: string; statusCode?: number };
      } catch (err: any) {
        lastError = err;
        const statusCode = err.response?.status;
        const responseData = err.response?.data;

        // Permanent auth failure: alert immediately and do not retry
        if (statusCode === 401) {
          console.error(`[DEP Client] 401 Unauthorized for ${actionName}. Invalid DCIDE_API_KEY!`);
          await sendAlertNotification({
            subject: 'CRITICAL: DEP API Key Unauthorized (401)',
            message: `DEP DCIDE API returned 401 Unauthorized during ${actionName}. Verify DCIDE_API_KEY in environment variables.`,
            details: { statusCode, responseData },
          });
          return {
            success: false,
            error: 'DEP API 401 Unauthorized: Invalid API Key',
            statusCode: 401,
          } as any;
        }

        // SKU conflict: log and alert
        if (statusCode === 409) {
          console.error(`[DEP Client] 409 Conflict for ${actionName}: SKU already exists or collision.`);
          await sendAlertNotification({
            subject: 'ALERT: DEP SKU Conflict (409)',
            message: `DEP DCIDE API returned 409 Conflict during ${actionName}. Check SKU uniqueness.`,
            details: { statusCode, responseData },
          });
          return {
            success: false,
            error: `DEP API 409 Conflict: ${JSON.stringify(responseData)}`,
            statusCode: 409,
          } as any;
        }

        // If client error (400, 404, etc.), do not retry
        if (statusCode && statusCode >= 400 && statusCode < 500 && statusCode !== 429) {
          console.error(`[DEP Client] Client error (${statusCode}) for ${actionName}:`, responseData);
          return {
            success: false,
            error: `DEP API Client Error (${statusCode}): ${JSON.stringify(responseData)}`,
            statusCode,
          } as any;
        }

        attempt++;
        if (attempt <= this.maxRetries) {
          const delay = this.retryDelayMs * Math.pow(2, attempt - 1);
          console.warn(`[DEP Client] Attempt ${attempt} failed for ${actionName}. Retrying in ${delay}ms...`);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    const finalStatus = lastError?.response?.status;
    const finalMsg = lastError?.message || 'Unknown network error';
    console.error(`[DEP Client] All retries exhausted for ${actionName}: ${finalMsg}`);

    return {
      success: false,
      error: `Network/Server failure: ${finalMsg}`,
      statusCode: finalStatus,
    } as any;
  }
}

export const depClient = new DepClient();
