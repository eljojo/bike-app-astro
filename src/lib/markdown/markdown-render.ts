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

// Matches common North American phone formats:
//   613-521-3791
//   (613) 741-2443
//   +1-343-600-2453
//   +1 343 600 2453
const PHONE_RE = /(\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g;

function digitsOnly(phone: string): string {
  const hasPlus = phone.trimStart().startsWith('+');
  const digits = phone.replace(/\D/g, '');
  return hasPlus ? `+${digits}` : digits;
}

function autoLinkPhones(html: string): string {
  // Split on existing <a ...>...</a> blocks so we never touch already-linked text.
  // The split pattern uses a capturing group so the anchors are preserved in the array.
  const parts = html.split(/(<a\b[^>]*>[\s\S]*?<\/a>)/gi);
  return parts
    .map((part, i) => {
      // Odd indices are the captured anchor tags — leave them alone.
      if (i % 2 === 1) return part;
      return part.replace(PHONE_RE, (match) => {
        const digits = digitsOnly(match);
        // Require at least 10 digits (ignoring the leading +) to avoid linking
        // short numeric sequences like version numbers.
        const digitCount = digits.replace(/^\+/, '').length;
        if (digitCount < 10) return match;
        return `<a href="tel:${digits}">${match}</a>`;
      });
    })
    .join('');
}

export async function renderMarkdownHtml(markdown: string): Promise<string> {
  const rawHtml = await Promise.resolve(marked.parse(markdown));
  return autoLinkPhones(stripDangerousAttributes(stripBlockedTags(rawHtml)));
}
