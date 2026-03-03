import type { SessionUser } from './auth';

export function buildBranchName(displayName: string, contentType: string, contentSlug: string): string {
  return `drafts/${displayName}/${contentType}/${contentSlug}`;
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
