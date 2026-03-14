/**
 * AWS MediaConvert transcode adapter — vendor-isolated.
 *
 * Uses aws4fetch for S3 presigned upload URLs.
 * Uses hand-rolled SigV4 (same pattern as email.ts) for MediaConvert CreateJob.
 *
 * See AGENTS.md — this is a vendor isolation boundary.
 */

import { AwsClient } from 'aws4fetch';
import type { AppEnv } from './config/app-env';
import type { TranscodeService, TranscodeParams, TranscodeJob } from './transcode-service';
import { outputSize } from './transcode-service';

interface AwsConfig {
  endpoint: string;
  queue: string;
  role: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  originsBucket: string;
  outputsBucket: string;
}

/** Cache the auto-discovered endpoint so we only call DescribeEndpoints once. */
let cachedEndpoint: string | null = null;
let cachedEndpointAt = 0;
const ENDPOINT_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Signed POST to a MediaConvert endpoint via SigV4.
 * Shared between DescribeEndpoints and CreateJob.
 */
async function signedMediaConvertFetch(
  config: { accessKeyId: string; secretAccessKey: string; region: string },
  url: string,
  body: string,
): Promise<Response> {
  const now = new Date();
  const dateStamp = now.toISOString().replace(/[-:]/g, '').slice(0, 8);
  const amzDate = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');

  const parsedUrl = new URL(url);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Host': parsedUrl.host,
    'X-Amz-Date': amzDate,
  };

  const signedHeaders = Object.keys(headers).map(k => k.toLowerCase()).sort().join(';');
  const canonicalHeaders = Object.keys(headers).map(k => `${k.toLowerCase()}:${headers[k].trim()}`).sort().join('\n') + '\n';
  const payloadHash = await sha256Hex(body);

  const canonicalRequest = ['POST', parsedUrl.pathname, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const credentialScope = `${dateStamp}/${config.region}/mediaconvert/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, credentialScope, await sha256Hex(canonicalRequest)].join('\n');

  const signingKey = await getSignatureKey(config.secretAccessKey, dateStamp, config.region, 'mediaconvert');
  const signature = await hmacHex(signingKey, stringToSign);

  headers['Authorization'] =
    `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return fetch(url, { method: 'POST', headers, body });
}

/**
 * Discover the account-specific MediaConvert endpoint via DescribeEndpoints.
 * Falls back to the env var if set; otherwise calls the AWS API and caches (24h TTL).
 */
async function resolveEndpoint(config: AwsConfig): Promise<string> {
  if (config.endpoint) return config.endpoint;
  if (cachedEndpoint && (Date.now() - cachedEndpointAt) < ENDPOINT_TTL_MS) return cachedEndpoint;

  const regionHost = `mediaconvert.${config.region}.amazonaws.com`;
  const url = `https://${regionHost}/2017-08-29/endpoints`;
  const body = JSON.stringify({ MaxResults: 0 });

  const res = await signedMediaConvertFetch(config, url, body);
  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`DescribeEndpoints failed (${res.status}): ${errBody}`);
  }

  const result = await res.json() as { Endpoints: { Url: string }[] };
  if (!result.Endpoints?.length) throw new Error('No MediaConvert endpoints returned');

  cachedEndpoint = result.Endpoints[0].Url;
  cachedEndpointAt = Date.now();
  return cachedEndpoint;
}

