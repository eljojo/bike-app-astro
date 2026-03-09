import type { APIContext } from 'astro';
import { env } from '../../lib/env';
import { authorize } from '../../lib/authorize';
import { jsonResponse, jsonError } from '../../lib/api-response';
import { CDN_FALLBACK_URL } from '../../lib/config';

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
  "registration_url": { "value": "any URL or website mentioned", "confidence": 0.5 }
}

Return ONLY the JSON object. No markdown, no explanation, no code fences.`;

export async function POST({ request, locals }: APIContext) {
  const user = authorize(locals, 'ai-extract');
  if (user instanceof Response) return user;

  const ai = env.AI as { run(model: string, input: unknown): Promise<{ response?: string | Record<string, unknown> }> } | undefined;
  if (!ai) {
    return jsonError('AI binding not available', 500);
  }

  try {
    const body = await request.json() as {
      poster_key: string;
      model?: string;
      organizers?: string[];
    };

    const { poster_key, organizers } = body;
    const model = body.model || DEFAULT_MODEL;
    if (!poster_key) return jsonError('poster_key required', 400);

    // Build prompt with organizer context
    let prompt = EXTRACTION_PROMPT;
    if (organizers && organizers.length > 0) {
      prompt += `\n\nKnown organizers (try to match one if applicable): ${organizers.join(', ')}`;
    }

    // Fetch poster image from CDN
    const cdnUrl = env.R2_PUBLIC_URL || CDN_FALLBACK_URL;
    const imageUrl = `${cdnUrl}/${poster_key}`;
    const imageResponse = await fetch(imageUrl);
    if (!imageResponse.ok) {
      return jsonError(`Failed to fetch poster: ${imageResponse.status}`, 500);
    }

    const imageBuffer = await imageResponse.arrayBuffer();
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

    // Accept license for models that require it
    if (model.includes('llama-3.2')) {
      await ai.run(model, { prompt: 'agree' }).catch(() => {});
    }

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

    // Parse the AI response — some models return a string, others an object
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
        extracted = { _parseError: true };
      }
    }

    return jsonResponse({ extracted, model, durationMs });
  } catch (err: unknown) {
    console.error('AI extract error:', err);
    const message = err instanceof Error ? err.message : 'Extraction failed';
    return jsonError(message, 500);
  }
}
