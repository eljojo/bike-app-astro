import type { APIContext } from 'astro';
import { env } from '../../lib/env/env.service';
import { authorize } from '../../lib/auth/authorize';
import { jsonResponse, jsonError } from '../../lib/api-response';
import { CITY } from '../../lib/config/config';
import { getCityConfig } from '../../lib/config/city-config';
import { db } from '../../lib/get-db';
import { checkRateLimit, recordAttempt, cleanupOldAttempts, LIMITS } from '../../lib/auth/rate-limit';
import { fuzzyMatchOrganizer } from '../../lib/fuzzy-match';
import { EVENT_TAG_SLUGS } from '../../lib/event-tags';
import { slugify } from '../../lib/slug';
import { generateMediaKey, confirmUpload } from '../../lib/media/storage.adapter-r2';
import { fetchJson } from '../../lib/content/load-admin-content.server';

let adminOrganizers: Array<{ slug: string; name: string; website?: string; instagram?: string }> = [];

export const prerender = false;

const VISION_MODEL = '@cf/meta/llama-4-scout-17b-16e-instruct';
const TEXT_MODEL = VISION_MODEL;

const FIELD_SPEC = `Return this exact JSON structure (omit fields you cannot find at all):

{"name":{"value":"event name","c":9},"start_date":{"value":"YYYY-MM-DD","c":8},"end_date":{"value":"YYYY-MM-DD","c":7},"start_time":{"value":"HH:MM","c":6},"end_time":{"value":"HH:MM","c":5},"meet_time":{"value":"HH:MM","c":5},"location":{"value":"location","c":8},"distances":{"value":"e.g. 50km, 100km","c":7},"organizer":{"value":"organizer name","c":6},"organizer_website":{"value":"URL","c":5},"organizer_instagram":{"value":"handle without @","c":5},"registration_url":{"value":"signup URL","c":5},"event_url":{"value":"event homepage URL","c":5},"map_url":{"value":"route map URL","c":5},"edition":{"value":"e.g. 53rd, 2026","c":5},"review_url":{"value":"ride report or review URL","c":4},"tags":["tag1","tag2"],"series":{"schedule":[{"date":"YYYY-MM-DD","location":"optional"}],"recurrence":"weekly or biweekly","recurrence_day":"day name","season_start":"YYYY-MM-DD","season_end":"YYYY-MM-DD"}}

Rules:
- "c" is your confidence from 0 to 10 (integer)
- Dates must be YYYY-MM-DD, times must be HH:MM in 24h format
- Omit fields entirely if not found (do NOT use empty strings or "null")
- "tags" is a plain array of tag slugs (not {value,c}). Only use tags from the provided list. Omit if none clearly apply.
- URLs must have proper JSON escaping (escape backslashes and quotes)
- "meet_time" is separate from "start_time" — e.g. "meet 6:45, roll 7:00" means meet_time=18:45, start_time=19:00
- "series" — IMPORTANT: include this whenever the page lists 2 or more dates for related events (race stages, weekly rides, a multi-day series, etc.):
  - If 2+ specific dates are listed (e.g. "Stage 1: May 13", "Stage 2: May 27"), use "schedule" with an array of {date, location?} entries
  - If dates follow a weekly or biweekly pattern, ALSO set "recurrence", "recurrence_day", "season_start", "season_end"
  - The "name" field should be the SERIES name (e.g. "#OttBike Social"), not include specific dates
  - Each schedule entry needs at minimum: date (YYYY-MM-DD)
  - If different locations per date, include "location" in each entry
  - For multi-stage events (Stage 1, Stage 2, etc.), each stage is a schedule entry with its date and location
  - If the page has a "series registration" URL plus per-stage registration URLs, use the series URL as "registration_url"
- Return ONLY valid JSON. No markdown, no explanation, no code fences.

Examples:

1) Simple one-off event:
{"name":{"value":"Spring Bike Day","c":9},"start_date":{"value":"2026-05-23","c":9},"start_time":{"value":"10:00","c":8},"end_time":{"value":"15:00","c":7},"location":{"value":"City Hall Plaza","c":9},"organizer":{"value":"City Cycling Coalition","c":8},"tags":["family-friendly"]}

2) Recurring weekly event with a season range (no individual dates listed):
{"name":{"value":"BMX Gate Practice","c":9},"start_date":{"value":"2026-05-05","c":9},"end_date":{"value":"2026-08-25","c":8},"start_time":{"value":"18:15","c":8},"meet_time":{"value":"18:30","c":7},"location":{"value":"BMX Track, 93 Houlahan St","c":9},"organizer":{"value":"Nepean BMX","c":8},"tags":["bmx","family-friendly"],"series":{"recurrence":"weekly","recurrence_day":"tuesday","season_start":"2026-05-05","season_end":"2026-08-25"}}

3) Event series with specific dates and varying locations (no recurrence rule):
{"name":{"value":"Winter Social Ride","c":9},"start_date":{"value":"2026-01-08","c":9},"end_date":{"value":"2026-03-19","c":8},"start_time":{"value":"19:00","c":9},"meet_time":{"value":"18:45","c":7},"distances":{"value":"~10km","c":8},"organizer":{"value":"Social Ride Club","c":7},"tags":["social"],"series":{"schedule":[{"date":"2026-01-08","location":"Overbrook CC, 33 Quill"},{"date":"2026-01-22","location":"Hintonburg CC, 1064 Wellington W."},{"date":"2026-02-05","location":"Ottawa South CC, 260 Sunnyside"},{"date":"2026-02-19","location":"Overbrook CC, 33 Quill"},{"date":"2026-03-19","location":"Ottawa South CC, 260 Sunnyside"}]}}

4) Multi-stage race series with numbered stages at different venues (page lists "Stage 1: May 6 | Park A", "Stage 2: May 20 | Park B", etc.):
{"name":{"value":"Sunset MTB Race Series","c":9},"start_date":{"value":"2026-05-06","c":9},"end_date":{"value":"2026-08-19","c":8},"start_time":{"value":"18:30","c":8},"meet_time":{"value":"18:00","c":7},"location":{"value":"Various locations","c":7},"organizer":{"value":"Valley Trail Runners","c":9},"registration_url":{"value":"https://example.com/series/sunset-mtb-2026","c":8},"tags":["race"],"series":{"schedule":[{"date":"2026-05-06","location":"Pine Ridge Park"},{"date":"2026-05-20","location":"Pine Ridge Park"},{"date":"2026-06-03","location":"Cedar Hills"},{"date":"2026-06-17","location":"Cedar Hills"},{"date":"2026-07-22","location":"Maple Grove"},{"date":"2026-08-19","location":"Maple Grove"}],"recurrence":"biweekly","recurrence_day":"wednesday","season_start":"2026-05-06","season_end":"2026-08-19"}}`;

