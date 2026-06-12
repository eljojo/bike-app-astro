import { useState, useCallback } from 'preact/hooks';
import { fetchWithGuest } from '../../lib/guest-fetch';

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

export function useEditorState(opts: EditorStateOptions) {
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [githubUrl, setGithubUrl] = useState('');
  const [contentHash, setContentHash] = useState(opts.initialContentHash);
  const [guestCreated, setGuestCreated] = useState(false);

  // form_instance_id is minted once per form mount and only sent on /new
  // POSTs. The server uses it to reject duplicate /new submissions of the
  // same form (PK-conflict on the form_submissions table). It does NOT
  // travel with subsequent updates — those go to the per-id endpoint.
  const [formInstanceId] = useState<string>(() =>
    (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );

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
    if (contentId === null) {
      payload.form_instance_id = formInstanceId;
    }

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

      const res = await fetchWithGuest(url, fetchOptions, () => setGuestCreated(true));
      // null = guest creation failed and fetchWithGuest already redirected to
      // /login. The page is navigating away, so leaving `saving` true is fine
      // (the component unmounts) — same rationale as the create path.
      if (!res) return;

      const data = await res.json();

      if (!res.ok) {
        if (res.status === 409 && data.conflict) {
          setError(data.error);
          setGithubUrl(data.githubUrl || '');
          setSaving(false);
          return;
        }
        throw new Error(data.error || 'Save failed');
      }

      if (data.contentHash) setContentHash(data.contentHash);
      setSaved(true);

      onSuccess?.(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Save failed');
      setSaving(false);
      return;
    }
    // After a successful save:
    // - For edits (contentId !== null): re-enable the button so the user can keep editing.
    // - For creates (contentId === null): keep saving=true so a stray click during the
    //   post-save navigation can't fire another POST. The caller's onSuccess is expected
    //   to navigate away.
    if (contentId !== null) {
      setSaving(false);
    }
  }, [contentHash, apiBase, contentId, validate, buildPayload, onSuccess]);

  const dismissSaved = useCallback(() => {
    setSaved(false);
    setSaving(false);
  }, []);

  return { saving, saved, error, githubUrl, contentHash, guestCreated, save, setError, dismissSaved };
}
