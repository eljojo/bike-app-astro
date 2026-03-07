import { describe, it, expect } from 'vitest';
import { renderMarkdownHtml } from '../src/lib/markdown-render';

describe('renderMarkdownHtml', () => {
  it('strips script tags from markdown HTML output', async () => {
    const html = await renderMarkdownHtml('Hello\n\n<script>alert("xss")</script>');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('alert("xss")');
    expect(html).toContain('<p>Hello</p>');
  });

  it('strips dangerous attributes and javascript URLs', async () => {
    const html = await renderMarkdownHtml(
      '<img src="x" onerror="alert(1)">\n\n<a href="javascript:alert(2)" onclick="alert(3)">Click</a>'
    );
    expect(html).not.toContain('onerror=');
    expect(html).not.toContain('onclick=');
    expect(html).not.toContain('javascript:');
    expect(html).toContain('<a');
    expect(html).toContain('Click</a>');
  });

  it('strips style attributes while preserving safe HTML attributes', async () => {
    const html = await renderMarkdownHtml(
      '<h1 style="font-size: 1.7em;">Welcome</h1>\n\n<p><a href="https://example.com" target="_blank" rel="noopener">Link</a></p>'
    );
    expect(html).toContain('<h1>Welcome</h1>');
    expect(html).not.toContain('style=');
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('target="_blank"');
  });
});