const POSTER_PROMPT = `Extract event information from this poster image. Return ONLY a valid JSON object.

${FIELD_SPEC}`;

const WEBPAGE_PROMPT = `Extract event information from this webpage. Return ONLY a valid JSON object.

${FIELD_SPEC}`;

const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_TEXT_LENGTH = 24_000; // Characters of page text to send
const HIGH_CONFIDENCE = 7; // 0-10 scale
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

const FIELD_NAMES = ['name', 'start_date', 'end_date', 'start_time', 'end_time', 'meet_time', 'location', 'distances', 'organizer', 'organizer_website', 'organizer_instagram', 'registration_url', 'event_url', 'map_url', 'edition', 'review_url'] as const;

/** Unwrap a field from the AI response, which may be {value, c} or a flat string. */
function unwrap(field: unknown): { value: string; confidence: number } | null {
  if (!field) return null;
  if (typeof field === 'object' && field !== null && 'value' in field) {
    const f = field as { value?: string; c?: number; confidence?: number };
    if (!f.value || f.value === 'null') return null;
    const confidence = f.c ?? (f.confidence != null ? f.confidence * 10 : 6);
    return { value: f.value, confidence };
  }
  const s = String(field);
  return s && s !== 'null' ? { value: s, confidence: 6 } : null;
}

