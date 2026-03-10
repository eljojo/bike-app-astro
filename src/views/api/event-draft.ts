import type { APIContext } from 'astro';
import { env } from '../../lib/env';
import { authorize } from '../../lib/authorize';
import { jsonResponse, jsonError } from '../../lib/api-response';
import { CDN_FALLBACK_URL, CITY } from '../../lib/config';
import { getCityConfig } from '../../lib/city-config';
import { db } from '../../lib/get-db';
import { checkRateLimit, recordAttempt, cleanupOldAttempts, LIMITS } from '../../lib/rate-limit';
import { fuzzyMatchOrganizer } from '../../lib/fuzzy-match';
import { slugify } from '../../lib/slug';
import { generateMediaKey, confirmUpload } from '../../lib/storage';
import adminOrganizers from 'virtual:bike-app/admin-organizers';

export const prerender = false;

const VISION_MODEL = '@cf/meta/llama-4-scout-17b-16e-instruct';
const TEXT_MODEL = '@cf/meta/llama-3.1-8b-instruct';

const FIELD_SPEC = `Return this exact structure (omit fields you cannot find at all):

{
  "name": { "value": "event name", "confidence": 0.9 },
  "start_date": { "value": "YYYY-MM-DD", "confidence": 0.8 },
  "end_date": { "value": "YYYY-MM-DD (only if multi-day)", "confidence": 0.7 },
  "start_time": { "value": "HH:MM (24h format)", "confidence": 0.6 },
  "end_time": { "value": "HH:MM (24h format)", "confidence": 0.5 },
  "location": { "value": "event location or address", "confidence": 0.8 },
  "distances": { "value": "distances mentioned, e.g. 50km, 100km", "confidence": 0.7 },
  "organizer": { "value": "organizer name", "confidence": 0.6 },
  "organizer_website": { "value": "organizer website URL", "confidence": 0.5 },
  "organizer_instagram": { "value": "organizer Instagram handle (without @)", "confidence": 0.5 },
  "registration_url": { "value": "any registration URL or signup link mentioned", "confidence": 0.5 }
}

Return ONLY the JSON object. No markdown, no explanation, no code fences.`;

const POSTER_PROMPT = `You are analyzing an event poster image. Extract event information and return ONLY a valid JSON object.

For each field, include a confidence score from 0.0 to 1.0 indicating how certain you are about the extraction.

${FIELD_SPEC}`;

const WEBPAGE_PROMPT = `You are analyzing an event webpage. Extract event information and return ONLY a valid JSON object.

For each field, include a confidence score from 0.0 to 1.0 indicating how certain you are about the extraction.

${FIELD_SPEC}`;

const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_TEXT_LENGTH = 15_000; // Characters of page text to send
const HIGH_CONFIDENCE = 0.7;
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

const FIELD_NAMES = ['name', 'start_date', 'end_date', 'start_time', 'end_time', 'location', 'distances', 'organizer', 'organizer_website', 'organizer_instagram', 'registration_url'] as const;

/** Unwrap a field from the AI response, which may be {value, confidence} or a flat string. */
function unwrap(field: unknown): { value: string; confidence: number } | null {
  if (!field) return null;
  if (typeof field === 'object' && field !== null && 'value' in field) {
    const f = field as { value?: string; confidence?: number };
    if (!f.value) return null;
    return { value: f.value, confidence: f.confidence ?? 0.6 };
  }
  const s = String(field);
  return s ? { value: s, confidence: 0.6 } : null;
}

/**
 * Normalize raw AI output into a clean event draft that matches EventDetail shape,
 * plus a list of field names the user should double-check.
 */
function buildDraft(raw: Record<string, unknown>): {
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
  for (const field of ['start_time', 'end_date', 'end_time', 'location', 'distances', 'registration_url'] as const) {
    if (values[field]) draft[field] = values[field].value;
  }

  // Resolve organizer: slug reference if matched, inline object with details if not
  if (values.organizer) {
    const orgName = values.organizer.value;
    const match = fuzzyMatchOrganizer(orgName, adminOrganizers);
    if (match && match.confidence >= 0.7) {
      draft.organizer = match.slug;
    } else {
      const inline: Record<string, string> = { name: orgName };
      if (values.organizer_website) inline.website = values.organizer_website.value;
      if (values.organizer_instagram) inline.instagram = values.organizer_instagram.value;
      draft.organizer = inline;
    }
  }

  // Don't leak organizer sub-fields to the draft
  delete draft.organizer_website;
  delete draft.organizer_instagram;

  return { draft, uncertain };
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

  return ctx;
}

/** Strip HTML to plain text for AI processing. */
function htmlToText(html: string): string {
  let text = html;
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
  try {
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch {
    // Parse failed — return empty
  }
  return {};
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
  const cdnUrl = env.R2_PUBLIC_URL || CDN_FALLBACK_URL;
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
        return jsonError(`Failed to fetch URL: ${response.status}`, 502);
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
