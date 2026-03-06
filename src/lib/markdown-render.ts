import { marked } from 'marked';

const BLOCKED_TAGS = ['script', 'iframe', 'object', 'embed', 'meta', 'link', 'base', 'form'];

function stripBlockedTags(html: string): string {
  let safe = html;
  for (const tag of BLOCKED_TAGS) {
    const paired = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}>`, 'gi');
    const single = new RegExp(`<${tag}\\b[^>]*\\/?>`, 'gi');
    safe = safe.replace(paired, '').replace(single, '');
  }
  return safe;
}

function stripDangerousAttributes(html: string): string {
  return html
    // Remove inline event handlers like onclick/onerror.
    .replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    // Remove inline style attributes to align with stricter CSP.
    .replace(/\sstyle\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    // Remove javascript: URLs in common URL-bearing attributes.
    .replace(/\s(href|src|xlink:href|action|formaction)\s*=\s*(['"])\s*javascript:[\s\S]*?\2/gi, '')
    .replace(/\s(href|src|xlink:href|action|formaction)\s*=\s*javascript:[^\s>]+/gi, '');
}

export async function renderMarkdownHtml(markdown: string): Promise<string> {
  const rawHtml = await Promise.resolve(marked.parse(markdown));
  return stripDangerousAttributes(stripBlockedTags(rawHtml));
}