/**
 * Normalize raw AI output into a clean event draft that matches EventDetail shape,
 * plus a list of field names the user should double-check.
 */
export function buildDraft(
  raw: Record<string, unknown>,
  organizers: typeof adminOrganizers = adminOrganizers,
): {
  draft: Record<string, unknown>;
  uncertain: string[];
} {
  const values: Record<string, { value: string; confidence: number }> = {};

  for (const field of FIELD_NAMES) {
    const parsed = unwrap(raw[field]);
    if (parsed) values[field] = parsed;
  }

  if (Object.keys(values).length === 0) {
    return { draft: {}, uncertain: [] };
  }

  const uncertain = Object.entries(values)
    .filter(([k, v]) => v.confidence < HIGH_CONFIDENCE && !k.startsWith('organizer_'))
    .map(([k]) => k);

  // Build draft in EventDetail shape
  const today = new Date().toISOString().split('T')[0];
  const name = values.name?.value || '';
  const startDate = values.start_date?.value || today;

  const draft: Record<string, unknown> = {
    name,
    slug: name ? slugify(name) : '',
    year: startDate.substring(0, 4),
    start_date: startDate,
  };

  // Optional string fields
  for (const field of ['start_time', 'end_date', 'end_time', 'meet_time', 'location', 'distances', 'registration_url', 'event_url', 'map_url', 'edition', 'review_url'] as const) {
    if (values[field]) draft[field] = values[field].value;
  }

  // Resolve organizer: always produce an inline object so extracted fields aren't lost
  if (values.organizer) {
    const orgName = values.organizer.value;
    const match = fuzzyMatchOrganizer(orgName, organizers);
    const inline: Record<string, string> = { name: match ? match.name : orgName };
    // Carry over known organizer fields first, then overlay extracted fields
    if (match && match.confidence >= 0.7) {
      const known = organizers.find(o => o.slug === match.slug);
      if (known?.website) inline.website = known.website;
      if (known?.instagram) inline.instagram = known.instagram;
    }
    if (values.organizer_website) inline.website = values.organizer_website.value;
    if (values.organizer_instagram) inline.instagram = values.organizer_instagram.value;
    draft.organizer = inline;
  }

  // Tags: plain array, validated against known slugs
  if (Array.isArray(raw.tags)) {
    const validTags = (raw.tags as unknown[])
      .filter((t): t is string => typeof t === 'string' && EVENT_TAG_SLUGS.includes(t as typeof EVENT_TAG_SLUGS[number]));
    if (validTags.length > 0) draft.tags = validTags;
  }

  // Series: pass through after basic shape validation
  if (raw.series && typeof raw.series === 'object') {
    const s = raw.series as Record<string, unknown>;
    const series: Record<string, unknown> = {};

    // Explicit schedule: array of {date, location?}
    if (Array.isArray(s.schedule)) {
      const schedule = (s.schedule as Array<Record<string, unknown>>)
        .filter(entry => entry && typeof entry === 'object' && typeof entry.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(entry.date as string))
        .map(entry => {
          const cleaned: Record<string, string> = { date: entry.date as string };
          if (typeof entry.location === 'string' && entry.location) cleaned.location = entry.location;
          if (typeof entry.start_time === 'string' && entry.start_time) cleaned.start_time = entry.start_time;
          if (typeof entry.meet_time === 'string' && entry.meet_time) cleaned.meet_time = entry.meet_time;
          if (typeof entry.note === 'string' && entry.note) cleaned.note = entry.note;
          return cleaned;
        });
      if (schedule.length >= 2) series.schedule = schedule;
    }

    // Recurrence fields
    if (typeof s.recurrence === 'string' && (s.recurrence === 'weekly' || s.recurrence === 'biweekly')) {
      series.recurrence = s.recurrence;
    }
    if (typeof s.recurrence_day === 'string') {
      const day = s.recurrence_day.toLowerCase();
      if (['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].includes(day)) {
        series.recurrence_day = day;
      }
    }
    if (typeof s.season_start === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s.season_start)) {
      series.season_start = s.season_start;
    }
    if (typeof s.season_end === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s.season_end)) {
      series.season_end = s.season_end;
    }

    // Only include series if it has a valid schedule or complete recurrence rule
    const hasSchedule = Array.isArray(series.schedule) && (series.schedule as unknown[]).length >= 2;
    const hasRecurrence = series.recurrence && series.recurrence_day && series.season_start && series.season_end;
    if (hasSchedule || hasRecurrence) {
      draft.series = series;
      // Set start_date to the first occurrence if not already set from other fields
      if (hasSchedule && !values.start_date) {
        const firstDate = (series.schedule as Array<{ date: string }>)[0].date;
        draft.start_date = firstDate;
        draft.year = firstDate.substring(0, 4);
      }
    }
  }

  // Don't leak organizer sub-fields to the draft
  delete draft.organizer_website;
  delete draft.organizer_instagram;

  return { draft, uncertain };
}

