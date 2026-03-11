import { describe, it, expect } from 'vitest';
import { insertMarkdown } from '../src/components/admin/markdown-toolbar-utils';

describe('insertMarkdown', () => {
  it('wraps selected text with bold syntax', () => {
    const result = insertMarkdown('hello world', 6, 11, 'bold');
    expect(result).toEqual({ text: 'hello **world**', cursor: 15 });
  });

  it('inserts bold placeholder when no selection', () => {
    const result = insertMarkdown('hello ', 6, 6, 'bold');
    expect(result).toEqual({ text: 'hello **bold text**', cursor: 19 });
  });

  it('wraps selected text with italic syntax', () => {
    const result = insertMarkdown('hello world', 6, 11, 'italic');
    expect(result).toEqual({ text: 'hello *world*', cursor: 13 });
  });

  it('inserts heading at line start', () => {
    const result = insertMarkdown('hello', 3, 3, 'heading');
    expect(result).toEqual({ text: '## hello', cursor: 8 });
  });

  it('inserts horizontal rule on new line', () => {
    const result = insertMarkdown('hello', 5, 5, 'hr');
    expect(result).toEqual({ text: 'hello\n\n---\n\n', cursor: 12 });
  });

  it('wraps selected text as link', () => {
    const result = insertMarkdown('click here', 0, 10, 'link');
    expect(result).toEqual({ text: '[click here](url)', cursor: 17 });
  });

  it('inserts link placeholder when no selection', () => {
    const result = insertMarkdown('', 0, 0, 'link');
    expect(result).toEqual({ text: '[link text](url)', cursor: 16 });
  });
});
