import { useState, useRef, useEffect } from 'preact/hooks';
import { useHydrated, useTextareaValue } from '../../lib/hooks';
import { useEditorState } from './useEditorState';
import { useUnsavedGuard } from '../../lib/hooks/use-unsaved-guard';
import type { RefObject } from 'preact';

export interface UseEditorFormOptions {
  /** API endpoint path, e.g. '/api/bike-paths' */
  apiBase: string;
  /** Content ID (slug). null = new content. */
  contentId: string | null;
  /** Initial content hash for conflict detection */
  contentHash?: string;
  /** User role */
  userRole?: string;
  /** Initial body text for textarea hydration fix. Omit if editor uses MarkdownEditor. */
  initialBody?: string;
  /** Dependencies for dirty tracking — when any change, editor is dirty */
  deps: unknown[];
  /** Additional dirty condition (e.g., video transcoding in progress) */
  extraDirty?: boolean;
  /** Build the POST payload. Return null to abort. */
  buildPayload: () => Record<string, unknown> | null;
  /** Validate before save. Return error message or null. */
  validate?: () => string | null;
  /** Called after successful save (dirty reset is automatic) */
  onSuccess?: (result: { id: string; contentHash?: string; sha?: string }) => void;
}

export interface UseEditorFormResult<T extends HTMLElement = HTMLDivElement> {
  hydratedRef: RefObject<T>;
  bodyRef: RefObject<HTMLTextAreaElement>;
  dirty: boolean;
  activeTab: 'edit' | 'preview';
  setActiveTab: (tab: 'edit' | 'preview') => void;
  saving: boolean;
  saved: boolean;
  error: string;
  setError: (msg: string) => void;
  githubUrl: string;
  guestCreated: boolean;
  save: () => Promise<void>;
  dismissSaved: () => void;
}

export function useEditorForm<T extends HTMLElement = HTMLDivElement>(
  opts: UseEditorFormOptions,
): UseEditorFormResult<T> {
  const hydratedRef = useHydrated<T>();

  // Dirty tracking
  const [dirty, setDirty] = useState(false);
  const initialRender = useRef(true);
  useEffect(() => {
    if (initialRender.current) { initialRender.current = false; return; }
    setDirty(true);
  }, opts.deps);

  useUnsavedGuard(dirty || (opts.extraDirty ?? false));

  // Textarea hydration fix
  const bodyRef = useTextareaValue(opts.initialBody ?? '');

  // Tab state
  const [activeTab, setActiveTab] = useState<'edit' | 'preview'>('edit');

  // Save state
  const { saving, saved, error, setError, githubUrl, guestCreated, save, dismissSaved } = useEditorState({
    apiBase: opts.apiBase,
    contentId: opts.contentId,
    initialContentHash: opts.contentHash,
    userRole: opts.userRole,
    validate: opts.validate,
    buildPayload: opts.buildPayload,
    onSuccess: (result) => {
      setDirty(false);
      opts.onSuccess?.(result);
    },
  });

  return {
    hydratedRef,
    bodyRef,
    dirty,
    activeTab,
    setActiveTab,
    saving,
    saved,
    error,
    setError,
    githubUrl,
    guestCreated,
    save,
    dismissSaved,
  };
}
