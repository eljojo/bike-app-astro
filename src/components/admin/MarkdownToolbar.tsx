import type { RefObject } from 'preact';
import { insertMarkdown, type MarkdownAction } from './markdown-toolbar-utils';

interface Props {
  textareaRef: RefObject<HTMLTextAreaElement>;
  onTextChange: (text: string) => void;
}

export default function MarkdownToolbar({ textareaRef, onTextChange }: Props) {
  function applyAction(action: MarkdownAction) {
    const ta = textareaRef.current;
    if (!ta) return;
    const { text, cursor } = insertMarkdown(ta.value, ta.selectionStart, ta.selectionEnd, action);
    onTextChange(text);
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(cursor, cursor);
    });
  }

  return (
    <div class="markdown-toolbar">
      <button type="button" title="Bold (Ctrl+B)" onClick={() => applyAction('bold')}><strong>B</strong></button>
      <button type="button" title="Italic (Ctrl+I)" onClick={() => applyAction('italic')}><em>I</em></button>
      <button type="button" title="Heading" onClick={() => applyAction('heading')}>H</button>
      <button type="button" title="Horizontal rule" onClick={() => applyAction('hr')}>&mdash;</button>
      <button type="button" title="Link (Ctrl+K)" onClick={() => applyAction('link')}>&#128279;</button>
    </div>
  );
}
