import { describe, it, expect } from 'vitest';
import { evaluateWeather, resolveThresholds } from '../../src/lib/external/open-meteo.server';

const defaults = resolveThresholds();

describe('evaluateWeather', () => {
  it('returns rideable for clear warm calm weather', () => {
    const result = evaluateWeather({
      temperature_2m: 22,
      wind_speed_10m: 10,
      weather_code: 0,
      uv_index: 3,
    }, defaults);
    expect(result).toEqual({
      rideable: true,
      temperature: 22,
      descriptionKey: 'clear',
      uvIndex: 3,
    });
  });

  it('returns not rideable when too cold', () => {
    const result = evaluateWeather({
      temperature_2m: 5,
      wind_speed_10m: 10,
      weather_code: 0,
      uv_index: 1,
    }, defaults);
    expect(result.rideable).toBe(false);
  });

  it('returns not rideable when too hot', () => {
    const result = evaluateWeather({
      temperature_2m: 38,
      wind_speed_10m: 10,
      weather_code: 0,
      uv_index: 9,
    }, defaults);
    expect(result.rideable).toBe(false);
  });

  it('returns not rideable when too windy', () => {
    const result = evaluateWeather({
      temperature_2m: 20,
      wind_speed_10m: 35,
      weather_code: 1,
      uv_index: 4,
    }, defaults);
    expect(result.rideable).toBe(false);
  });

  it('returns not rideable when raining (weather code 61)', () => {
    const result = evaluateWeather({
      temperature_2m: 20,
      wind_speed_10m: 10,
      weather_code: 61,
      uv_index: 2,
    }, defaults);
    expect(result.rideable).toBe(false);
  });

  it('rounds temperature to integer', () => {
    const result = evaluateWeather({
      temperature_2m: 18.7,
      wind_speed_10m: 5,
      weather_code: 2,
      uv_index: 5,
    }, defaults);
    expect(result.rideable).toBe(true);
    expect(result.temperature).toBe(19);
  });

  it('maps weather code 1 to mostly clear', () => {
    const result = evaluateWeather({
      temperature_2m: 20,
      wind_speed_10m: 5,
      weather_code: 1,
      uv_index: 2,
    }, defaults);
    expect(result.descriptionKey).toBe('mostly_clear');
  });

  it('maps weather code 2 to partly cloudy', () => {
    const result = evaluateWeather({
      temperature_2m: 20,
      wind_speed_10m: 5,
      weather_code: 2,
      uv_index: 2,
    }, defaults);
    expect(result.descriptionKey).toBe('partly_cloudy');
  });

  it('maps weather code 3 to overcast', () => {
    const result = evaluateWeather({
      temperature_2m: 20,
      wind_speed_10m: 5,
      weather_code: 3,
      uv_index: 2,
    }, defaults);
    expect(result.descriptionKey).toBe('overcast');
  });

  it('is rideable at exactly 10 degrees (lower boundary)', () => {
    const result = evaluateWeather({
      temperature_2m: 10,
      wind_speed_10m: 5,
      weather_code: 0,
      uv_index: 1,
    }, defaults);
    expect(result.rideable).toBe(true);
  });

  it('is rideable at exactly 30 degrees (upper boundary)', () => {
    const result = evaluateWeather({
      temperature_2m: 30,
      wind_speed_10m: 5,
      weather_code: 0,
      uv_index: 8,
    }, defaults);
    expect(result.rideable).toBe(true);
  });

  it('is not rideable above 30 degrees', () => {
    const result = evaluateWeather({
      temperature_2m: 31,
      wind_speed_10m: 5,
      weather_code: 0,
      uv_index: 8,
    }, defaults);
    expect(result.rideable).toBe(false);
  });

  it('is not rideable at exactly 30 km/h wind (boundary)', () => {
    const result = evaluateWeather({
      temperature_2m: 20,
      wind_speed_10m: 30,
      weather_code: 0,
      uv_index: 3,
    }, defaults);
    expect(result.rideable).toBe(false);
  });
});