export function createAwsTranscodeService(env: AppEnv): TranscodeService {
  const config: AwsConfig = {
    endpoint: '',
    queue: env.MEDIACONVERT_QUEUE || '',
    role: env.MEDIACONVERT_ROLE || '',
    accessKeyId: env.MEDIACONVERT_ACCESS_KEY_ID || '',
    secretAccessKey: env.MEDIACONVERT_SECRET_ACCESS_KEY || '',
    region: env.MEDIACONVERT_REGION || 'us-east-1',
    originsBucket: env.S3_ORIGINALS_BUCKET || '',
    outputsBucket: env.S3_OUTPUTS_BUCKET || '',
  };

  if (!config.accessKeyId) {
    console.warn('MediaConvert not configured — transcode jobs will fail');
  }

  return {
    async headObject(key: string): Promise<boolean> {
      const client = new AwsClient({
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
        service: 's3',
        region: config.region,
      });

      const url = `https://${config.originsBucket}.s3.${config.region}.amazonaws.com/${key}`;
      const signed = await client.sign(new Request(url, { method: 'HEAD' }), { aws: { signQuery: true } });
      const res = await fetch(signed.url, { method: 'HEAD' });
      return res.ok;
    },

    async presignUpload(key: string, contentType: string): Promise<string> {
      const client = new AwsClient({
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
        service: 's3',
        region: config.region,
      });

      const url = new URL(
        `https://${config.originsBucket}.s3.${config.region}.amazonaws.com/${key}`,
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

    async createJob(params: TranscodeParams): Promise<TranscodeJob> {
      const endpoint = await resolveEndpoint(config);

      const jobDef = buildJobDefinition(params, {
        queue: config.queue,
        role: config.role,
        originsBucket: config.originsBucket,
        outputsBucket: config.outputsBucket,
      });

      const body = JSON.stringify(jobDef);
      const url = `${endpoint}/2017-08-29/jobs`;

      const response = await signedMediaConvertFetch(config, url, body);

      if (!response.ok) {
        const errorBody = await response.text();
        // Clear cached endpoint on auth/routing errors — may need re-discovery
        if (response.status === 403 || response.status === 421) {
          cachedEndpoint = null;
        }
        throw new Error(`MediaConvert CreateJob failed (${response.status}): ${errorBody}`);
      }

      const result = await response.json() as { Job: { Id: string } };
      return { jobId: result.Job.Id, key: params.key };
    },
  };
}

interface JobDefConfig {
  queue: string;
  role: string;
  originsBucket: string;
  outputsBucket: string;
}

export function buildJobDefinition(
  params: TranscodeParams,
  config: JobDefConfig,
) {
  // Scale to 1080p when dimensions are known. When unknown (client
  // couldn't parse moov atom), omit and let MediaConvert auto-detect.
  const scaled = params.width && params.height
    ? outputSize(params.width, params.height)
    : undefined;
  const sizeFields = scaled
    ? { Width: scaled.width, Height: scaled.height }
    : undefined;

  return {
    Queue: config.queue,
    Role: config.role,
    Settings: {
      Inputs: [{
        FileInput: `s3://${config.originsBucket}/${params.key}`,
        AudioSelectors: { 'Audio Selector 1': { DefaultSelection: 'DEFAULT' } },
      }],
      OutputGroups: [
        {
          CustomName: 'mp4',
          OutputGroupSettings: {
            Type: 'FILE_GROUP_OUTPUT',
            FileGroupSettings: {
              Destination: `s3://${config.outputsBucket}/${params.key}/`,
            },
          },
          Outputs: [
            {
              NameModifier: '-av1',
              ContainerSettings: { Container: 'MP4' },
              VideoDescription: {
                ...sizeFields,
                CodecSettings: {
                  Codec: 'AV1',
                  av_1_settings: {
                    MaxBitrate: 12_000_000,
                    RateControlMode: 'QVBR',
                    QvbrSettings: { QvbrQualityLevel: 7 },
                    GopSize: 2,
                    GopSizeUnits: 'SECONDS',
                  },
                },
              },
              AudioDescriptions: [{
                CodecSettings: {
                  Codec: 'AAC',
                  AacSettings: { Bitrate: 256_000, CodingMode: 'CODING_MODE_2_0', SampleRate: 48_000 },
                },
              }],
            },
            {
              NameModifier: '-h264',
              ContainerSettings: { Container: 'MP4' },
              VideoDescription: {
                ...sizeFields,
                CodecSettings: {
                  Codec: 'H_264',
                  H264Settings: {
                    MaxBitrate: 10_000_000,
                    RateControlMode: 'QVBR',
                    QvbrSettings: { QvbrQualityLevel: 7 },
                    GopSize: 2,
                    GopSizeUnits: 'SECONDS',
                  },
                },
              },
              AudioDescriptions: [{
                CodecSettings: {
                  Codec: 'AAC',
                  AacSettings: { Bitrate: 256_000, CodingMode: 'CODING_MODE_2_0', SampleRate: 48_000 },
                },
              }],
            },
          ],
        },
        {
          CustomName: 'poster',
          OutputGroupSettings: {
            Type: 'FILE_GROUP_OUTPUT',
            FileGroupSettings: {
              Destination: `s3://${config.outputsBucket}/${params.key}/`,
            },
          },
          Outputs: [{
            NameModifier: '-poster',
            ContainerSettings: { Container: 'RAW' },
            VideoDescription: {
              ...sizeFields,
              CodecSettings: {
                Codec: 'FRAME_CAPTURE',
                FrameCaptureSettings: {
                  FramerateNumerator: 1,
                  FramerateDenominator: 1,
                  MaxCaptures: 1,
                  Quality: 80,
                },
              },
            },
          }],
        },
      ],
    },
  };
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
