import { AwsClient } from 'aws4fetch';
import { parseImageDimensions } from './image-dimensions';

export interface StorageEnv {
  BUCKET: BucketLike;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
  R2_ACCOUNT_ID: string;
  R2_BUCKET_NAME: string;
  STORAGE_KEY_PREFIX?: string;
}

export interface BucketLike {
  head: (key: string) => Promise<{ size: number; httpMetadata?: { contentType?: string } } | null>;
  get: (key: string) => Promise<{ arrayBuffer: () => Promise<ArrayBuffer> } | null>;
  put: (key: string, data: ArrayBuffer | ReadableStream | string | Uint8Array) => Promise<unknown>;
  delete: (key: string) => Promise<void>;
}

export interface UploadMetadata {
  key: string;
  size: number;
  contentType: string;
  width: number;
  height: number;
}

/**
 * Generate an 8-character random alphanumeric key (base36).
 * Checks for collision against R2 before returning.
 */
export async function generateMediaKey(
  r2: { head: (key: string) => Promise<unknown> },
  prefix = '',
): Promise<string> {
  const maxAttempts = 10;
  for (let i = 0; i < maxAttempts; i++) {
    const key = randomKey();
    const existing = await r2.head(`${prefix}${key}`);
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
 * Create a presigned URL for uploading to R2 at {prefix}uploads/pending/{key}.
 * Returns a signed PUT URL with 1-hour expiry.
 * The prefix (from STORAGE_KEY_PREFIX) isolates staging uploads in the shared bucket.
 */
export async function createPresignedUploadUrl(
  env: StorageEnv,
  key: string,
  contentType: string,
): Promise<string> {
  const prefix = env.STORAGE_KEY_PREFIX || '';

  if (process.env.RUNTIME === 'local') {
    return `/api/dev/upload?key=${key}&contentType=${encodeURIComponent(contentType)}`;
  }

  const client = new AwsClient({
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    service: 's3',
    region: 'auto',
  });

  const url = new URL(
    `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${env.R2_BUCKET_NAME}/${prefix}uploads/pending/${key}`,
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
 * Confirm an upload by validating the pending image, extracting dimensions,
 * promoting to {prefix}{key} (bucket root), and cleaning up the pending file.
 *
 * Returns the full R2 object path as `key` (e.g. "abc123" or
 * "staging/abc123") so it can be used directly in CDN URLs.
 * Files are stored at the bucket root (matching Rails ActiveStorage convention).
 */
export async function confirmUpload(
  bucket: BucketLike,
  key: string,
  prefix = '',
): Promise<UploadMetadata> {
  const pendingKey = `${prefix}uploads/pending/${key}`;
  const object = await bucket.get(pendingKey);
  if (!object) {
    throw new Error(`Pending upload not found: ${pendingKey}`);
  }

  const buffer = await object.arrayBuffer();
  const dimensions = parseImageDimensions(buffer);
  if (!dimensions) {
    // Not a valid image — clean up and reject
    await bucket.delete(pendingKey);
    throw new Error('Invalid image: could not parse dimensions from file header');
  }

  // Promote to bucket root (matching Rails convention)
  const mediaKey = `${prefix}${key}`;
  await bucket.put(mediaKey, buffer);
  await bucket.delete(pendingKey);

  return {
    key: mediaKey,
    size: buffer.byteLength,
    contentType: `image/${dimensions.format}`,
    width: dimensions.width,
    height: dimensions.height,
  };
}

/**
 * Delete an object from R2 at {prefix}{key}.
 */
export async function deleteMedia(
  bucket: BucketLike,
  key: string,
  prefix = '',
): Promise<void> {
  await bucket.delete(`${prefix}${key}`);
}
