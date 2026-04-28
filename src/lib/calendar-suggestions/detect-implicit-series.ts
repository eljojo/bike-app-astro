import { NodeHtmlMarkdown } from 'node-html-markdown';

const htmlConverter = new NodeHtmlMarkdown();

const EXACT_PLACEHOLDERS = new Set<string>([
  'legacy event imported from webscorer',
  'tbd',
]);

const PLACEHOLDER_PATTERNS: RegExp[] = [
  /^more information.*will be posted closer to the start of the season/i,
  /^full information to be posted closer to the date/i,
];

const EMOJI_ONLY = /^[\p{Emoji}\p{Emoji_Modifier}\p{Emoji_Component}\s]*$/u;

/**
 * Convert an ICS DESCRIPTION (typically HTML from rich-text editors) to
 * markdown, then filter out known placeholders that mean "no real description
 * yet" (legacy imports, TBD, "to be posted closer" boilerplate, empty/emoji).
 *
 * Returns null when the description is absent or matches any placeholder; the
 * markdown string otherwise. Tests in tests/detect-implicit-series.test.ts.
 */
export function extractDescription(html: string | undefined): string | null {
  if (!html) return null;
  const md = htmlConverter.translate(html).trim();
  if (md === '') return null;
  if (EMOJI_ONLY.test(md)) return null;
  const lower = md.toLowerCase().trim();
  if (EXACT_PLACEHOLDERS.has(lower)) return null;
  for (const pattern of PLACEHOLDER_PATTERNS) {
    if (pattern.test(md)) return null;
  }
  return md;
}
