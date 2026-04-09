import { marked } from 'marked';

const BLOCKED_TAGS = ['script', 'iframe', 'object', 'embed', 'meta', 'link', 'base', 'form'];

function stripBlockedTags(html: string): string {
  let safe = html;
  for (const tag of BLOCKED_TAGS) {
    const paired = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}[^>]*>`, 'gi');
    const single = new RegExp(`<${tag}\\b[^>]*\\/?>`, 'gi');
    let prev;
    do { prev = safe; safe = safe.replace(paired, '').replace(single, ''); } while (safe !== prev);
  }
  return safe;
}

/** Loop a global replacement until the output stabilizes (handles nested constructs). */
function loopReplace(text: string, pattern: RegExp, replacement: string): string {
  let prev;
  do { prev = text; text = text.replace(pattern, replacement); } while (text !== prev);
  return text;
}

function stripDangerousAttributes(html: string): string {
  let safe = html;
  // Remove inline event handlers like onclick/onerror.
  safe = loopReplace(safe, /\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  // Remove inline style attributes to align with stricter CSP.
  safe = loopReplace(safe, /\sstyle\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  // Remove javascript: URLs in common URL-bearing attributes.
  safe = loopReplace(safe, /\s(href|src|xlink:href|action|formaction)\s*=\s*(['"])\s*javascript:[\s\S]*?\2/gi, '');
  safe = loopReplace(safe, /\s(href|src|xlink:href|action|formaction)\s*=\s*javascript:[^\s>]+/gi, '');
  return safe;
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

function linkPhone(match: string): string {
  const digits = digitsOnly(match);
  if (digits.replace(/^\+/, '').length < 10) return match;
  return `<a href="tel:${digits}">${match}</a>`;
}

function autoLinkPhones(html: string): string {
  // Split HTML into tags and text nodes. Only apply phone linking to text nodes
  // so we never corrupt attributes or content inside existing <a> tags.
  // The regex matches: <a>...</a> blocks, or any other HTML tag. Everything else is text.
  const parts = html.split(/(<a\b[^>]*>[\s\S]*?<\/a>|<[^>]+>)/gi);
  return parts
    .map((part, i) => {
      // Odd indices are captured groups (anchor blocks or HTML tags) — leave them alone.
      if (i % 2 === 1) return part;
      // Even indices are plain text between tags — safe to process.
      return part.replace(PHONE_RE, linkPhone);
    })
    .join('');
}

export async function renderMarkdownHtml(markdown: string): Promise<string> {
  const rawHtml = await Promise.resolve(marked.parse(markdown));
  return autoLinkPhones(stripDangerousAttributes(stripBlockedTags(rawHtml)));
}
