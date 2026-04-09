---
description: R2 storage, video transcoding, universal media pattern, photo registry, media merge
type: knowledge
triggers: [working with media, uploads, video transcoding, photo registry, media merge, adding media fields]
related: [save-pipeline, content-model]
---

# Media Pipeline

Storage adapters, image processing, video transcoding, EXIF extraction, and the photo registry for cross-content photo sharing. Handles the full lifecycle from upload through transformation to serving.

## Universal Media Pattern

A single key identifies every media asset. The app resolves it to URLs at render time. Components never touch vendor URLs directly.

Photos and videos are equal — all media entries live in one ordered list. Never filter by type, never treat photos and videos as separate collections. The `type` field exists for rendering (`img` vs `video` tag), not for partitioning logic.

## Storage Adapters

| Adapter | Environment | Location |
|---------|-------------|----------|
| `storage.adapter-r2.ts` | Production | Cloudflare R2 bucket |
| `storage.adapter-local.ts` | Development | `.data/uploads/` filesystem |

Both implement the `BucketLike` interface. `storage.adapter-local.ts` is a vendor isolation boundary.

### Upload Flow

`generateMediaKey()` → `createPresignedUploadUrl()` → client uploads → `confirmUpload()` (validates image dimensions from file headers, extracts EXIF, promotes from pending) → rejected uploads are deleted.

## Image URLs

`imageUrl()` in `image-service.ts` generates Cloudflare Image Transformation URLs (`cdn-cgi/image/{transforms}/{blobKey}`). This is vendor-isolated — swap this file to change image transformation provider.

## Video Pipeline

- `videoPlaybackSources()` — generates HLS + H.264 MP4 source URLs from R2
- `TranscodeService` interface with factory: AWS MediaConvert adapter (production) or local no-op (development)
- Video transcoding uses AWS SigV4 directly (no SDK) for Cloudflare Workers compatibility
- `outputSize()` caps resolution at 1080p
- `video-completion.ts` handles MediaConvert job completion callbacks
- `mp4-metadata.ts` extracts duration and dimensions from MP4 headers

## Media Registry (Cross-Content Sharing)

`media-registry.ts` provides `SharedKeysMap` — tracks which media keys are used across multiple content types.

- `buildSharedKeysMap()` — only keeps keys referenced by 2+ content items (single-use keys are pruned intentionally)
- `updateSharedKeys()`, `serializeSharedKeys()`, `getMediaUsages()`
- `media-parking.server.ts` — parks orphaned media, manages D1 cache keys `media-shared-keys` and `parked-media`, YAML file `parked-media.yml`

## Media Merge

`mergeMedia()` in `media-merge.ts` merges admin media changes with existing `media.yml` entries:

- Admin array drives final ordering
- New items get `score: 1` and `type: "photo"`
- Existing entries preserve all fields (score, width, height, etc.)
- Order-sensitive — don't rearrange the merge logic

## EXIF and Dimensions

- `parseImageDimensions()` — extracts width/height from JPEG/PNG/WebP/GIF headers without decoding
- `extractPhotoMetadata()` — GPS coordinates and capture timestamp from JPEG EXIF only. PNG/WebP silently return null.

## Key Files

| File | Role |
|------|------|
| `storage.adapter-r2.ts` | R2 storage, upload flow, `BucketLike` interface |
| `storage.adapter-local.ts` | Local filesystem bucket (vendor isolation boundary) |
| `image-service.ts` | `imageUrl()` — Cloudflare Image Transformation URLs |
| `image-dimensions.ts` | Image header parsing for dimensions |
| `exif.ts` | JPEG EXIF extraction (GPS, timestamp) |
| `video-service.ts` | Video playback URL generation |
| `transcode.service.ts` | Transcoding factory and resolution scaling |
| `transcode.adapter-aws.ts` | AWS MediaConvert via SigV4 |
| `media-registry.ts` | `SharedKeysMap` for cross-content media tracking |
| `media-parking.server.ts` | Orphaned media management |
| `media-merge.ts` | `mergeMedia()` for admin edits |
