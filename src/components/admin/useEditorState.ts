import { useState, useCallback } from 'preact/hooks';

interface EditorStateOptions {
  /** API endpoint path, e.g. '/api/places' */
  apiBase: string;
  /** Content ID (slug). If null, treated as new content. */
  contentId: string | null;
  /** Initial content hash for conflict detection */
  initialContentHash?: string;
  /** User role for success message behavior */
  userRole?: string;
  /** Build the POST payload. Return null to abort save. */
  buildPayload: () => Record<string, unknown> | null;
  /** Called after successful save with the response data */
  onSuccess?: (result: { id: string; contentHash?: string; sha?: string }) => void;
  /** Validate before save. Return error message or null. */
  validate?: () => string | null;
}

async function createGuestAndRetry(
  url: string,
  options: RequestInit,
): Promise<Response | null> {
  try {
    const guestRes = await fetch('/api/auth/guest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    if (!guestRes.ok) {
      // Guest creation failed (e.g., blog mode returns 404)
      // Redirect to login
      const returnTo = encodeURIComponent(window.location.pathname);
      window.location.href = `/login?returnTo=${returnTo}`;
      return null;
    }
    // Retry the original save
    return fetch(url, options);
  } catch {
    return null;
  }
}

export function useEditorState(opts: EditorStateOptions) {
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [githubUrl, setGithubUrl] = useState('');
  const [contentHash, setContentHash] = useState(opts.initialContentHash);
  const [guestCreated, setGuestCreated] = useState(false);

  const { apiBase, contentId, validate, buildPayload, onSuccess } = opts;

  const save = useCallback(async () => {
    setError('');
    setGithubUrl('');

    if (validate) {
      const validationError = validate();
      if (validationError) {
        setError(validationError);
        return;
      }
    }

    const payload = buildPayload();
    if (!payload) return;

    payload.contentHash = contentHash;

    setSaving(true);
    setSaved(false);

    try {
      const url = contentId
        ? `${apiBase}/${contentId}`
        : `${apiBase}/new`;

      const fetchOptions: RequestInit = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      };

      let res = await fetch(url, fetchOptions);

      if (res.status === 401) {
        const retryRes = await createGuestAndRetry(url, fetchOptions);
        if (!retryRes) return; // redirected to login
        res = retryRes;
        setGuestCreated(true);
        // Fall through to normal response handling
      }

      const data = await res.json();

      if (!res.ok) {
        if (res.status === 409 && data.conflict) {
          setError(data.error);
          setGithubUrl(data.githubUrl || '');
          return;
        }
        throw new Error(data.error || 'Save failed');
      }

      if (data.contentHash) setContentHash(data.contentHash);
      setSaved(true);
      setTimeout(() => setSaved(false), 8000);

      onSuccess?.(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }, [contentHash, apiBase, contentId, validate, buildPayload, onSuccess]);

  return { saving, saved, error, githubUrl, contentHash, guestCreated, save, setError };
}
