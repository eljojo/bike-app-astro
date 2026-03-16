---
title: Video pipeline
description: Technical reference for the video transcoding and delivery infrastructure.
---

This page is for people running their own whereto.bike instance. If you're browsing rides or setting up a blog, you probably want the [bike blog](/experimental/bike-blog/) page instead.

## Architecture

The video pipeline has two flows: upload and delivery.

### Upload flow

```
Browser → presigned S3 PUT → originals bucket
  → S3 ObjectCreated trigger → Lambda (ffprobe: dimensions, duration, GPS)
  → Lambda submits MediaConvert job
  → MediaConvert produces: CMAF HLS H.265 adaptive (480p + 1080p), H.264 MP4, poster frame
  → outputs land in S3 outputs bucket
  → EventBridge catches job completion → Lambda
  → Lambda posts webhook to Worker → D1 status update
```

The Worker initiates uploads by generating a presigned S3 PutObject URL (`src/lib/media/transcode.service.ts`). The browser uploads directly to S3 — the video never touches the Worker.

### Delivery flow

```
Browser requests video → R2 CDN (videos.whereto.bike)
  → R2 has file? Serve it.
  → R2 doesn't have file? Sippy pulls from S3 outputs bucket → cache in R2 → serve.
```

R2 Sippy bridges S3 and Cloudflare's CDN. Transcoded videos stay in S3, but viewers get them from R2's edge network. No manual file copying, no sync jobs.

## Setup script

The setup script (`scripts/setup-aws-video.js`) provisions everything in two phases. Both phases are idempotent — safe to re-run.

### Phase 1: Shared resources

`setupSharedResources()` creates infrastructure shared across all instances on an AWS account:

- **S3 buckets** — `bike-video-originals` (raw uploads) and `bike-video-outputs` (transcoded files)
- **MediaConvert IAM role** — allows MediaConvert to read from originals and write to outputs
- **Lambda IAM role** — S3 read/write, MediaConvert job creation, IAM PassRole
- **Lambda function** (`video-agent`) — with ffprobe layer, environment variables, 512 MB memory
- **EventBridge rule** — routes MediaConvert completion events to the Lambda
- **S3 trigger** — invokes Lambda on ObjectCreated in the originals bucket
- **CI deploy user** — IAM user with Lambda deploy permissions (only created if Lambda was newly created)

### Phase 2: Per-instance config

`configureInstance()` sets up one instance (one city or blog) to use the shared resources:

- **CORS** — adds the instance domain to the originals bucket's CORS config
- **Webhook map** — adds `prefix → https://domain/api/video/webhook` to the Lambda's WEBHOOK_MAP env var
- **Webhook secret** — generates a shared bearer token if not already set, propagates to the Worker
- **Presign IAM user** — `whereto-presign-{prefix}` with S3 PutObject/HeadObject on the originals bucket (per-prefix key path restriction)
- **Sippy IAM user** — `whereto-sippy` with S3 GetObject on the outputs bucket (shared across instances)
- **R2 bucket** — creates `whereto-bike-videos` if it doesn't exist
- **Sippy configuration** — connects R2 bucket to S3 outputs bucket via Sippy
- **Wrangler secrets** — MEDIACONVERT_ACCESS_KEY_ID, MEDIACONVERT_SECRET_ACCESS_KEY, S3_ORIGINALS_BUCKET, VIDEO_PREFIX
- **GitHub variable** — sets VIDEO_PREFIX on the repo

## Multi-instance model

Multiple instances (wiki, blogs) share one set of AWS resources. Isolation happens through S3 key prefixes:

```
bike-video-originals/
  ottawa/abc12345          ← wiki instance
  eljojo_bike-blog/def67890  ← blog instance
```

The Lambda's `WEBHOOK_MAP` routes completion events to the right Worker:

```json
{
  "ottawa": "https://ottawabybike.ca/api/video/webhook",
  "eljojo_bike-blog": "https://eljojo.bike/api/video/webhook"
}
```

Each instance gets its own presign IAM user (keys are per-prefix and can be rotated independently). The Sippy user and CI deploy user are shared.

## IAM users

The setup script creates three IAM users with least-privilege policies:

| User | Scope | Permissions |
|------|-------|-------------|
| `whereto-presign-{prefix}` | Per-instance | S3 PutObject, HeadObject on `originals/{prefix}/*` |
| `whereto-sippy` | Shared | S3 GetObject on `outputs/*` |
| `whereto-ci-deploy` | Shared | Lambda UpdateFunctionCode, GetFunction |

Keys are rotated on every run of the setup script. Old keys are deleted after the new ones are confirmed working.

## R2 Sippy

Sippy is Cloudflare's incremental migration feature for R2. In this pipeline, it serves a different purpose: lazy CDN population.

When a browser requests a video from R2 and the file isn't there yet, Sippy pulls it from the S3 outputs bucket, caches it in R2, and serves it. Subsequent requests hit R2 directly.

This means:
- Transcoded videos stay in S3 (close to MediaConvert, no cross-region copies)
- Viewers get Cloudflare's edge network (fast, global)
- No sync job or copy step between transcoding and serving

Sippy needs R2 API credentials (S3-compatible) with Object Read & Write on the target bucket. The setup script prompts for these during Phase 2.

## CI Lambda deploy

Blog repos deploy the Lambda from `node_modules/whereto-bike/aws/video-agent/` — the Lambda code ships in the npm package.

The `deploy-lambda` job in `deploy.yml` is gated on `vars.VIDEO_PREFIX`:

- If `VIDEO_PREFIX` is not set, the job is skipped entirely
- If set, the job runs Lambda tests, packages the code, and deploys via `aws lambda update-function-code`
- Uses `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` secrets from the CI deploy user

This means Lambda code updates automatically when the blog updates its `whereto-bike` dependency.

## Troubleshooting

### Video stuck on "transcoding"

The Worker polls for completion on page load (`src/views/api/video-status.ts`). If a video has been "transcoding" for more than 30 minutes, the self-healing check triggers: it looks for the H.264 output on R2 and marks the video as ready if found.

If the video genuinely failed to transcode, check CloudWatch logs for the Lambda function. Common causes:
- Input file is not a valid video (corrupt upload)
- Video exceeds 3 minutes (clipped automatically, but very large files may time out)
- MediaConvert queue is paused

To retry: delete the video in the admin UI and re-upload.

### Sippy not pulling files

If videos return 404 from R2:
1. Check that Sippy is configured: Cloudflare Dashboard → R2 → bucket → Settings → Sippy
2. Verify the Sippy credentials are still valid (they're AWS IAM keys that can be rotated)
3. Check that the file exists in the S3 outputs bucket

### Webhook not received

The Lambda posts webhooks to the URL in `WEBHOOK_MAP`. If the Worker isn't receiving them:
1. Check `WEBHOOK_MAP` on the Lambda (AWS Console → Lambda → video-agent → Configuration → Environment variables)
2. Verify `WEBHOOK_SECRET` matches between Lambda and Worker
3. Check that the Worker's `/api/video/webhook` endpoint is accessible (not blocked by firewall or Cloudflare rules)

### Lambda deploy fails in CI

- Verify `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` are set as GitHub repo secrets
- The CI user needs `lambda:UpdateFunctionCode` and `lambda:GetFunction` permissions
- Check that the Lambda function name matches (`video-agent` by default)