// Month name → number for date parsing
const MONTH_MAP: Record<string, string> = {
  january: '01', february: '02', march: '03', april: '04',
  may: '05', june: '06', july: '07', august: '08',
  september: '09', october: '10', november: '11', december: '12',
  jan: '01', feb: '02', mar: '03', apr: '04',
  jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
};

/**
 * Try to extract a series schedule from page text when the AI didn't detect one.
 * Looks for patterns like "Stage 1: May 13 | Domaine Kanawe" or "Stage 1: May 13 — Park A".
 * Returns a schedule array or null if no pattern found.
 */
export function extractSeriesFromText(
  pageText: string,
  referenceYear?: string,
): Array<{ date: string; location?: string }> | null {
  // Gate: only attempt extraction if the page contains a schedule-related heading.
  // This prevents false positives from unrelated numbered content (archived results,
  // other events, venue calendars) on pages that happen to contain stage-like text.
  const hasScheduleContext = /(?:dates|schedule|series|stages|calendar|preliminary)\s*:/i.test(pageText);
  if (!hasScheduleContext) return null;

  // Match lines like "Stage 1: May 13 | Domaine Kanawe" or "Race 1 - June 5 | Place"
  // Intentionally narrow: only triggers on stage/race/round/leg numbering patterns.
  // "event" excluded — too generic, matches unrelated content on multi-event pages.
  const stagePattern = /(?:stage|race|round|leg)\s*#?\s*(\d+)\s*[:.\-–—]\s*([A-Za-z]+)\s+(\d{1,2})(?:\s*[|,\-–—]\s*(.+))?/gi;
  const matches: Array<{ num: number; month: string; day: string; location?: string }> = [];

  let m;
  while ((m = stagePattern.exec(pageText)) !== null) {
    const num = parseInt(m[1], 10);
    const monthName = m[2].toLowerCase();
    const day = m[3];
    const location = m[4]?.trim();

    if (!MONTH_MAP[monthName]) continue;
    matches.push({ num, month: MONTH_MAP[monthName], day: day.padStart(2, '0'), location });
  }

  if (matches.length < 2) return null;

  // Sort by stage number and deduplicate
  matches.sort((a, b) => a.num - b.num);
  const seen = new Set<number>();
  const unique = matches.filter(m => {
    if (seen.has(m.num)) return false;
    seen.add(m.num);
    return true;
  });

  if (unique.length < 2) return null;

  // Determine year: use reference year (from AI-extracted start_date) or current year
  const year = referenceYear || new Date().getFullYear().toString();

  return unique.map(entry => {
    const dateStr = `${year}-${entry.month}-${entry.day}`;
    const result: { date: string; location?: string } = { date: dateStr };
    if (entry.location) result.location = entry.location;
    return result;
  });
}

