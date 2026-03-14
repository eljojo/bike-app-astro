# Media (`src/lib/media/`)

Media pipeline: storage adapters, image processing, video transcoding, EXIF extraction, and the photo registry for cross-content photo sharing. Handles the full lifecycle from upload through transformation to serving.

## Files

| File | Role |
|------|------|
| `storage.adapter-r2.ts` | R2 storage: `generateMediaKey()`, `createPresignedUploadUrl()`, `confirmUpload()` (validates image, extracts dimensions + EXIF, promotes from pending), `deleteMedia()`. Exports `BucketLike` interface and `UploadMetadata` type |
| `storage.adapter-local.ts` | Local filesystem bucket matching `BucketLike` interface. Stores files in `.data/uploads/`. **Vendor isolation boundary** |
| `image-service.ts` | `imageUrl()` — generates Cloudflare Image Transformation URLs (`cdn-cgi/image/`). Vendor-isolated: swap this to change image transformation provider |
| `image-dimensions.ts` | `parseImageDimensions()` — extracts width/height from JPEG/PNG/WebP/GIF file headers without decoding the full image |
| `exif.ts` | `extractPhotoMetadata()` — extracts GPS coordinates and capture timestamp from JPEG EXIF data. Returns null for non-JPEG files |
| `video-service.ts` | `videoPlaybackSources()`, `videoFallbackUrl()` — generates AV1 + H.264 source URLs for video playback from R2 storage |
| `transcode.service.ts` | `TranscodeService` interface, `createTranscodeService()` factory, `outputSize()` for resolution scaling (cap at 1080p). Selects AWS MediaConvert adapter or local no-op |
| `transcode.adapter-aws.ts` | AWS MediaConvert adapter — creates transcoding jobs via SigV4-signed HTTP requests |
| `transcode.adapter-local.ts` | Local no-op transcode adapter for development |
| `video-completion.ts` | Handles MediaConvert job completion callbacks |
| `mp4-metadata.ts` | Extracts video duration and dimensions from MP4 file headers |
| `photo-registry.ts` | `SharedKeysMap` — tracks which photos are used across multiple content types. `buildSharedKeysMap()`, `updateSharedKeys()`, `serializeSharedKeys()`. Prunes single-use keys |
| `photo-parking.ts` | `toParkedEntry()` — converts media items to parked photo entries |
| `media-merge.ts` | `mergeMedia()` — merges admin media changes with existing `media.yml` entries, preserving existing fields while overlaying edits. `mergeParkedPhotos()` for the parking queue |

## Gotchas

- **`storage.adapter-local.ts` is a vendor isolation boundary** — it's one of the five adapter points listed in the root AGENTS.md.
- **`confirmUpload()` validates before promoting** — checks image dimensions from file headers. Invalid images are deleted and rejected.
- **Photo registry prunes single-use keys** — `buildSharedKeysMap()` only keeps keys referenced by 2+ content items. This is intentional: single-use photos don't need cross-reference tracking.
- **`mergeMedia()` is order-sensitive** — the admin array drives final ordering. New photos get `score: 1` and `type: "photo"`. Existing entries preserve all fields (score, width, height, etc.).
- **Video transcoding uses AWS SigV4** directly (no SDK) for Cloudflare Workers compatibility.
- **EXIF extraction only works for JPEG** — PNG/WebP files silently return null.

## Cross-References

- `env/env.adapter-local.ts` — creates the local bucket via `createLocalBucket()`
- `content/save-helpers.ts` — uses `computeMediaKeyDiff()` to track photo changes across saves
- `src/build-data-plugin.ts` — `photo-shared-keys` virtual module built from photo registry
