/**
 * Video Agent Lambda — handles the full video lifecycle.
 *
 * Two event paths:
 * 1. S3 ObjectCreated → ffprobe → MediaConvert job → webhook
 * 2. EventBridge MediaConvert completion → webhook
 */

import { execFile } from 'node:child_process';
import { writeFile, unlink } from 'node:fs/promises';
import { promisify } from 'node:util';
// Lazy-loaded to avoid import failure when running pure-function tests without node_modules
let _mcModule;
async function getMcClient() {
  _mcModule ??= await import('@aws-sdk/client-mediaconvert');
  return _mcModule;
}

const execFileAsync = promisify(execFile);

/** Read env vars lazily so tests can set them in beforeEach. */
function cfg() {
  return {
    S3_ORIGINALS_BUCKET: process.env.S3_ORIGINALS_BUCKET,
    S3_OUTPUTS_BUCKET: process.env.S3_OUTPUTS_BUCKET,
    MEDIACONVERT_QUEUE: process.env.MEDIACONVERT_QUEUE,
    MEDIACONVERT_ROLE: process.env.MEDIACONVERT_ROLE,
    MEDIACONVERT_ENDPOINT: process.env.MEDIACONVERT_ENDPOINT,
    WEBHOOK_MAP: process.env.WEBHOOK_MAP,
    WEBHOOK_SECRET: process.env.WEBHOOK_SECRET,
    region: process.env.AWS_REGION || 'us-east-1',
  };
}

// --- Output size calculation (matches src/lib/media/transcode.service.ts) ---

export function outputSize(width, height) {
  const maxLong = 1920;
  const maxShort = 1080;
  const landscape = width >= height;
  const longEdge = landscape ? width : height;
  const shortEdge = landscape ? height : width;
  const scale = Math.min(maxLong / longEdge, maxShort / shortEdge, 1);
  if (scale >= 1) return { width, height };
  return {
    width: Math.round((width * scale) / 2) * 2,
    height: Math.round((height * scale) / 2) * 2,
  };
}

/** Thumbnail size for HLS low-bandwidth tier (~480p). */
export function thumbSize(width, height) {
  const maxLong = 640;
  const maxShort = 480;
  const landscape = width >= height;
  const longEdge = landscape ? width : height;
  const shortEdge = landscape ? height : width;
  const scale = Math.min(maxLong / longEdge, maxShort / shortEdge, 1);
  if (scale >= 1) return { width, height };
  return {
    width: Math.round((width * scale) / 2) * 2,
    height: Math.round((height * scale) / 2) * 2,
  };
}

// --- ffprobe ---

/**
 * Download an S3 object to /tmp/input and run ffprobe on it.
 * Returns parsed video stream metadata.
 */
export async function probeVideo(bucket, key) {
  const { S3Client, GetObjectCommand } = await import('@aws-sdk/client-s3');
  const s3 = new S3Client({ region: cfg().region });
  const tmpPath = '/tmp/input';

  const { Body } = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const chunks = [];
  for await (const chunk of Body) chunks.push(chunk);
  await writeFile(tmpPath, Buffer.concat(chunks));

  try {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_streams', '-show_format',
      '-i', tmpPath,
    ]);
    return parseProbeOutput(JSON.parse(stdout));
  } finally {
    await unlink(tmpPath).catch(() => {});
  }
}

/**
 * Extract video metadata from ffprobe JSON output.
 * Handles rotation from side_data_list (iPhone portrait videos).
 */
