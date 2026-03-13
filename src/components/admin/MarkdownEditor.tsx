import { useRef, useEffect, useCallback } from 'preact/hooks';
import type { RefObject } from 'preact';
import MarkdownToolbar from './MarkdownToolbar';
import { insertMarkdown } from './markdown-toolbar-utils';

interface Props {
  id: string;
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  placeholder?: string;
  /** Key to force textarea remount (e.g. locale switch) */
  textareaKey?: string;
  /** External ref — if provided, caller manages the ref */
  textareaRef?: RefObject<HTMLTextAreaElement>;
}

/**
 * Unified markdown editor: toolbar + textarea + keyboard shortcuts.
 * Handles Preact textarea hydration workaround internally.
 */
export default function MarkdownEditor({ id, value, onChange, rows = 8, placeholder, textareaKey, textareaRef }: Props) {
  const internalRef = useRef<HTMLTextAreaElement>(null);
  const ref = textareaRef || internalRef;

  // Preact hydration workaround — textarea value prop is not applied during hydrate()
  useEffect(() => {
    if (ref.current && value && !ref.current.value) {
      ref.current.value = value;
    }
  }, [textareaKey]);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (!e.ctrlKey && !e.metaKey) return;
    const ta = ref.current;
    if (!ta) return;

    let action: 'bold' | 'italic' | 'link' | null = null;
    if (e.key === 'b') action = 'bold';
    else if (e.key === 'i') action = 'italic';
    else if (e.key === 'k') action = 'link';

    if (action) {
      e.preventDefault();
      const result = insertMarkdown(ta.value, ta.selectionStart, ta.selectionEnd, action);
      onChange(result.text);
      requestAnimationFrame(() => {
        ta.focus();
        ta.setSelectionRange(result.cursor, result.cursor);
      });
    }
  }, [onChange]);

  return (
    <>
      <MarkdownToolbar textareaRef={ref} onTextChange={onChange} />
      <textarea
        key={textareaKey}
        ref={ref}
        id={id}
        value={value}
        onInput={(e) => onChange((e.target as HTMLTextAreaElement).value)}
        onKeyDown={handleKeyDown}
        rows={rows}
        placeholder={placeholder}
      />
    </>
  );
}
