/* eslint-disable bike-app/require-authorize-call -- public weather endpoint, excluded from auth middleware */
import type { APIRoute } from 'astro';
import { env, tileCache } from '../../lib/env/env.service';
import { getCityConfig } from '../../lib/config/city-config';
import { CITY } from '../../lib/config/config';
import { fetchCurrentWeather, evaluateWeather } from '../../lib/external/open-meteo.server';
import type { WeatherResult } from '../../lib/external/open-meteo.server';

export const prerender = false;

const CACHE_TTL = 60 * 60; // 1 hour in seconds
const CLIENT_CACHE_TTL = 900; // 15 minutes

function weatherResponse(result: WeatherResult): Response {
  return new Response(JSON.stringify(result), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': `public, max-age=${CLIENT_CACHE_TTL}`,
    },
  });
}

export const GET: APIRoute = async () => {
  const cacheKey = `weather:${CITY}`;

  // Check cache
  const cached = await tileCache.get(cacheKey).catch(() => null);
  if (cached) {
    const text = new TextDecoder().decode(cached);
    return weatherResponse(JSON.parse(text));
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

  // Cache result (fire-and-forget)
  const encoded = new TextEncoder().encode(JSON.stringify(result));
  tileCache.put(cacheKey, encoded, CACHE_TTL).catch(() => {});

  return weatherResponse(result);
};
