/* eslint-disable bike-app/require-authorize-call -- public weather endpoint, excluded from auth middleware */
import type { APIRoute } from 'astro';
import { env, tileCache } from '../../lib/env/env.service';
import { getCityConfig } from '../../lib/config/city-config';
import { CITY } from '../../lib/config/config';
import { fetchWeather, evaluateWeather, dailyForecast, fetchAirQuality, analyzeWeatherWindow, resolveThresholds } from '../../lib/external/open-meteo.server';
import { t } from '../../i18n';

export const prerender = false;

const CACHE_TTL = 60 * 60; // 1 hour in seconds
const CLIENT_CACHE_TTL = 900; // 15 minutes

type WeatherIcon = 'sun' | 'cloud-sun' | 'cloud' | 'moon-stars' | 'face-mask';

interface WeatherResponse {
  rideable: boolean;
  text?: string;
  sunscreen?: string;
  airWarning?: string;
  icon?: WeatherIcon;
  prominence?: 'high' | 'normal';
}

function dayIcon(descriptionKey: string): WeatherIcon {
  if (descriptionKey === 'partly_cloudy') return 'cloud-sun';
  if (descriptionKey === 'overcast') return 'cloud';
  return 'sun';
}

function jsonResponse(data: WeatherResponse): Response {
  return new Response(JSON.stringify(data), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': `public, max-age=${CLIENT_CACHE_TTL}`,
      'CDN-Cache-Control': `public, max-age=${CACHE_TTL}`,
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
  const isEvening = hour >= 19;
  const period = isEvening ? 'evening' : hour < 6 ? 'late-night' : 'day';

  const cacheKey = `weather:${CITY}:${locale || 'default'}:${period}`;

  // Check cache
  const cached = await tileCache.get(cacheKey).catch(() => null);
  if (cached) {
    const text = new TextDecoder().decode(cached);
    return jsonResponse(JSON.parse(text));
  }

  // Fetch weather and air quality in parallel
  let response: WeatherResponse;
  try {
    const { lat, lng } = config.center;
    const [data, airQuality] = await Promise.all([
      fetchWeather(lat, lng, timezone),
      fetchAirQuality(lat, lng).catch(() => null),
    ]);
    const thresholds = resolveThresholds(config.weather, env.ENVIRONMENT === 'staging');

    // AQI > 100 = unhealthy — show warning instead of ride suggestion
    if (airQuality && airQuality.aqi > 100) {
      response = {
        rideable: false,
        text: t('weather.air_unhealthy', locale),
        icon: 'face-mask',
      };
    } else {
      // Analyze the 7-day window
      const window = data.daily ? analyzeWeatherWindow(data.daily, thresholds) : null;

      // If today isn't rideable but there's a rare good day coming, show that
      let weatherData;
      if (isEvening && data.daily) {
        weatherData = dailyForecast(data.daily, 1);
      } else if (hour < 6 && data.daily) {
        weatherData = dailyForecast(data.daily, 0);
      } else {
        weatherData = data.current;
      }
      const result = evaluateWeather(weatherData, thresholds);

      if (window?.type === 'upcoming' && window.nextGoodDayName && window.nextGoodDayTemp != null && window.nextGoodDayDescriptionKey) {
        // Today is bad but there's a rare good day coming
        const dayName = t(`weather.day.${window.nextGoodDayName}`, locale);
        const desc = t(`weather.${window.nextGoodDayDescriptionKey}`, locale);
        response = {
          rideable: true,
          text: t('weather.window_upcoming', locale, { day: dayName, temp: window.nextGoodDayTemp, description: desc }),
          icon: dayIcon(window.nextGoodDayDescriptionKey),
          prominence: 'high',
        };
      } else if (!result.rideable || result.temperature == null || !result.descriptionKey) {
        response = { rideable: false };
      } else {
        const description = t(`weather.${result.descriptionKey}`, locale);
        const key = isEvening ? 'weather.good_day_tomorrow' : 'weather.good_day';
        let text = t(key, locale, { temp: result.temperature, description });
        response = {
          rideable: true,
          text,
          icon: isNight ? 'moon-stars' : dayIcon(result.descriptionKey),
          prominence: (window?.type === 'only' || window?.type === 'rare') ? 'high' : 'normal',
        };

        // Add window context to the text
        if (window?.type === 'only') {
          response.text = t('weather.window_only', locale, { temp: result.temperature, description });
        } else if (window?.type === 'rare') {
          response.text = t('weather.window_rare', locale, { temp: result.temperature, description });
        }

        if (result.uvIndex != null && result.uvIndex >= 6) {
          response.sunscreen = t('weather.sunscreen', locale);
        }
        if (airQuality && airQuality.aqi > 50) {
          response.airWarning = t('weather.air_moderate', locale);
        }
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
