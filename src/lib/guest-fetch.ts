/**
 * Lazily bootstraps a guest identity for anonymous contributors.
 *
 * Performs the request; on a 401 it creates a guest session
 * (POST /api/auth/guest) and retries once. Concurrent callers that all
 * hit 401 share a single guest creation (single-flight), collapsing a burst
 * to one mint. This is best-effort, not a hard guarantee: a 401 that arrives
 * just after the in-flight creation settles can still mint a second guest —
 * harmless, since guest creation is idempotent and rate-limited per IP.
 *
 * Returns the final Response, or null if guest creation failed. On that failure
 * the default behaviour (onAuthFail: 'redirect') sends the browser to /login;
 * public widgets that must stay non-disruptive pass onAuthFail: 'silent', which
 * returns null without touching the location so the caller can no-op.
 *
 * Browser-safe: no server-only imports. Guards `window` so it is unit-testable
 * under Vitest's node environment.
 */
interface GuestFetchOptions {
  /** Fired once after a guest is successfully minted (before the retry). */
  onGuestCreated?: () => void;
  /**
   * What to do when guest creation fails. 'redirect' (default) sends the user
   * to /login; 'silent' returns null and leaves the page untouched.
   */
  onAuthFail?: 'redirect' | 'silent';
}

let guestCreation: Promise<boolean> | null = null;

function createGuest(): Promise<boolean> {
  if (!guestCreation) {
    guestCreation = fetch('/api/auth/guest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
      .then((res) => res.ok)
      // Intentional: a network error or a 404 (guests disabled) both mean
      // "no guest" → the caller redirects to /login. Do NOT surface the error
      // here; doing so would break the redirect UX.
      .catch(() => false)
      // Reset once settled so a later, genuinely new 401 can mint again. A
      // concurrent burst shares this one promise (single-flight); a 401 that
      // lands just after the reset may mint a second guest, which is harmless
      // (idempotent + rate-limited) and cannot happen for sequential uploads.
      .finally(() => { guestCreation = null; });
  }
  return guestCreation;
}

export async function fetchWithGuest(
  url: string,
  options: RequestInit,
  guestOptions: GuestFetchOptions = {},
): Promise<Response | null> {
  const { onGuestCreated, onAuthFail = 'redirect' } = guestOptions;

  const res = await fetch(url, options);
  if (res.status !== 401) return res;

  const created = await createGuest();
  if (!created) {
    if (onAuthFail === 'redirect' && typeof window !== 'undefined') {
      const returnTo = encodeURIComponent(window.location.pathname);
      window.location.href = `/login?returnTo=${returnTo}`;
    }
    return null;
  }

  onGuestCreated?.();
  // One retry only. If this still 401s, return that response to the caller —
  // never loop on mint+retry (a stuck/expired cookie must not spin forever).
  return fetch(url, options);
}
