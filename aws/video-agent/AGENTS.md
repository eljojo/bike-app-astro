# Video Agent Lambda

Handles the full video transcoding lifecycle. Deployed to AWS Lambda with an ffprobe layer.

## Event Paths

Two event sources trigger this handler:

1. **S3 ObjectCreated** — a video was uploaded to the originals bucket
   - Downloads the file, runs ffprobe to extract metadata (dimensions, duration, rotation, GPS, capture date)
   - Creates a MediaConvert job (AV1 + H.264 + poster frame)
   - Posts a `transcoding` webhook with metadata to the Worker

2. **EventBridge** — MediaConvert job completed or failed
   - Parses the output path to extract instance prefix and video key
   - Posts a `ready` or `failed` webhook to the Worker

## S3 Key Format

Keys are prefixed by city instance: `{city}/{8-char-key}` (e.g. `ottawa/st9uuvau`). The Lambda extracts the prefix to route webhooks to the correct Worker instance via `WEBHOOK_MAP`.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `S3_ORIGINALS_BUCKET` | Bucket receiving raw uploads |
| `S3_OUTPUTS_BUCKET` | Bucket for transcoded outputs |
| `MEDIACONVERT_QUEUE` | MediaConvert queue ARN |
| `MEDIACONVERT_ROLE` | IAM role ARN for MediaConvert |
| `MEDIACONVERT_ENDPOINT` | Optional cached endpoint URL |
| `WEBHOOK_MAP` | JSON mapping prefix → webhook URL |
| `WEBHOOK_SECRET` | Bearer token for webhook auth |

## Webhook Contract

POST to the Worker's `/api/video/webhook` with `Authorization: Bearer {WEBHOOK_SECRET}`:

```json
// transcoding (from S3 event)
{ "key": "st9uuvau", "status": "transcoding", "width": 1920, "height": 1080,
  "duration": "PT30S", "orientation": "landscape", "capturedAt": "...", "jobId": "..." }

// ready (from EventBridge)
{ "key": "st9uuvau", "status": "ready" }

// failed (from either)
{ "key": "st9uuvau", "status": "failed", "error": "..." }
```

## Testing

```sh
make test-lambda          # or: node --test handler.test.mjs
```

Tests use Node's built-in `node:test` runner (not vitest). The handler is plain `.mjs` so it runs directly without a build step.

## Deployment

CI deploys automatically on code changes to main (`.github/workflows/production.yml` `deploy-lambda` job). The setup script (`scripts/setup-aws-video.js`) creates all AWS resources idempotently.

## Gotchas

- **ffprobe layer**: The Lambda needs an ffprobe binary. Use a Lambda layer that provides it at `/opt/bin/ffprobe`.
- **Rotation handling**: iPhone portrait videos report dimensions as landscape with rotation metadata in `side_data_list`. The probe parser swaps dimensions for 90/270 rotation.
- **`cfg()` is lazy**: Environment variables are read via `cfg()` on each call, not at module load. This lets tests override `process.env` in `beforeEach`.
- **node_modules in zip**: `npm ci --omit=dev` before zipping. Only `@aws-sdk/client-mediaconvert` is needed — S3 client is imported dynamically to keep the cold start fast.
