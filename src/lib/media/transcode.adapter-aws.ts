/**
 * AWS S3 adapter for video uploads — vendor-isolated.
 *
 * Uses aws4fetch for S3 presigned upload URLs and HEAD checks.
 *
 * See AGENTS.md — this is a vendor isolation boundary.
 */

import { AwsClient } from 'aws4fetch';
import type { AppEnv } from '../config/app-env';
import type { TranscodeService } from './transcode.service';

export function createAwsTranscodeService(env: AppEnv): TranscodeService {
  const accessKeyId = env.MEDIACONVERT_ACCESS_KEY_ID || '';
  const secretAccessKey = env.MEDIACONVERT_SECRET_ACCESS_KEY || '';
  const region = env.MEDIACONVERT_REGION || 'us-east-1';
  const originsBucket = env.S3_ORIGINALS_BUCKET || '';

  if (!accessKeyId) {
    console.warn('S3 not configured — video uploads will fail');
  }

  return {
    async headObject(key: string): Promise<boolean> {
      const client = new AwsClient({
        accessKeyId,
        secretAccessKey,
        service: 's3',
        region,
      });

      const url = `https://${originsBucket}.s3.${region}.amazonaws.com/${key}`;
      const signed = await client.sign(new Request(url, { method: 'HEAD' }), { aws: { signQuery: true } });
      const res = await fetch(signed.url, { method: 'HEAD' });
      return res.ok;
    },

    async presignUpload(key: string, contentType: string): Promise<string> {
      const client = new AwsClient({
        accessKeyId,
        secretAccessKey,
        service: 's3',
        region,
      });

      const url = new URL(
        `https://${originsBucket}.s3.${region}.amazonaws.com/${key}`,
      );
      url.searchParams.set('X-Amz-Expires', '3600');

      const signed = await client.sign(
        new Request(url.toString(), {
          method: 'PUT',
          headers: { 'Content-Type': contentType },
        }),
        { aws: { signQuery: true } },
      );

      return signed.url;
    },
  };
}
