import { describe, it, expect } from 'vitest';
import { renderMarkdownHtml } from '../src/lib/markdown/markdown-render';

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

describe('renderMarkdownHtml phone auto-linking', () => {
  it('auto-links a phone number with dashes', async () => {
    const result = await renderMarkdownHtml('Call us at 613-521-3791 for info.');
    expect(result).toContain('<a href="tel:6135213791">613-521-3791</a>');
  });

  it('auto-links a phone number in parens format', async () => {
    const result = await renderMarkdownHtml('Call (613) 741-2443 today.');
    expect(result).toContain('tel:6137412443');
  });

  it('auto-links a +1 international number', async () => {
    const result = await renderMarkdownHtml('Reach us at +1-343-600-2453.');
    expect(result).toContain('tel:+13436002453');
  });

  it('does not link numbers that are too short', async () => {
    const result = await renderMarkdownHtml('Version 3.14 is out.');
    expect(result).not.toContain('tel:');
  });

  it('does not double-link numbers already in a markdown link', async () => {
    const result = await renderMarkdownHtml('Call [613-521-3791](tel:6135213791).');
    const matches = result.match(/tel:/g);
    expect(matches?.length).toBe(1);
  });

  it('does not corrupt phone numbers inside HTML attributes', async () => {
    const result = await renderMarkdownHtml('<img src="x" alt="Call 613-521-3791">');
    expect(result).toContain('alt="Call 613-521-3791"');
    expect(result).not.toContain('alt="Call <a');
  });
});
