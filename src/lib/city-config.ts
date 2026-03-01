import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { cityDir } from './config';

export interface CityConfig {
  name: string;
  display_name: string;
  tagline: string;
  description: string;
  url: string;
  domain: string;
  cdn_url: string;
  videos_cdn_url: string;
  tiles_url: string;
  timezone: string;
  locale: string;
  author: {
    name: string;
    email: string;
    url: string;
    twitter: string;
    photo_url: string;
  };
  plausible_domain: string;
  site_title_html: string;
  center: { lat: number; lng: number };
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
