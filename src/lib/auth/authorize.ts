import type { APIContext } from 'astro';
import type { SessionUser } from './auth';
import { jsonError } from '../api-response';

export type Action =
  | 'edit-content' | 'edit-past-event' | 'set-status' | 'edit-slug'
  | 'revert-commit' | 'manage-users' | 'delete-media'
  | 'sync-staging' | 'view-history' | 'upload-media'
  | 'import-gpx' | 'update-settings' | 'add-reaction'
  | 'event-draft' | 'strava-connect'
  | 'view-stats' | 'sync-stats';

type Policy = (user: SessionUser) => boolean;

const policies: Record<Action, Policy> = {
  'edit-content':    () => true,
  'view-history':    () => true,
  'upload-media':    () => true,
  'import-gpx':      () => true,
  'update-settings': () => true,
  'add-reaction':    () => true,
  'event-draft':     () => true,
  'edit-slug':       (user) => user.role !== 'guest',
  'edit-past-event': (user) => user.role === 'admin',
  'set-status':      (user) => user.role === 'admin',
  'revert-commit':   (user) => user.role === 'admin',
  'manage-users':    (user) => user.role === 'admin',
  'delete-media':    (user) => user.role === 'admin',
  'sync-staging':    (user) => user.role === 'admin',
  'strava-connect':  (user) => user.role === 'admin',
  'view-stats':      (user) => user.role === 'admin',
  'sync-stats':      (user) => user.role === 'admin',
};

/**
 * Gate check: returns SessionUser on success, Response (401/403) on failure.
 * Use at the top of API endpoints.
 */
export function authorize(
  locals: APIContext['locals'],
  action: Action,
): SessionUser | Response {
  const user = (locals as unknown as Record<string, unknown>).user as SessionUser | null | undefined;
  if (!user || !user.id) return jsonError('Unauthorized', 401);
  if (user.bannedAt) return jsonError('Forbidden', 403);
  if (!policies[action](user)) return jsonError('Forbidden', 403);
  return user;
}

/**
 * Capability check: returns boolean. Use in UI logic and inline checks.
 * Does not check banned status — use authorize() for gates.
 */
export function can(
  user: SessionUser | null | undefined,
  action: Action,
): boolean {
  if (!user) return false;
  return policies[action](user);
}
