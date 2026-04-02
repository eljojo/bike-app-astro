/**
 * Content completeness checks for admin list views.
 *
 * Each function returns an i18n hint key suffix (for `admin.sidebar.{hint}`)
 * or null if the item is complete. The first missing field wins — priority
 * order matches what the admin views originally used.
 *
 * Browser-safe: no `.server.ts`, no `node:*` imports.
 */

/** Event: needs poster and body text. */
export function isEventIncomplete(item: { poster_key?: string; hasBody: boolean }): string | null {
  if (!item.poster_key) return 'no_poster';
  if (!item.hasBody) return 'short_description';
  return null;
}

/** Route: needs a cover photo. */
export function isRouteIncomplete(item: { coverKey?: string }): string | null {
  if (!item.coverKey) return 'no_photo';
  return null;
}

/** Ride: draft status means incomplete. */
export function isRideIncomplete(item: { status?: string }): string | null {
  if (item.status === 'draft') return 'draft';
  return null;
}

/** Bike path: visible stubs need a description. */
export function isBikePathIncomplete(item: { hidden: boolean; stub: boolean }): string | null {
  if (!item.hidden && item.stub) return 'no_description';
  return null;
}

/** Place: needs a photo and contact info (website or telephone). */
export function isPlaceIncomplete(item: {
  photo_key?: string;
  social_links?: Array<{ platform: string; url: string }>;
}): string | null {
  if (!item.photo_key) return 'no_photo';
  const hasContact = item.social_links?.some(l => ['website', 'telephone'].includes(l.platform));
  if (!hasContact) return 'no_website';
  return null;
}

/** Community/organizer: needs photo, body text, and at least one social link. */
export function isCommunityIncomplete(item: {
  photo_key?: string;
  hasBody: boolean;
  social_links?: Array<unknown>;
}): string | null {
  if (!item.photo_key) return 'no_photo';
  if (!item.hasBody) return 'no_description';
  if (!item.social_links?.length) return 'no_social';
  return null;
}