/** Build context suffix for the AI prompt (date, city, locales, organizers). */
function buildContextSuffix(): string {
  const cityConfig = getCityConfig();
  const now = new Date();
  const dateFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: cityConfig.timezone,
    year: 'numeric', month: 'long', day: 'numeric', weekday: 'long',
  });

  let ctx = `\n\nContext for interpreting this content:`;
  ctx += `\n- Today's date: ${dateFormatter.format(now)}`;
  ctx += `\n- City/region: ${cityConfig.name} (${CITY})`;
  ctx += `\n- Timezone: ${cityConfig.timezone}`;
  if (cityConfig.locales && cityConfig.locales.length > 1) {
    ctx += `\n- This is a multilingual region. Content may be in ${cityConfig.locales.map(l => l.split('-')[0]).join(' or ')}. Extract the primary language content.`;
  }
  ctx += `\n- If dates reference a day of the week without a specific date, resolve to the next upcoming occurrence.`;

  const organizerNames = adminOrganizers.map(o => o.name);
  if (organizerNames.length > 0) {
    ctx += `\n\nKnown organizers (try to match one if applicable): ${organizerNames.join(', ')}`;
  }

  ctx += `\n\nEvent tags (use only if clearly applicable): ${EVENT_TAG_SLUGS.join(', ')}`;

  return ctx;
}

/** Strip HTML to plain text for AI processing. */
export function htmlToText(html: string): string {
  let text = html;
  // Remove JSON data blobs (Wix viewer model, warmup data, etc.) — before general script removal
  text = text.replace(/<script[^>]*type="application\/json"[^>]*>[\s\S]*?<\/script>/gi, '');
  // Remove script and style blocks
  text = text.replace(/<script[\s\S]*?<\/script>/gi, '');
  text = text.replace(/<style[\s\S]*?<\/style>/gi, '');
  text = text.replace(/<nav[\s\S]*?<\/nav>/gi, '');
  text = text.replace(/<footer[\s\S]*?<\/footer>/gi, '');
  // Preserve links as "text (url)"
  text = text.replace(/<a[^>]+href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, '$2 ($1)');
  // Block elements → newlines
  text = text.replace(/<\/?(p|div|br|h[1-6]|li|tr|section|article|header|blockquote)[^>]*>/gi, '\n');
  // Strip remaining tags
  text = text.replace(/<[^>]+>/g, '');
  // Decode common entities
  text = text.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');
  // Collapse whitespace
  text = text.replace(/[ \t]+/g, ' ');
  text = text.replace(/\n{3,}/g, '\n\n');
  return text.trim();
}

/** Parse the AI response (string or object) into a record. */
function parseAiResponse(raw: unknown): Record<string, unknown> {
  if (typeof raw === 'object' && raw !== null) {
    return raw as Record<string, unknown>;
  }
  const responseText = String(raw || '');
  const jsonMatch = responseText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    console.warn('[event-draft] No JSON object found in AI response:', responseText.substring(0, 300));
    return {};
  }
  try {
    return JSON.parse(jsonMatch[0]);
  } catch {
    // AI often produces invalid JSON — try field-by-field regex extraction
  }
  const result: Record<string, unknown> = {};
  for (const field of FIELD_NAMES) {
    // Match both "c":N and "confidence":N formats
    const re = new RegExp(`"${field}"\\s*:\\s*\\{\\s*"value"\\s*:\\s*"([^"]*)"\\s*,\\s*"(?:c|confidence)"\\s*:\\s*([\\d.]+)`);
    const m = jsonMatch[0].match(re);
    if (m) result[field] = { value: m[1], c: parseFloat(m[2]) };
  }
  if (Object.keys(result).length > 0) {
    console.log(`[event-draft] Recovered ${Object.keys(result).length} fields from malformed JSON`);
  } else {
    console.warn('[event-draft] Could not extract any fields from AI response');
  }
  return result;
}

