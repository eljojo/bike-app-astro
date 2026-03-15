# Video Agent Lambda

Handles the full video transcoding lifecycle. Deployed to AWS Lambda with an ffprobe layer.

## Setup

Run the setup script from the repo root. It creates all AWS resources idempotently — safe to run multiple times.

```sh
# Step 1: Shared resources (S3 buckets, IAM roles, Lambda, EventBridge)
node scripts/setup-aws-video.js --region us-east-1

# Step 2: Per-instance config (CORS, webhook map, secrets)
node scripts/setup-aws-video.js configure-instance \
  --prefix ottawa --domain ottawabybike.ca \
  --wrangler-env staging
```

### Prerequisites

- **AWS CLI** authenticated (`aws login` or env vars)
- **`gh` CLI** authenticated (for setting GitHub Actions secrets)
- **`wrangler` CLI** authenticated (for setting Worker secrets)

### IAM for CI

The setup script will ask for AWS credentials to store as GitHub Actions secrets. These are used by CI to deploy the Lambda on each push to main. The IAM user needs the **`AWSLambda_FullAccess`** policy attached — you can reuse an existing IAM user, just add the policy in the IAM console.

## Event Paths

Two event sources trigger this handler:

1. **S3 ObjectCreated** — a video was uploaded to the originals bucket
   - Downloads the file, runs ffprobe to extract metadata (dimensions, duration, rotation, GPS, capture date)
   - Creates a MediaConvert job (HLS H.265 adaptive + H.264 MP4 + poster frame)
   - Posts a `transcoding` webhook with metadata to the Worker

2. **EventBridge** — MediaConvert job completed or failed
   - Parses the output path to extract instance prefix and video key
   - Posts a `ready` or `failed` webhook to the Worker

## S3 Key Format

Keys are prefixed by city instance: `{city}/{8-char-key}` (e.g. `ottawa/st9uuvau`). The Lambda extracts the prefix to route webhooks to the correct Worker instance via `WEBHOOK_MAP`.

Existing videos (uploaded before the Lambda pipeline) use unprefixed keys and continue to work — they're already transcoded and served from R2. The prefix format only applies to new uploads.

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

CI deploys automatically on code changes to main (`.github/workflows/production.yml` `deploy-lambda` job). Tests run before deploy. The setup script (`scripts/setup-aws-video.js`) creates all AWS resources idempotently.

## Gotchas

- **ffprobe layer**: The setup script publishes a Lambda layer with a static ffprobe binary to your AWS account (downloaded from johnvansickle.com). The binary must be at `/opt/bin/ffprobe` in the Lambda environment.
- **Rotation handling**: iPhone portrait videos report dimensions as landscape with rotation metadata in `side_data_list`. The probe parser swaps dimensions for 90/270 rotation.
- **`cfg()` is lazy**: Environment variables are read via `cfg()` on each call, not at module load. This lets tests override `process.env` in `beforeEach`.
- **node_modules in zip**: `npm ci --omit=dev` before zipping. Only `@aws-sdk/client-mediaconvert` is needed — S3 client is imported dynamically to keep the cold start fast.
