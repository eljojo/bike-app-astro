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
 * Returns the final Response, or null if guest creation failed and the
 * caller was redirected to /login.
 *
 * Browser-safe: no server-only imports. Guards `window` so it is unit-testable
 * under Vitest's node environment.
 */
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
  onGuestCreated?: () => void,
): Promise<Response | null> {
  const res = await fetch(url, options);
  if (res.status !== 401) return res;

  const created = await createGuest();
  if (!created) {
    if (typeof window !== 'undefined') {
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