export function parseProbeOutput(probeData) {
  const videoStream = probeData.streams?.find(s => s.codec_type === 'video');
  if (!videoStream) throw new Error('No video stream found');

  let width = videoStream.width;
  let height = videoStream.height;
  const duration = parseFloat(probeData.format?.duration || videoStream.duration || '0');

  // Check for rotation in side_data_list (common with iPhone videos)
  let rotation = 0;
  const sideData = videoStream.side_data_list || [];
  for (const sd of sideData) {
    if (sd.rotation != null) {
      rotation = Math.abs(parseInt(sd.rotation, 10));
    }
  }
  // Also check the deprecated 'tags.rotate' field
  if (!rotation && videoStream.tags?.rotate) {
    rotation = Math.abs(parseInt(videoStream.tags.rotate, 10));
  }

  // Swap dimensions for 90/270 degree rotation
  if (rotation === 90 || rotation === 270) {
    [width, height] = [height, width];
  }

  const orientation = width > height ? 'landscape' : 'portrait';

  // Extract capture date if available
  const capturedAt = videoStream.tags?.creation_time
    || probeData.format?.tags?.creation_time
    || null;

  // Extract GPS if available (some cameras embed it)
  const locationTag = probeData.format?.tags?.location
    || probeData.format?.tags?.['com.apple.quicktime.location.ISO6709']
    || null;
  const gps = locationTag ? parseLocationTag(locationTag) : null;

  return { width, height, duration, orientation, rotation, capturedAt, gps };
}

/**
 * Parse ISO 6709 location strings like "+48.8566+002.3522+035.000/"
 */
function parseLocationTag(tag) {
  const match = tag.match(/([+-]\d+\.\d+)([+-]\d+\.\d+)/);
  if (!match) return null;
  return { lat: parseFloat(match[1]), lng: parseFloat(match[2]) };
}

// --- MediaConvert job ---

/** Cached endpoint for the session. */
let cachedEndpoint = null;

async function getMediaConvertEndpoint() {
  const { MEDIACONVERT_ENDPOINT, region } = cfg();
  if (MEDIACONVERT_ENDPOINT) return MEDIACONVERT_ENDPOINT;
  if (cachedEndpoint) return cachedEndpoint;

  const { MediaConvertClient, DescribeEndpointsCommand } = await getMcClient();
  const client = new MediaConvertClient({ region });
  const { Endpoints } = await client.send(new DescribeEndpointsCommand({ MaxResults: 0 }));
  if (!Endpoints?.length) throw new Error('No MediaConvert endpoints returned');
  cachedEndpoint = Endpoints[0].Url;
  return cachedEndpoint;
}

const MAX_DURATION_SECONDS = 180;

