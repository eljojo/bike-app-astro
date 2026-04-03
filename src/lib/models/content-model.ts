import { z } from 'zod/v4';

/** Base media item schema shared by all content types. */
export const baseMediaItemSchema = z.object({
  key: z.string(),
  type: z.enum(['photo', 'video']).optional(),
  caption: z.string().optional(),
  cover: z.boolean().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  lat: z.number().optional(),
  lng: z.number().optional(),
  // Video-specific fields
  title: z.string().optional(),
  handle: z.string().optional(),
  duration: z.string().optional(),
  orientation: z.string().optional(),
});

export type BaseMediaItem = z.infer<typeof baseMediaItemSchema>;

/**
 * Parse a raw YAML-parsed object into a base media item.
 * Extracts only known fields, skipping null/undefined values.
 * Callers can extend the result with type-specific fields.
 */
export function parseMediaItem(raw: Record<string, unknown>): BaseMediaItem {
  const item: Record<string, unknown> = { key: raw.key as string };
  if (raw.type != null) item.type = raw.type;
  if (raw.caption != null) item.caption = raw.caption;
  if (raw.cover != null) item.cover = raw.cover;
  if (raw.width != null) item.width = raw.width;
  if (raw.height != null) item.height = raw.height;
  if (raw.lat != null) item.lat = raw.lat;
  if (raw.lng != null) item.lng = raw.lng;
  if (raw.title != null) item.title = raw.title;
  if (raw.handle != null) item.handle = raw.handle;
  if (raw.duration != null) item.duration = raw.duration;
  if (raw.orientation != null) item.orientation = raw.orientation;
  return item as BaseMediaItem;
}

export interface GitFileSnapshot {
  content: string;
  sha: string;
}

export interface GitFiles {
  primaryFile: GitFileSnapshot | null;
  auxiliaryFiles?: Record<string, GitFileSnapshot | null>;
}
