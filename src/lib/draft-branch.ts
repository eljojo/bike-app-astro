import type { SessionUser } from './auth';

/**
 * Sanitize a display name for safe use in git branch names and commit author fields.
 * Strips path traversal, control characters, and git-unsafe chars.
 */
export function sanitizeDisplayName(name: string): string {
  return name
    .replace(/[^\p{L}\p{N} _-]/gu, '') // keep letters, digits, space, underscore, hyphen
    .replace(/\s+/g, '-')              // collapse whitespace to hyphens
    .replace(/-{2,}/g, '-')            // collapse multiple hyphens
    .replace(/^-|-$/g, '')             // trim leading/trailing hyphens
    .slice(0, 60)                      // limit length
    || 'anonymous';                    // fallback if everything was stripped
}

export function buildBranchName(displayName: string, contentType: string, contentSlug: string): string {
  const safeName = sanitizeDisplayName(displayName);
  return `drafts/${safeName}/${contentType}/${contentSlug}`;
}

export function isDirectCommit(user: SessionUser, editorMode: boolean): boolean {
  return user.role === 'admin' && !editorMode;
}

export function resolveBranch(
  user: SessionUser,
  editorMode: boolean,
  baseBranch: string,
  contentType: string,
  contentSlug: string,
): string {
  if (isDirectCommit(user, editorMode)) {
    return baseBranch;
  }
  return buildBranchName(user.displayName, contentType, contentSlug);
}
