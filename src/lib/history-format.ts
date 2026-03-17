import { extractChangesPath, parseContentPath } from './git/commit-author';

export interface ParsedCommit {
  action: 'created' | 'updated' | 'renamed';
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
 *   "Create ride Winter Ride\nChanges: blog/rides/2026/01/15-winter-ride"
 *   "Update + media for ride Winter Ride\nChanges: blog/rides/2026/01/15-winter-ride"
 *   "Rename Canal Path: old-slug → new-slug\nChanges: ottawa/routes/new-slug"
 */
export function parseCommitMessage(message: string, city: string): ParsedCommit {
  const firstLine = message.split('\n')[0];

  // Extract content path from Changes: trailer
  const changesPath = extractChangesPath(message);
  const parsed = changesPath ? parseContentPath(city, changesPath) : null;

  // Detect rename: "Rename {title}: old-slug → new-slug"
  const renameMatch = firstLine.match(/^Rename\s+(.+?):\s+\S+\s+→\s+\S+/);
  if (renameMatch) {
    return {
      action: 'renamed',
      contentType: parsed?.contentType ?? null,
      contentSlug: parsed?.contentSlug ?? null,
      headline: renameMatch[1],
      detail: '',
      editorUrl: buildEditorUrl(parsed),
    };
  }

  const isCreate = firstLine.startsWith('Create ');
  const action = isCreate ? 'created' : 'updated';

  // Extract detail from parenthetical
  const detailMatch = firstLine.match(/\(([^)]+)\)/);
  const detail = detailMatch ? detailMatch[1] : '';

  // Extract content name from first line
  // Formats:
  //   "Create/Update {name} (details)"
  //   "Create/Update {type} {name}" where type = event|place|ride
  //   "{parts} for ride {name}" e.g. "Update + media for ride Winter Ride"
  const forTypeMatch = firstLine.match(/^.+\s+for\s+(?:ride|route|event|place)\s+(.+?)(?:\s*\(.*\))?$/);
  const prefixMatch = firstLine.match(/^(?:Create|Update)\s+(?:event|place|ride)\s+(.+?)(?:\s*\(.*\))?$/);
  const simpleMatch = firstLine.match(/^(?:Create|Update)\s+(.+?)(?:\s*\(.*\))?$/);

  const headline = forTypeMatch?.[1] ?? prefixMatch?.[1] ?? simpleMatch?.[1] ?? firstLine.replace(/^(?:Create|Update)\s+/, '');

  return {
    action,
    contentType: parsed?.contentType ?? null,
    contentSlug: parsed?.contentSlug ?? null,
    headline,
    detail,
    editorUrl: buildEditorUrl(parsed),
  };
}

function buildEditorUrl(parsed: { contentType: string; contentSlug: string } | null): string | null {
  if (!parsed) return null;
  const { contentType, contentSlug } = parsed;
  return `/admin/${contentType}/${contentSlug}`;
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
