import dotenv from 'dotenv';
import { z } from 'zod';
import path from 'path';

dotenv.config();

const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  // DEP DCIDE Settings
  DEP_API_BASE_URL: z.string().url().default('https://api.directenergypartners.com'),
  DCIDE_API_KEY: z.string().default(''),

  // Shopify Settings
  SHOPIFY_STORE_DOMAIN: z.string().default('p2bgv0-0e.myshopify.com'),
  SHOPIFY_PUBLIC_DOMAIN: z.string().default('store.solarcellzusa.com'),
  SHOPIFY_ADMIN_ACCESS_TOKEN: z.string().optional().default(''),
  SHOPIFY_API_VERSION: z.string().default('2024-10'),
  SHOPIFY_WEBHOOK_SECRET: z.string().default(''),

  // Mock / Offline mode for testing prior to live token arrival
  USE_MOCK_SHOPIFY: z.preprocess((val) => {
    if (typeof val === 'string') return val.toLowerCase() === 'true' || val === '1';
    return Boolean(val);
  }, z.boolean()).default(true),

  // Rate Limiting & Throttling
  BATCH_DELAY_MS: z.coerce.number().default(200),
  MAX_RETRIES: z.coerce.number().default(3),
  RETRY_DELAY_MS: z.coerce.number().default(500),

  // Lead Times
  DEFAULT_LEAD_TIME_IN_STOCK: z.string().max(60).default('In stock'),
  DEFAULT_LEAD_TIME_RESTOCK: z.string().max(60).default('2-4 weeks'),

  // Alerts
  ALERT_EMAIL_ENABLED: z.preprocess((val) => {
    if (typeof val === 'string') return val.toLowerCase() === 'true' || val === '1';
    return Boolean(val);
  }, z.boolean()).default(false),
  ALERT_EMAIL_TO: z.string().default('nathan@solarcellzusa.com,deven@devenwebstudio.com'),
  ALERT_EMAIL_FROM: z.string().default('alerts@solarcellzusa.com'),
  SMTP_HOST: z.string().optional().default(''),
  SMTP_PORT: z.coerce.number().optional().default(587),
  SMTP_USER: z.string().optional().default(''),
  SMTP_PASS: z.string().optional().default(''),
  ALERT_WEBHOOK_URL: z.string().optional().default(''),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment variables:', parsed.error.format());
  throw new Error('Environment configuration error');
}

export const env = parsed.data;

// If in test environment or no Shopify token is provided, enforce mock mode automatically
export const isMockShopifyActive = (): boolean => {
  return env.NODE_ENV === 'test' || env.USE_MOCK_SHOPIFY || !env.SHOPIFY_ADMIN_ACCESS_TOKEN;
};