/** Convert an ArrayBuffer to base64 in chunks (avoids call stack limits). */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunks: string[] = [];
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    chunks.push(String.fromCharCode(...chunk));
  }
  return btoa(chunks.join(''));
}

type AiBinding = { run(model: string, input: unknown): Promise<{ response?: string | Record<string, unknown> }> };

/** Extract event data from a poster image stored in R2. */
async function extractFromPoster(
  ai: AiBinding, model: string, posterKey: string,
): Promise<{ extracted: Record<string, unknown>; durationMs: number }> {
  const cdnUrl = env.R2_PUBLIC_URL || getCityConfig().cdn_url;
  const imageUrl = `${cdnUrl}/${posterKey}`;
  const imageResponse = await fetch(imageUrl);
  if (!imageResponse.ok) {
    throw new Error(`Failed to fetch poster: ${imageResponse.status}`);
  }

  const imageBuffer = await imageResponse.arrayBuffer();
  if (imageBuffer.byteLength > MAX_IMAGE_SIZE) {
    throw new Error('Poster image too large for analysis (max 10MB)');
  }

  const contentType = imageResponse.headers.get('content-type') || 'image/jpeg';
  const base64 = arrayBufferToBase64(imageBuffer);
  const prompt = POSTER_PROMPT + buildContextSuffix();

  const start = Date.now();
  const result = await ai.run(model, {
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: prompt },
        { type: 'image_url', image_url: { url: `data:${contentType};base64,${base64}` } },
      ],
    }],
  });

  return { extracted: parseAiResponse(result.response), durationMs: Date.now() - start };
}

/** Extract event data from webpage HTML text. */
async function extractFromHtml(
  ai: AiBinding, model: string, pageText: string, sourceUrl: string,
): Promise<{ extracted: Record<string, unknown>; durationMs: number }> {
  const truncated = pageText.length > MAX_TEXT_LENGTH
    ? pageText.substring(0, MAX_TEXT_LENGTH) + '\n\n[content truncated]'
    : pageText;

  const prompt = WEBPAGE_PROMPT + buildContextSuffix()
    + `\n\nSource URL: ${sourceUrl}`
    + `\n\n--- PAGE CONTENT ---\n${truncated}`;

  console.log(`[event-draft] Extracting from URL: ${sourceUrl} (${pageText.length} chars → ${truncated.length} chars)`);

  const start = Date.now();
  const result = await ai.run(model, {
    messages: [{ role: 'user', content: prompt }],
  });
  const durationMs = Date.now() - start;

  console.log(`[event-draft] AI response (${durationMs}ms):`, JSON.stringify(result.response).substring(0, 500));

  return { extracted: parseAiResponse(result.response), durationMs };
}

/** Stage an image buffer to R2, returning the media key and content type. */
async function stageImage(imageBuffer: ArrayBuffer): Promise<{ key: string; contentType: string }> {
  if (!env.BUCKET) throw new Error('Storage not configured');
  const prefix = env.STORAGE_KEY_PREFIX || '';
  const key = await generateMediaKey(env.BUCKET, prefix);
  const pendingKey = `${prefix}uploads/pending/${key}`;
  await env.BUCKET.put(pendingKey, imageBuffer);
  return confirmUpload(env.BUCKET, key, prefix);
}

