import { describe, it, expect } from 'vitest';
import { evaluateWeather } from '../../src/lib/external/open-meteo.server';

describe('evaluateWeather', () => {
  it('returns rideable for clear warm calm weather', () => {
    const result = evaluateWeather({
      temperature_2m: 22,
      wind_speed_10m: 10,
      weather_code: 0,
      uv_index: 3,
    });
    expect(result).toEqual({
      rideable: true,
      temperature: 22,
      description: 'clear',
      uvIndex: 3,
    });
  });

  it('returns not rideable when too cold', () => {
    const result = evaluateWeather({
      temperature_2m: 5,
      wind_speed_10m: 10,
      weather_code: 0,
      uv_index: 1,
    });
    expect(result.rideable).toBe(false);
  });

  it('returns not rideable when too hot', () => {
    const result = evaluateWeather({
      temperature_2m: 38,
      wind_speed_10m: 10,
      weather_code: 0,
      uv_index: 9,
    });
    expect(result.rideable).toBe(false);
  });

  it('returns not rideable when too windy', () => {
    const result = evaluateWeather({
      temperature_2m: 20,
      wind_speed_10m: 35,
      weather_code: 1,
      uv_index: 4,
    });
    expect(result.rideable).toBe(false);
  });

  it('returns not rideable when raining (weather code 61)', () => {
    const result = evaluateWeather({
      temperature_2m: 20,
      wind_speed_10m: 10,
      weather_code: 61,
      uv_index: 2,
    });
    expect(result.rideable).toBe(false);
  });

  it('rounds temperature to integer', () => {
    const result = evaluateWeather({
      temperature_2m: 18.7,
      wind_speed_10m: 5,
      weather_code: 2,
      uv_index: 5,
    });
    expect(result.rideable).toBe(true);
    expect(result.temperature).toBe(19);
  });

  it('maps weather code 1 to mostly clear', () => {
    const result = evaluateWeather({
      temperature_2m: 20,
      wind_speed_10m: 5,
      weather_code: 1,
      uv_index: 2,
    });
    expect(result.description).toBe('mostly clear');
  });

  it('maps weather code 2 to partly cloudy', () => {
    const result = evaluateWeather({
      temperature_2m: 20,
      wind_speed_10m: 5,
      weather_code: 2,
      uv_index: 2,
    });
    expect(result.description).toBe('partly cloudy');
  });

  it('maps weather code 3 to overcast', () => {
    const result = evaluateWeather({
      temperature_2m: 20,
      wind_speed_10m: 5,
      weather_code: 3,
      uv_index: 2,
    });
    expect(result.description).toBe('overcast');
  });

  it('is rideable at exactly 10 degrees (lower boundary)', () => {
    const result = evaluateWeather({
      temperature_2m: 10,
      wind_speed_10m: 5,
      weather_code: 0,
      uv_index: 1,
    });
    expect(result.rideable).toBe(true);
  });

  it('is rideable at exactly 35 degrees (upper boundary)', () => {
    const result = evaluateWeather({
      temperature_2m: 35,
      wind_speed_10m: 5,
      weather_code: 0,
      uv_index: 8,
    });
    expect(result.rideable).toBe(true);
  });

  it('is not rideable at exactly 30 km/h wind (boundary)', () => {
    const result = evaluateWeather({
      temperature_2m: 20,
      wind_speed_10m: 30,
      weather_code: 0,
      uv_index: 3,
    });
    expect(result.rideable).toBe(false);
  });
});
