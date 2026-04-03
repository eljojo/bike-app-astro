# Media (`src/lib/media/`)

Media pipeline: storage, image processing, video transcoding, EXIF extraction, and cross-content photo registry.

## Files

| File | Role |
|------|------|
| `storage.adapter-r2.ts` | R2 storage: `generateMediaKey()`, `createPresignedUploadUrl()`, `confirmUpload()`, `deleteMedia()` |
| `storage.adapter-local.ts` | Local filesystem bucket (`BucketLike`). **Vendor isolation boundary** |
| `image-service.ts` | `imageUrl()` — Cloudflare Image Transformation URLs |
| `image-dimensions.ts` | `parseImageDimensions()` — width/height from file headers |
| `exif.ts` | `extractPhotoMetadata()` — GPS + timestamp from JPEG EXIF |
| `video-service.ts` | HLS + MP4 source URL generation |
| `transcode.service.ts` | `TranscodeService` interface, factory, resolution scaling |
| `transcode.adapter-aws.ts` | AWS MediaConvert via SigV4 (no SDK) |
| `transcode.adapter-local.ts` | Local no-op transcode adapter |
| `video-completion.ts` | MediaConvert job completion handler |
| `mp4-metadata.ts` | Video duration/dimensions from MP4 headers |
| `media-registry.ts` | `SharedKeysMap` — tracks cross-content media usage |
| `media-parking.server.ts` | Orphaned media parking (D1 cache + YAML) |
| `media-merge.ts` | `mergeMedia()` — merge admin edits with existing `media.yml` |

## Gotchas

- **`confirmUpload()` validates before promoting** — invalid images are deleted.
- **Media registry prunes single-use keys** — only keys used by 2+ items are tracked.
- **`mergeMedia()` is order-sensitive** — admin array drives ordering.
- **EXIF extraction only works for JPEG** — PNG/WebP return null.

## Detailed Context

- [Media pipeline](../../../_ctx/media-pipeline.md)
