export type MarkdownAction = 'bold' | 'italic' | 'heading' | 'hr' | 'link' | 'image';

interface InsertResult {
  text: string;
  cursor: number;
}

export function insertMarkdown(
  text: string,
  selectionStart: number,
  selectionEnd: number,
  action: MarkdownAction,
): InsertResult {
  const selected = text.slice(selectionStart, selectionEnd);
  const before = text.slice(0, selectionStart);
  const after = text.slice(selectionEnd);

  switch (action) {
    case 'bold': {
      const insert = selected || 'bold text';
      const newText = `${before}**${insert}**${after}`;
      return { text: newText, cursor: before.length + 2 + insert.length + 2 };
    }
    case 'italic': {
      const insert = selected || 'italic text';
      const newText = `${before}*${insert}*${after}`;
      return { text: newText, cursor: before.length + 1 + insert.length + 1 };
    }
    case 'heading': {
      const lineStart = before.lastIndexOf('\n') + 1;
      const linePrefix = before.slice(0, lineStart);
      const lineContent = before.slice(lineStart) + selected + after;
      const newText = `${linePrefix}## ${lineContent}`;
      return { text: newText, cursor: newText.length };
    }
    case 'hr': {
      const newText = `${before}\n\n---\n\n${after}`;
      return { text: newText, cursor: before.length + 7 };
    }
    case 'link': {
      const linkText = selected || 'link text';
      const newText = `${before}[${linkText}](url)${after}`;
      return { text: newText, cursor: before.length + 1 + linkText.length + 6 };
    }
    case 'image': {
      const alt = selected || 'image';
      const newText = `${before}![${alt}](url)${after}`;
      return { text: newText, cursor: before.length + alt.length + 7 };
    }
  }
}
