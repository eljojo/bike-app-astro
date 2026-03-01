import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { cityDir } from './config';

export interface CityConfig {
  name: string;
  display_name: string;
  timezone: string;
  locale: string;
  bounds: { north: number; south: number; east: number; west: number };
  place_categories: Record<string, string[]>;
}

let cached: CityConfig | null = null;

export function getCityConfig(): CityConfig {
  if (cached) return cached;
  const configPath = path.join(cityDir, 'config.yml');
  const raw = fs.readFileSync(configPath, 'utf-8');
  cached = yaml.load(raw) as CityConfig;
  return cached;
}
