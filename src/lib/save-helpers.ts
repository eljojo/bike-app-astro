interface KeyChange {
  key: string;
  usage: { type: string; slug: string };
  action: 'add' | 'remove';
}

/**
 * Build the photo-key change list for afterCommit photo registry updates.
 * Used by event-save and place-save handlers (route-save handles media arrays differently).
 */
export function buildPhotoKeyChanges(
  oldKey: string | undefined,
  newKey: string | undefined,
  contentType: string,
  slug: string,
): KeyChange[] {
  const changes: KeyChange[] = [];
  if (oldKey !== newKey) {
    if (oldKey) changes.push({ key: oldKey, usage: { type: contentType, slug }, action: 'remove' });
    if (newKey) changes.push({ key: newKey, usage: { type: contentType, slug }, action: 'add' });
  }
  return changes;
}
