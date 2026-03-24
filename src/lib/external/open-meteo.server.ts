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
  description?: string;
  uvIndex?: number;
}

const WMO_DESCRIPTIONS: Record<number, string> = {
  0: 'clear',
  1: 'mostly clear',
  2: 'partly cloudy',
  3: 'overcast',
};

const RIDEABLE_CODES = new Set(Object.keys(WMO_DESCRIPTIONS).map(Number));

/** Evaluate weather conditions for cycling suitability. Pure function, no side effects. */
export function evaluateWeather(current: OpenMeteoCurrentWeather): WeatherResult {
  const rideable =
    current.temperature_2m >= -10 &&
    current.temperature_2m <= 35 &&
    current.wind_speed_10m < 30 &&
    RIDEABLE_CODES.has(current.weather_code);

  if (!rideable) return { rideable: false };

  return {
    rideable: true,
    temperature: Math.round(current.temperature_2m),
    description: WMO_DESCRIPTIONS[current.weather_code] ?? 'clear',
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
