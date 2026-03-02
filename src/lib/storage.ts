import { AwsClient } from 'aws4fetch';

export interface StorageEnv {
  R2: R2Bucket;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
  R2_ACCOUNT_ID: string;
  R2_BUCKET_NAME: string;
}

export interface UploadMetadata {
  key: string;
  size: number;
  contentType: string;
}

/**
 * Generate an 8-character random alphanumeric key (base36).
 * Checks for collision against R2 before returning.
 */
export async function generateMediaKey(r2: R2Bucket): Promise<string> {
  const maxAttempts = 10;
  for (let i = 0; i < maxAttempts; i++) {
    const key = randomKey();
    const existing = await r2.head(`photos/${key}`);
    if (!existing) {
      return key;
    }
  }
  throw new Error('Failed to generate unique media key after maximum attempts');
}

/**
 * Generate an 8-character random alphanumeric string using base36.
 */
export function randomKey(): string {
  const chars = '0123456789abcdefghijklmnopqrstuvwxyz';
  const limit = 252; // 36 * 7 — largest multiple of 36 that fits in a byte
  let result = '';
  while (result.length < 8) {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    for (const b of bytes) {
      if (b < limit && result.length < 8) {
        result += chars[b % 36];
      }
    }
  }
  return result;
}

/**
 * Create a presigned URL for uploading to R2 at photos/{key}.
 * Returns a signed PUT URL with 1-hour expiry.
 */
export async function createPresignedUploadUrl(
  env: StorageEnv,
  key: string,
  contentType: string,
): Promise<string> {
  const client = new AwsClient({
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    service: 's3',
    region: 'auto',
  });

  const url = new URL(
    `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${env.R2_BUCKET_NAME}/photos/${key}`,
  );
  url.searchParams.set('X-Amz-Expires', '3600');

  const signed = await client.sign(
    new Request(url.toString(), {
      method: 'PUT',
      headers: {
        'Content-Type': contentType,
      },
    }),
    { aws: { signQuery: true } },
  );

  return signed.url;
}

/**
 * Confirm an upload exists in R2 at photos/{key}.
 * Returns metadata about the uploaded object.
 */
export async function confirmUpload(
  r2: R2Bucket,
  key: string,
): Promise<UploadMetadata> {
  const object = await r2.head(`photos/${key}`);
  if (!object) {
    throw new Error(`Object not found: photos/${key}`);
  }
  return {
    key,
    size: object.size,
    contentType: object.httpMetadata?.contentType ?? 'application/octet-stream',
  };
}

/**
 * Delete an object from R2 at photos/{key}.
 */
export async function deleteMedia(r2: R2Bucket, key: string): Promise<void> {
  await r2.delete(`photos/${key}`);
}
