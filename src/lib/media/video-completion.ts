/**
 * Video transcoding output key conventions.
 *
 * MediaConvert writes transcoded files to `{key}/{key}-{codec}.mp4`
 * and poster frames to `{key}/{key}-poster.0000000.jpg`.
 * These helpers centralize that naming so it's defined once.
 */

/** H.264 output key — used to check if transcoding is complete. */
export function h264OutputKey(key: string): string {
  return `${key}/${key}-h264.mp4`;
}

/** Poster frame key — MediaConvert frame capture output. */
export function posterKeyForVideo(key: string): string {
  return `${key}/${key}-poster.0000000.jpg`;
}