export async function POST({ request, locals }: APIContext) {
  const { organizers } = await fetchJson<{ organizers: typeof adminOrganizers }>(new URL('/admin/data/events.json', request.url));
  adminOrganizers = organizers;

  const user = authorize(locals, 'event-draft');
  if (user instanceof Response) return user;

  // Rate limiting (same tiers as media upload)
  const role: string = user.role ?? 'guest';
  const limit = LIMITS[role];

  if (limit != null) {
    const database = db();
    const ip = request.headers.get('cf-connecting-ip')
      || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      || 'unknown';

    const identifiers = [`user:${user.id}`, `ip:${ip}`];
    const overLimit = await checkRateLimit(database, 'event-draft', identifiers, limit);

    if (overLimit) {
      return jsonError('Rate limit exceeded', 429);
    }

    await recordAttempt(database, 'event-draft', identifiers);
    cleanupOldAttempts(database, 'event-draft').catch(() => {});
  }

  const ai = env.AI as AiBinding | undefined;
  if (!ai) {
    return jsonError('AI binding not available', 500);
  }

  try {
    const body = await request.json() as {
      poster_key?: string;
      url?: string;
    };

    // Mode 1: Extract from an already-uploaded poster image
    if (body.poster_key) {
      const { extracted, durationMs } = await extractFromPoster(ai, VISION_MODEL, body.poster_key);
      const { draft, uncertain } = buildDraft(extracted);
      return jsonResponse({ draft, uncertain, durationMs });
    }

    // Mode 2: Fetch a URL — auto-detect image vs webpage
    if (body.url) {
      let parsed: URL;
      try {
        parsed = new URL(body.url);
      } catch {
        return jsonError('Invalid URL', 400);
      }
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        return jsonError('URL must be http or https', 400);
      }

      // Cloudflare Workers' outbound fetch() routes through Cloudflare's network and
      // cannot reach private/internal IP ranges, providing built-in SSRF protection.
      const response = await fetch(body.url);
      if (!response.ok) {
        return jsonError('Could not retrieve content from that URL. The page may be blocked or unavailable.', 502);
      }

      const contentType = response.headers.get('content-type') || '';
      const isImage = IMAGE_TYPES.some(t => contentType.startsWith(t));

      if (isImage) {
        // Image URL: stage to R2, extract from image, return poster info
        const imageBuffer = await response.arrayBuffer();
        if (imageBuffer.byteLength > MAX_IMAGE_SIZE) {
          return jsonError('Image too large (max 10MB)', 400);
        }

        const staged = await stageImage(imageBuffer);
        const { extracted, durationMs } = await extractFromPoster(ai, VISION_MODEL, staged.key);
        const { draft, uncertain } = buildDraft(extracted);
        return jsonResponse({
          draft, uncertain, durationMs,
          poster_key: staged.key,
          poster_content_type: staged.contentType,
        });
      }

      // HTML/text URL: extract event data from page content
      const html = await response.text();
      const pageText = htmlToText(html);
      if (pageText.length < 50) {
        return jsonError('Page has too little content to extract from', 400);
      }

      const { extracted, durationMs } = await extractFromHtml(ai, TEXT_MODEL, pageText, body.url);
      const { draft, uncertain } = buildDraft(extracted);

      // If the AI didn't detect a series, try extracting one from the page text
      if (!draft.series) {
        const schedule = extractSeriesFromText(pageText, draft.year as string | undefined);
        if (schedule) {
          draft.series = { schedule };
          // Set start/end dates from the schedule
          if (!draft.start_date || draft.start_date === new Date().toISOString().split('T')[0]) {
            draft.start_date = schedule[0].date;
            draft.year = schedule[0].date.substring(0, 4);
          }
          if (!draft.end_date) {
            draft.end_date = schedule[schedule.length - 1].date;
          }
        }
      }

      // If the page URL looks like a registration page, use it as the registration URL
      if (!draft.registration_url) {
        draft.registration_url = body.url;
      }

      return jsonResponse({ draft, uncertain, durationMs });
    }

    return jsonError('Either poster_key or url is required', 400);
  } catch (err: unknown) {
    console.error('Event draft error:', err);
    const message = err instanceof Error ? err.message : 'Extraction failed';
    return jsonError(message, 500);
  }
}
