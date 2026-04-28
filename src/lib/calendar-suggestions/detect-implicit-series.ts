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

const CANCELLED_RE = /\b(?:CANCELLED|CANCELED)\b/i;
const NO_RIDE_RE = /\bNO RIDE\b/i;
const WX_RESCHEDULED_RE = /\bWX RESCHEDULED\b/i;
const TRAILING_REASON_RE = /[-—]\s*([A-Za-z][A-Za-z0-9 ]{0,30})\s*$/;
const NO_DAY_RIDE_DESC_RE = /^\s*<?p?>?\s*No\s+(?:Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)day\s+ride\b/i;
const NO_DAY_RIDE_REASON_RE = /No\s+\w+day\s+ride\s+(?:due to|because of)\s+(.+?)(?:[<.]|$)/i;

export interface CancellationSignal {
  cancelled: true;
  reason?: string;
}

/**
 * Detect a cancellation signal in an ICS occurrence's SUMMARY (preferred) or
 * DESCRIPTION (fallback). Returns null when no signal matches.
 *
 * Conditional cancellations in DESCRIPTION ("if there is no ride leader the
 * ride will be cancelled") are deliberately NOT matched — those rides are
 * still scheduled. The detector requires unconditional phrasing.
 */
export function detectCancellation(
  summary: string,
  description: string | undefined,
): CancellationSignal | null {
  const reasonFromSummary = (re: RegExp): string | undefined => {
    const match = summary.match(re);
    if (!match) return undefined;
    const after = summary.slice(match.index! + match[0].length);
    const reasonMatch = after.match(TRAILING_REASON_RE);
    return reasonMatch?.[1]?.trim();
  };

  if (WX_RESCHEDULED_RE.test(summary)) {
    return { cancelled: true, reason: 'WX' };
  }
  if (NO_RIDE_RE.test(summary)) {
    return { cancelled: true, reason: reasonFromSummary(NO_RIDE_RE) };
  }
  if (CANCELLED_RE.test(summary)) {
    return { cancelled: true, reason: reasonFromSummary(CANCELLED_RE) };
  }

  if (description) {
    if (NO_DAY_RIDE_DESC_RE.test(description)) {
      const reasonMatch = description.match(NO_DAY_RIDE_REASON_RE);
      return { cancelled: true, reason: reasonMatch?.[1]?.trim() };
    }
  }

  return null;
}
