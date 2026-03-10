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
import adminOrganizers from 'virtual:bike-app/admin-organizers';

export const prerender = false;

const DEFAULT_MODEL = '@cf/meta/llama-4-scout-17b-16e-instruct';

const EXTRACTION_PROMPT = `You are analyzing an event poster image. Extract event information and return ONLY a valid JSON object.

For each field, include a confidence score from 0.0 to 1.0 indicating how certain you are about the extraction.

Return this exact structure (omit fields you cannot find at all):

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

const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10MB — guard before base64 encoding
const HIGH_CONFIDENCE = 0.7;

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

export async function POST({ request, locals }: APIContext) {
  const user = authorize(locals, 'poster-draft');
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
    const overLimit = await checkRateLimit(database, 'poster-draft', identifiers, limit);

    if (overLimit) {
      return jsonError('Rate limit exceeded', 429);
    }

    await recordAttempt(database, 'poster-draft', identifiers);
    cleanupOldAttempts(database, 'poster-draft').catch(() => {});
  }

  const ai = env.AI as { run(model: string, input: unknown): Promise<{ response?: string | Record<string, unknown> }> } | undefined;
  if (!ai) {
    return jsonError('AI binding not available', 500);
  }

  try {
    const body = await request.json() as {
      poster_key: string;
      model?: string;
    };

    const { poster_key } = body;
    const model = body.model || DEFAULT_MODEL;
    if (!poster_key) return jsonError('poster_key required', 400);

    // Build prompt with city and organizer context
    const cityConfig = getCityConfig();
    const now = new Date();
    const dateFormatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: cityConfig.timezone,
      year: 'numeric', month: 'long', day: 'numeric', weekday: 'long',
    });

    let prompt = EXTRACTION_PROMPT;
    prompt += `\n\nContext for interpreting this poster:`;
    prompt += `\n- Today's date: ${dateFormatter.format(now)}`;
    prompt += `\n- City/region: ${cityConfig.name} (${CITY})`;
    prompt += `\n- Timezone: ${cityConfig.timezone}`;
    if (cityConfig.locales && cityConfig.locales.length > 1) {
      prompt += `\n- This is a multilingual region. Posters may be in ${cityConfig.locales.map(l => l.split('-')[0]).join(' or ')}. Extract the primary language content.`;
    }
    prompt += `\n- If dates reference a day of the week without a specific date, resolve to the next upcoming occurrence.`;

    const organizerNames = adminOrganizers.map(o => o.name);
    if (organizerNames.length > 0) {
      prompt += `\n\nKnown organizers (try to match one if applicable): ${organizerNames.join(', ')}`;
    }

    // Fetch poster image from CDN
    const cdnUrl = env.R2_PUBLIC_URL || CDN_FALLBACK_URL;
    const imageUrl = `${cdnUrl}/${poster_key}`;
    const imageResponse = await fetch(imageUrl);
    if (!imageResponse.ok) {
      return jsonError(`Failed to fetch poster: ${imageResponse.status}`, 500);
    }

    const imageBuffer = await imageResponse.arrayBuffer();
    if (imageBuffer.byteLength > MAX_IMAGE_SIZE) {
      return jsonError('Poster image too large for analysis (max 10MB)', 400);
    }

    const contentType = imageResponse.headers.get('content-type') || 'image/jpeg';

    // Convert to base64 in chunks to avoid argument limit
    const bytes = new Uint8Array(imageBuffer);
    const chunks: string[] = [];
    const chunkSize = 8192;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
      chunks.push(String.fromCharCode(...chunk));
    }
    const base64 = btoa(chunks.join(''));

    // Call Workers AI
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
    const durationMs = Date.now() - start;

    // Parse the response — some models return a string, others an object
    const raw = result.response;
    let extracted: Record<string, unknown> = {};
    if (typeof raw === 'object' && raw !== null) {
      extracted = raw as Record<string, unknown>;
    } else {
      const responseText = String(raw || '');
      try {
        const jsonMatch = responseText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          extracted = JSON.parse(jsonMatch[0]);
        }
      } catch {
        // Parse failed — return empty draft, client will skip review
      }
    }

    const { draft, uncertain } = buildDraft(extracted);

    return jsonResponse({ draft, uncertain, durationMs });
  } catch (err: unknown) {
    console.error('Poster draft error:', err);
    const message = err instanceof Error ? err.message : 'Extraction failed';
    return jsonError(message, 500);
  }
}
