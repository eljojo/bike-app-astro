import { extractChangesPath, parseContentPath } from './git/commit-author';

export interface ParsedCommit {
  action: 'created' | 'updated';
  contentType: string | null;
  contentSlug: string | null;
  headline: string;
  detail: string;
  editorUrl: string | null;
}

/**
 * Parse a commit message into a human-readable description.
 *
 * Commit message format examples:
 *   "Create Rideau Canal Western (3 media)\nChanges: ottawa/routes/rideau-canal-western"
 *   "Update Rideau Canal Western (5 media, GPX added)\nChanges: ottawa/routes/rideau-canal-western"
 *   "Create event Tour de Fat\nChanges: ottawa/events/2026/tour-de-fat"
 */
export function parseCommitMessage(message: string, city: string): ParsedCommit {
  const firstLine = message.split('\n')[0];
  const isCreate = firstLine.startsWith('Create ');
  const action = isCreate ? 'created' : 'updated';

  // Extract content path from Changes: trailer
  const changesPath = extractChangesPath(message);
  const parsed = changesPath ? parseContentPath(city, changesPath) : null;

  // Extract content name from first line
  // Format: "Create/Update {name} (details)" or "Create/Update {type} {name}"
  const nameMatch = firstLine.match(/^(?:Create|Update)\s+(?:event\s+|place\s+)?(.+?)(?:\s*\(.*\))?$/);
  const contentName = nameMatch ? nameMatch[1] : firstLine.replace(/^(?:Create|Update)\s+/, '');

  // Extract detail from parenthetical
  const detailMatch = firstLine.match(/\(([^)]+)\)/);
  const detail = detailMatch ? detailMatch[1] : '';

  const headline = contentName;

  // Build editor URL from parsed content path
  let editorUrl: string | null = null;
  if (parsed) {
    const { contentType, contentSlug } = parsed;
    const urlType = contentType === 'routes' ? 'routes' : contentType;
    editorUrl = `/admin/${urlType}/${contentSlug}`;
  }

  return {
    action,
    contentType: parsed?.contentType ?? null,
    contentSlug: parsed?.contentSlug ?? null,
    headline,
    detail,
    editorUrl,
  };
}

/** Format a detail string for human display. */
export function formatDetail(detail: string): string {
  if (!detail) return '';
  // "3 media" -> "added 3 photos"
  const mediaMatch = detail.match(/(\d+)\s+media/);
  if (mediaMatch) {
    const count = mediaMatch[1];
    const rest = detail.replace(/\d+\s+media,?\s*/, '').trim();
    const parts = [`added ${count} photos`];
    if (rest) parts.push(rest);
    return parts.join(', ');
  }
  return detail;
}
