/* eslint-disable bike-app/require-authorize-call -- public weather endpoint, excluded from auth middleware */
import type { APIRoute } from 'astro';
import { env, tileCache } from '../../lib/env/env.service';
import { getCityConfig } from '../../lib/config/city-config';
import { CITY } from '../../lib/config/config';
import { fetchWeather, evaluateWeather, tomorrowForecast } from '../../lib/external/open-meteo.server';
import { t } from '../../i18n';

export const prerender = false;

const CACHE_TTL = 60 * 60; // 1 hour in seconds
const CLIENT_CACHE_TTL = 900; // 15 minutes

interface WeatherResponse {
  rideable: boolean;
  text?: string;
  sunscreen?: string;
  icon?: 'sun' | 'moon';
}

function jsonResponse(data: WeatherResponse): Response {
  return new Response(JSON.stringify(data), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': `public, max-age=${CLIENT_CACHE_TTL}`,
    },
  });
}

function localHour(timezone: string): number {
  const now = new Date();
  const timeStr = now.toLocaleTimeString('en-US', { timeZone: timezone, hour12: false, hour: 'numeric' });
  return parseInt(timeStr, 10);
}

export const GET: APIRoute = async ({ url }) => {
  const locale = url.searchParams.get('locale') || undefined;
  const config = getCityConfig();
  const timezone = config.timezone || 'UTC';
  const hour = localHour(timezone);
  const isNight = hour < 6 || hour >= 19;

  const cacheKey = `weather:${CITY}:${locale || 'default'}:${isNight ? 'night' : 'day'}`;

  // Check cache
  const cached = await tileCache.get(cacheKey).catch(() => null);
  if (cached) {
    const text = new TextDecoder().decode(cached);
    return jsonResponse(JSON.parse(text));
  }

  // Fetch from Open-Meteo
  let response: WeatherResponse;
  try {
    const data = await fetchWeather(config.center.lat, config.center.lng, timezone);
    const staging = env.ENVIRONMENT === 'staging';

    const weatherData = isNight && data.daily
      ? tomorrowForecast(data.daily)
      : data.current;
    const result = evaluateWeather(weatherData, { staging });

    if (!result.rideable || result.temperature == null || !result.descriptionKey) {
      response = { rideable: false };
    } else {
      const description = t(`weather.${result.descriptionKey}`, locale);
      const key = isNight ? 'weather.good_day_tomorrow' : 'weather.good_day';
      const text = t(key, locale, { temp: result.temperature, description });
      response = {
        rideable: true,
        text,
        icon: isNight ? 'moon' : 'sun',
      };
      if (result.uvIndex != null && result.uvIndex >= 6) {
        response.sunscreen = t('weather.sunscreen', locale);
      }
    }
  } catch (err) {
    console.error('Weather fetch failed:', err);
    response = { rideable: false };
  }

  // Cache result (fire-and-forget)
  const encoded = new TextEncoder().encode(JSON.stringify(response));
  tileCache.put(cacheKey, encoded, CACHE_TTL).catch(() => {});

  return jsonResponse(response);
};
