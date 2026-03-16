/**
 * Email service abstraction — vendor-isolated.
 * Local: logs to console. Production: Amazon SES via HTTP API (SigV4).
 *
 * See AGENTS.md — this is a vendor isolation boundary.
 */

import type { AppEnv } from '../config/app-env';

export interface EmailService {
  send(to: string, subject: string, textBody: string, htmlBody?: string): Promise<void>;
}

export function createLocalEmailService(): EmailService {
  return {
    async send(to, subject, textBody) {
      console.log(`\n📧 Email to ${to}`);
      console.log(`   Subject: ${subject}`);
      console.log(`   Body:\n${textBody}\n`);
    },
  };
}

export function createSesEmailService(env: AppEnv): EmailService {
  const accessKeyId = env.SES_ACCESS_KEY_ID;
  const secretAccessKey = env.SES_SECRET_ACCESS_KEY;
  const region = env.SES_REGION || 'us-east-1';
  const from = env.SES_FROM;

  if (!accessKeyId || !secretAccessKey || !from) {
    console.warn('SES not configured — falling back to console logging');
    return createLocalEmailService();
  }

  return {
    async send(to, subject, textBody, htmlBody) {
      const body = new URLSearchParams({
        Action: 'SendEmail',
        Version: '2010-12-01',
        'Source': from,
        'Destination.ToAddresses.member.1': to,
        'Message.Subject.Data': subject,
        'Message.Subject.Charset': 'UTF-8',
        'Message.Body.Text.Data': textBody,
        'Message.Body.Text.Charset': 'UTF-8',
      });

      if (htmlBody) {
        body.set('Message.Body.Html.Data', htmlBody);
        body.set('Message.Body.Html.Charset', 'UTF-8');
      }

      const host = `email.${region}.amazonaws.com`;
      const url = `https://${host}/`;
      const payload = body.toString();

      const now = new Date();
      const dateStamp = now.toISOString().replace(/[-:]/g, '').slice(0, 8);
      const amzDate = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');

      const headers: Record<string, string> = {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Host': host,
        'X-Amz-Date': amzDate,
      };

      const signedHeaders = Object.keys(headers)
        .map((k) => k.toLowerCase())
        .sort()
        .join(';');

      const canonicalHeaders = Object.keys(headers)
        .map((k) => `${k.toLowerCase()}:${headers[k].trim()}`)
        .sort()
        .join('\n') + '\n';

      const payloadHash = await sha256Hex(payload);

      const canonicalRequest = [
        'POST',
        '/',
        '', // no query string
        canonicalHeaders,
        signedHeaders,
        payloadHash,
      ].join('\n');

      const credentialScope = `${dateStamp}/${region}/ses/aws4_request`;
      const stringToSign = [
        'AWS4-HMAC-SHA256',
        amzDate,
        credentialScope,
        await sha256Hex(canonicalRequest),
      ].join('\n');

      const signingKey = await getSignatureKey(secretAccessKey, dateStamp, region, 'ses');
      const signature = await hmacHex(signingKey, stringToSign);

      headers['Authorization'] =
        `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, ` +
        `SignedHeaders=${signedHeaders}, ` +
        `Signature=${signature}`;

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: payload,
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`SES send failed (${response.status}): ${errorBody}`);
      }
    },
  };
}

export function createEmailService(env: AppEnv): EmailService {
  if (process.env.RUNTIME === 'local') {
    return createLocalEmailService();
  }
  return createSesEmailService(env);
}

// --- AWS SigV4 helpers (Web Crypto API — works in Workers) ---

const encoder = new TextEncoder();

async function hmac(key: ArrayBuffer, data: string): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  return crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(data));
}

async function hmacHex(key: ArrayBuffer, data: string): Promise<string> {
  const sig = await hmac(key, data);
  return bufToHex(sig);
}

async function sha256Hex(data: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', encoder.encode(data));
  return bufToHex(hash);
}

function bufToHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

async function getSignatureKey(
  key: string, dateStamp: string, region: string, service: string,
): Promise<ArrayBuffer> {
  let k = await hmac(encoder.encode(`AWS4${key}`).buffer as ArrayBuffer, dateStamp);
  k = await hmac(k, region);
  k = await hmac(k, service);
  k = await hmac(k, 'aws4_request');
  return k;
}
