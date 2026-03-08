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

export function useEditorState(opts: EditorStateOptions) {
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [githubUrl, setGithubUrl] = useState('');
  const [contentHash, setContentHash] = useState(opts.initialContentHash);

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

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

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

  return { saving, saved, error, githubUrl, contentHash, save, setError };
}
