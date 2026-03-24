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

/** Fetch current weather from Open-Meteo. Throws on non-200 responses. */
export async function fetchCurrentWeather(lat: number, lng: number): Promise<OpenMeteoCurrentWeather> {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,wind_speed_10m,weather_code,uv_index`;
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Open-Meteo API error: ${response.status} — ${body}`);
  }
  const data = await response.json();
  return data.current;
}
