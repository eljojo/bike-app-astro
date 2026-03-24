/** Vendor-isolated Open-Meteo API wrapper. */

export interface OpenMeteoCurrentWeather {
  temperature_2m: number;
  wind_speed_10m: number;
  weather_code: number;
  uv_index: number;
}

export interface WeatherResult {
  rideable: boolean;
  temperature?: number;
  descriptionKey?: string;
  uvIndex?: number;
  /** true when showing tomorrow's forecast (nighttime request) */
  tomorrow?: boolean;
}

/** WMO code → i18n key suffix (translated by the API endpoint via t()) */
const WMO_DESCRIPTION_KEYS: Record<number, string> = {
  0: 'clear',
  1: 'mostly_clear',
  2: 'partly_cloudy',
  3: 'overcast',
};

const RIDEABLE_CODES = new Set(Object.keys(WMO_DESCRIPTION_KEYS).map(Number));

const MIN_TEMP_C = 10;
const MIN_TEMP_STAGING_C = -10;

/** Evaluate weather conditions for cycling suitability. Pure function, no side effects. */
export function evaluateWeather(current: OpenMeteoCurrentWeather, { staging = false } = {}): WeatherResult {
  const minTemp = staging ? MIN_TEMP_STAGING_C : MIN_TEMP_C;
  const rideable =
    current.temperature_2m >= minTemp &&
    current.temperature_2m <= 35 &&
    current.wind_speed_10m < 30 &&
    RIDEABLE_CODES.has(current.weather_code);

  if (!rideable) return { rideable: false };

  return {
    rideable: true,
    temperature: Math.round(current.temperature_2m),
    descriptionKey: WMO_DESCRIPTION_KEYS[current.weather_code] ?? 'clear',
    uvIndex: current.uv_index,
  };
}

export interface OpenMeteoResponse {
  current: OpenMeteoCurrentWeather;
  daily?: {
    time: string[];
    temperature_2m_max: number[];
    weather_code: number[];
    wind_speed_10m_max: number[];
    uv_index_max: number[];
  };
}

/** Fetch current weather + 7-day daily forecast from Open-Meteo. */
export async function fetchWeather(lat: number, lng: number, timezone: string): Promise<OpenMeteoResponse> {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,wind_speed_10m,weather_code,uv_index&daily=temperature_2m_max,weather_code,wind_speed_10m_max,uv_index_max&forecast_days=7&timezone=${encodeURIComponent(timezone)}`;
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Open-Meteo API error: ${response.status} — ${body}`);
  }
  return response.json();
}

// ---------------------------------------------------------------------------
// Air Quality
// ---------------------------------------------------------------------------

export interface AirQualityResult {
  aqi: number;
  pm2_5: number;
}

/** Fetch current air quality from Open-Meteo. Separate API from weather. */
export async function fetchAirQuality(lat: number, lng: number): Promise<AirQualityResult> {
  const url = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lng}&current=us_aqi,pm2_5`;
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Open-Meteo Air Quality API error: ${response.status} — ${body}`);
  }
  const data = await response.json();
  return { aqi: data.current.us_aqi, pm2_5: data.current.pm2_5 };
}

// ---------------------------------------------------------------------------
// Daily forecast helper
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Weather window — detect rare good days in a bad stretch
// ---------------------------------------------------------------------------

export interface WeatherWindow {
  /** 'only' = sole good day, 'rare' = 1–2 good days, 'upcoming' = not today but soon, null = plenty of good days */
  type: 'only' | 'rare' | 'upcoming' | null;
  /** Index of the next good day (0 = today) */
  nextGoodDayIndex?: number;
  /** Day name key for the next good day (e.g. 'thursday') */
  nextGoodDayName?: string;
  /** Temperature of the next good day */
  nextGoodDayTemp?: number;
  /** Description key of the next good day */
  nextGoodDayDescriptionKey?: string;
  /** How many rideable days in the 7-day window */
  rideableDays: number;
}

const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

/** Analyze the 7-day forecast for weather windows. */
export function analyzeWeatherWindow(
  daily: NonNullable<OpenMeteoResponse['daily']>,
  opts: { staging?: boolean } = {},
): WeatherWindow {
  const days = daily.time.length;
  const rideable: boolean[] = [];
  for (let i = 0; i < days; i++) {
    const result = evaluateWeather(dailyForecast(daily, i), opts);
    rideable.push(result.rideable);
  }

  const rideableDays = rideable.filter(Boolean).length;
  const todayRideable = rideable[0];

  // Find next good day (starting from tomorrow if today is not good)
  let nextGoodDayIndex: number | undefined;
  if (!todayRideable) {
    for (let i = 1; i < days; i++) {
      if (rideable[i]) { nextGoodDayIndex = i; break; }
    }
  }

  let type: WeatherWindow['type'] = null;
  if (todayRideable && rideableDays === 1) {
    type = 'only'; // today is the only good day all week
  } else if (todayRideable && rideableDays <= 2) {
    type = 'rare'; // today is one of very few good days
  } else if (!todayRideable && nextGoodDayIndex != null && rideableDays <= 2) {
    type = 'upcoming'; // today is bad but there's a window coming
  }

  const result: WeatherWindow = { type, rideableDays };

  if (nextGoodDayIndex != null) {
    const forecast = dailyForecast(daily, nextGoodDayIndex);
    const date = new Date(daily.time[nextGoodDayIndex] + 'T12:00:00');
    result.nextGoodDayIndex = nextGoodDayIndex;
    result.nextGoodDayName = DAY_NAMES[date.getDay()];
    result.nextGoodDayTemp = Math.round(forecast.temperature_2m);
    result.nextGoodDayDescriptionKey = WMO_DESCRIPTION_KEYS[forecast.weather_code] ?? 'clear';
  }

  return result;
}

/** Extract a day's forecast from daily arrays. Index 0 = today, 1 = tomorrow. */
export function dailyForecast(daily: NonNullable<OpenMeteoResponse['daily']>, dayIndex: number): OpenMeteoCurrentWeather {
  return {
    temperature_2m: daily.temperature_2m_max[dayIndex],
    wind_speed_10m: daily.wind_speed_10m_max[dayIndex],
    weather_code: daily.weather_code[dayIndex],
    uv_index: daily.uv_index_max[dayIndex],
  };
}
