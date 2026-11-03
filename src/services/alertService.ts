import nodemailer from 'nodemailer';
import axios from 'axios';
import { env } from '../config/env.js';

export interface AlertNotificationOptions {
  subject: string;
  message: string;
  details?: Record<string, any>;
  recipients?: string[];
}

export async function sendAlertNotification(options: AlertNotificationOptions): Promise<boolean> {
  const timestamp = new Date().toISOString();
  const alertPayload = {
    subject: `[Solar Cellz × DEP Alert] ${options.subject}`,
    message: options.message,
    details: options.details,
    timestamp,
  };

  console.error('\n ==================== INTEGRATION ALERT ====================');
  console.error(`Timestamp: ${timestamp}`);
  console.error(`Subject:   ${alertPayload.subject}`);
  console.error(`Message:   ${options.message}`);
  if (options.details) {
    console.error(`Details:   ${JSON.stringify(options.details, null, 2)}`);
  }
  console.error('============================================================\n');

  let sent = false;

  // 1. Send via Webhook if configured
  if (env.ALERT_WEBHOOK_URL) {
    try {
      await axios.post(env.ALERT_WEBHOOK_URL, alertPayload, { timeout: 5000 });
      console.log('[AlertService] Webhook alert sent successfully.');
      sent = true;
    } catch (err: any) {
      console.error('[AlertService] Failed to dispatch webhook alert:', err.message);
    }
  }

  // 2. Send via Email if SMTP is configured and enabled
  if (env.ALERT_EMAIL_ENABLED && env.SMTP_HOST && env.SMTP_USER) {
    try {
      const transporter = nodemailer.createTransport({
        host: env.SMTP_HOST,
        port: env.SMTP_PORT,
        secure: env.SMTP_PORT === 465,
        auth: {
          user: env.SMTP_USER,
          pass: env.SMTP_PASS,
        },
      });

      const recipientList = options.recipients || env.ALERT_EMAIL_TO.split(',').map((e) => e.trim());

      await transporter.sendMail({
        from: env.ALERT_EMAIL_FROM,
        to: recipientList,
        subject: alertPayload.subject,
        text: `${options.message}\n\nDetails:\n${JSON.stringify(options.details || {}, null, 2)}\n\nTimestamp: ${timestamp}`,
        html: `
          <div style="font-family: Arial, sans-serif; padding: 20px; border: 1px solid #e11d48; border-radius: 8px;">
            <h2 style="color: #e11d48; margin-top: 0;">${alertPayload.subject}</h2>
            <p style="font-size: 16px; color: #333;">${options.message}</p>
            ${
              options.details
                ? `<pre style="background: #f8fafc; padding: 12px; border-radius: 4px; overflow-x: auto;">${JSON.stringify(
                    options.details,
                    null,
                    2
                  )}</pre>`
                : ''
            }
            <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 20px 0;" />
            <small style="color: #64748b;">Solar Cellz × DEP Middleware • ${timestamp}</small>
          </div>
        `,
      });

      console.log(`[AlertService] Email alert sent to: ${recipientList.join(', ')}`);
      sent = true;
    } catch (err: any) {
      console.error('[AlertService] Failed to send email alert:', err.message);
    }
  }

  return sent;
}