export function buildJobDefinition(key, { width, height, duration }) {
  const { S3_ORIGINALS_BUCKET, S3_OUTPUTS_BUCKET, MEDIACONVERT_QUEUE, MEDIACONVERT_ROLE } = cfg();
  const big = outputSize(width, height);
  const thumb = thumbSize(width, height);
  const bigFields = { Width: big.width, Height: big.height };
  const thumbFields = { Width: thumb.width, Height: thumb.height };

  const aacAudio = [{
    CodecSettings: {
      Codec: 'AAC',
      AacSettings: { Bitrate: 256_000, CodingMode: 'CODING_MODE_2_0', SampleRate: 48_000 },
    },
  }];

  // Split key "ottawa-staging/testkey5" → prefix + videoKey for EventBridge handler
  const slashIdx = key.indexOf('/');
  const prefix = slashIdx > 0 ? key.slice(0, slashIdx) : '';
  const videoKey = slashIdx > 0 ? key.slice(slashIdx + 1) : key;

  return {
    Queue: MEDIACONVERT_QUEUE,
    Role: MEDIACONVERT_ROLE,
    UserMetadata: { prefix, videoKey },
    Settings: {
      Inputs: [{
        FileInput: `s3://${S3_ORIGINALS_BUCKET}/${key}`,
        VideoSelector: { Rotate: 'AUTO' },
        AudioSelectors: { 'Audio Selector 1': { DefaultSelection: 'DEFAULT' } },
        TimecodeSource: 'ZEROBASED',
        ...(duration > MAX_DURATION_SECONDS && {
          InputClippings: [{ EndTimecode: '00:03:00:00' }],
        }),
      }],
      TimecodeConfig: { Source: 'ZEROBASED' },
      OutputGroups: [
        // MP4 output: H.264 universal (HLS handles H.265 adaptive delivery)
        {
          CustomName: 'mp4',
          OutputGroupSettings: {
            Type: 'FILE_GROUP_SETTINGS',
            FileGroupSettings: {
              Destination: `s3://${S3_OUTPUTS_BUCKET}/${key}/`,
            },
          },
          Outputs: [
            {
              NameModifier: '-h264',
              ContainerSettings: { Container: 'MP4' },
              VideoDescription: {
                ...bigFields,
                CodecSettings: {
                  Codec: 'H_264',
                  H264Settings: {
                    MaxBitrate: 10_000_000,
                    RateControlMode: 'QVBR',
                    QvbrSettings: { QvbrQualityLevel: 7 },
                    SceneChangeDetect: 'TRANSITION_DETECTION',
                    QualityTuningLevel: 'MULTI_PASS_HQ',
                  },
                },
              },
              AudioDescriptions: aacAudio,
            },
          ],
        },
        // HLS adaptive: both H.265 (no codec switch mid-stream)
        {
          CustomName: 'hls',
          OutputGroupSettings: {
            Type: 'HLS_GROUP_SETTINGS',
            HlsGroupSettings: {
              SegmentLength: 3,
              MinSegmentLength: 0,
              Destination: `s3://${S3_OUTPUTS_BUCKET}/${key}/`,
            },
          },
          Outputs: [
            {
              NameModifier: '-thumb',
              ContainerSettings: { Container: 'M3U8' },
              OutputSettings: { HlsSettings: {} },
              VideoDescription: {
                ...thumbFields,
                CodecSettings: {
                  Codec: 'H_265',
                  H265Settings: {
                    MaxBitrate: 2_000_000,
                    RateControlMode: 'QVBR',
                    QvbrSettings: { QvbrQualityLevel: 7 },
                    CodecProfile: 'MAIN_MAIN',
                    WriteMp4PackagingType: 'HVC1',
                  },
                },
              },
              AudioDescriptions: aacAudio,
            },
            {
              NameModifier: '-big',
              ContainerSettings: { Container: 'M3U8' },
              OutputSettings: { HlsSettings: {} },
              VideoDescription: {
                ...bigFields,
                CodecSettings: {
                  Codec: 'H_265',
                  H265Settings: {
                    MaxBitrate: 15_000_000,
                    RateControlMode: 'QVBR',
                    QvbrSettings: { QvbrQualityLevel: 7 },
                    CodecProfile: 'MAIN_MAIN',
                    WriteMp4PackagingType: 'HVC1',
                  },
                },
              },
              AudioDescriptions: aacAudio,
            },
          ],
        },
        // Poster frame
        {
          CustomName: 'poster',
          OutputGroupSettings: {
            Type: 'FILE_GROUP_SETTINGS',
            FileGroupSettings: {
              Destination: `s3://${S3_OUTPUTS_BUCKET}/${key}/`,
            },
          },
          Outputs: [{
            NameModifier: '-poster',
            ContainerSettings: { Container: 'RAW' },
            VideoDescription: {
              ...bigFields,
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

// --- Webhook ---

function parseWebhookMap() {
  const { WEBHOOK_MAP } = cfg();
  if (!WEBHOOK_MAP) return {};
  try {
    return JSON.parse(WEBHOOK_MAP);
  } catch {
    console.error('Failed to parse WEBHOOK_MAP:', WEBHOOK_MAP);
    return {};
  }
}

async function postWebhook(prefix, payload) {
  const map = parseWebhookMap();
  const url = map[prefix];
  if (!url) {
    console.warn(`No webhook URL configured for prefix "${prefix}"`);
    return;
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${cfg().WEBHOOK_SECRET}`,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const body = await res.text();
    console.error(`Webhook POST to ${url} failed (${res.status}): ${body}`);
  }
}

// --- Main handler ---

export async function handler(event) {
  // Dispatch based on event source
  if (event.Records) {
    return handleS3Event(event);
  }
  if (event.source === 'aws.mediaconvert') {
    return handleEventBridgeEvent(event);
  }
  console.error('Unknown event type:', JSON.stringify(event));
  return { statusCode: 400, body: 'Unknown event type' };
}

async function handleS3Event(event) {
  const record = event.Records[0];
  const bucket = record.s3.bucket.name;
  const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, ' '));

  // Parse instance prefix and video key: "ottawa/st9uuvau" → prefix="ottawa", videoKey="st9uuvau"
  const parts = key.split('/');
  if (parts.length < 2) {
    console.error(`Unexpected key format (no prefix): ${key}`);
    return { statusCode: 400, body: 'Key must include instance prefix' };
  }
  const prefix = parts[0];
  const videoKey = parts.slice(1).join('/');

  console.log(`Processing video: prefix=${prefix}, key=${videoKey}, s3Key=${key}`);

  // 1. Run ffprobe
  let probe;
  try {
    probe = await probeVideo(bucket, key);
  } catch (err) {
    console.error(`ffprobe failed for ${key}:`, err.message);
    await postWebhook(prefix, {
      key: videoKey,
      status: 'failed',
      error: `ffprobe failed: ${err.message}`,
    });
    return { statusCode: 500, body: `ffprobe failed: ${err.message}` };
  }

  console.log(`Probe result: ${probe.width}x${probe.height}, ${probe.duration}s, ${probe.orientation}`);

  // 2. Create MediaConvert job
  let jobId;
  try {
    const { MediaConvertClient, CreateJobCommand } = await getMcClient();
    const endpoint = await getMediaConvertEndpoint();
    const client = new MediaConvertClient({ region: cfg().region, endpoint });
    const jobDef = buildJobDefinition(key, probe);
    const { Job } = await client.send(new CreateJobCommand(jobDef));
    jobId = Job.Id;
    console.log(`MediaConvert job created: ${jobId}`);
  } catch (err) {
    console.error(`MediaConvert CreateJob failed for ${key}:`, err.message);
    await postWebhook(prefix, {
      key: videoKey,
      status: 'failed',
      error: `MediaConvert job creation failed: ${err.message}`,
    });
    return { statusCode: 500, body: `MediaConvert failed: ${err.message}` };
  }

  // 3. Webhook: transcoding started
  const durationISO = `PT${Math.round(probe.duration)}S`;
  await postWebhook(prefix, {
    key: videoKey,
    status: 'transcoding',
    width: probe.width,
    height: probe.height,
    duration: durationISO,
    orientation: probe.orientation,
    capturedAt: probe.capturedAt || undefined,
    lat: probe.gps?.lat ?? undefined,
    lng: probe.gps?.lng ?? undefined,
    jobId,
  });

  return { statusCode: 200, body: `Job created: ${jobId}` };
}

async function handleEventBridgeEvent(event) {
  const detail = event.detail;
  const status = detail.status;

  // Primary: read from UserMetadata (set by buildJobDefinition)
  let prefix = detail.userMetadata?.prefix || '';
  let videoKey = detail.userMetadata?.videoKey || '';

  // Fallback: parse from output path for jobs created before UserMetadata was added
  if (!prefix || !videoKey) {
    const outputPath = detail.outputGroupDetails?.[0]?.outputDetails?.[0]?.outputFilePaths?.[0] || '';
    const s3Path = outputPath.replace(/^s3:\/\/[^/]+\//, '');
    const pathParts = s3Path.split('/');
    prefix = pathParts[0] || '';
    videoKey = pathParts[1] || '';
  }

  if (!prefix || !videoKey) {
    console.error('Could not extract prefix/key from event:', JSON.stringify({ userMetadata: detail.userMetadata, outputGroupDetails: detail.outputGroupDetails }));
    return { statusCode: 400, body: 'Could not parse event' };
  }

  console.log(`EventBridge: status=${status}, prefix=${prefix}, videoKey=${videoKey}`);

  if (status === 'COMPLETE') {
    await postWebhook(prefix, { key: videoKey, status: 'ready' });
  } else if (status === 'ERROR') {
    await postWebhook(prefix, {
      key: videoKey,
      status: 'failed',
      error: detail.errorMessage || 'MediaConvert job failed',
    });
  } else {
    console.log(`Ignoring MediaConvert status: ${status}`);
  }

  return { statusCode: 200, body: `Processed ${status}` };
}
