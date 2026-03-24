/* eslint-disable bike-app/require-authorize-call -- public weather endpoint, excluded from auth middleware */
import type { APIRoute } from 'astro';
import { env, tileCache } from '../../lib/env/env.service';
import { getCityConfig } from '../../lib/config/city-config';
import { CITY } from '../../lib/config/config';
import { fetchCurrentWeather, evaluateWeather } from '../../lib/external/open-meteo.server';
import type { WeatherResult } from '../../lib/external/open-meteo.server';
import { t } from '../../i18n';

export const prerender = false;

const CACHE_TTL = 60 * 60; // 1 hour in seconds
const CLIENT_CACHE_TTL = 900; // 15 minutes

interface WeatherResponse {
  rideable: boolean;
  text?: string;
  sunscreen?: string;
}

function jsonResponse(data: WeatherResponse): Response {
  return new Response(JSON.stringify(data), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': `public, max-age=${CLIENT_CACHE_TTL}`,
    },
  });
}

export const GET: APIRoute = async ({ url }) => {
  const locale = url.searchParams.get('locale') || undefined;
  const cacheKey = `weather:${CITY}:${locale || 'default'}`;

  // Check cache
  const cached = await tileCache.get(cacheKey).catch(() => null);
  if (cached) {
    const text = new TextDecoder().decode(cached);
    return jsonResponse(JSON.parse(text));
  }

  // Fetch from Open-Meteo
  const { center } = getCityConfig();
  let result: WeatherResult;
  try {
    const current = await fetchCurrentWeather(center.lat, center.lng);
    result = evaluateWeather(current, { staging: env.ENVIRONMENT === 'staging' });
  } catch (err) {
    console.error('Weather fetch failed:', err);
    result = { rideable: false };
  }

  // Build translated response
  let response: WeatherResponse;
  if (!result.rideable || result.temperature == null || !result.descriptionKey) {
    response = { rideable: false };
  } else {
    const description = t(`weather.${result.descriptionKey}`, locale);
    const text = t('weather.good_day', locale, { temp: result.temperature, description });
    response = { rideable: true, text };
    if (result.uvIndex != null && result.uvIndex >= 6) {
      response.sunscreen = t('weather.sunscreen', locale);
    }
  }

  // Cache result (fire-and-forget)
  const encoded = new TextEncoder().encode(JSON.stringify(response));
  tileCache.put(cacheKey, encoded, CACHE_TTL).catch(() => {});

  return jsonResponse(response);
};
