import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { env } from '../config/env.js';

export function verifyShopifyHmac(req: Request, res: Response, next: NextFunction): void {
  const hmacHeader = req.get('X-Shopify-Hmac-Sha256');

  // Allow bypass in development if no secret is configured
  if (!env.SHOPIFY_WEBHOOK_SECRET || env.NODE_ENV === 'test') {
    if (!hmacHeader && !env.SHOPIFY_WEBHOOK_SECRET) {
      console.warn('[Webhook] No SHOPIFY_WEBHOOK_SECRET configured; skipping HMAC verification.');
    }
    return next();
  }

  if (!hmacHeader) {
    console.error('[Webhook] Missing X-Shopify-Hmac-Sha256 header.');
    res.status(401).json({ error: 'Missing HMAC signature' });
    return;
  }

  const rawBody = (req as any).rawBody;
  if (!rawBody) {
    console.error('[Webhook] Raw body not available for HMAC verification.');
    res.status(500).json({ error: 'Raw body buffer missing' });
    return;
  }

  try {
    const generatedHmac = crypto
      .createHmac('sha256', env.SHOPIFY_WEBHOOK_SECRET)
      .update(rawBody)
      .digest('base64');

    const generatedBuffer = Buffer.from(generatedHmac, 'utf8');
    const headerBuffer = Buffer.from(hmacHeader, 'utf8');

    if (
      generatedBuffer.length === headerBuffer.length &&
      crypto.timingSafeEqual(generatedBuffer, headerBuffer)
    ) {
      return next();
    } else {
      console.error('[Webhook] HMAC signature verification failed.');
      res.status(401).json({ error: 'Invalid HMAC signature' });
      return;
    }
  } catch (err: any) {
    console.error('[Webhook] Error calculating HMAC:', err.message);
    res.status(500).json({ error: 'Internal HMAC verification error' });
    return;
  }
}

