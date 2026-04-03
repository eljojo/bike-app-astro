import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { z } from 'zod/v4';
import { cityDir } from './config.server';

/**
 * Validates the raw YAML structure from config.yml.
 * Fields that can be derived (url, cdn_url, etc.) are optional here
 * because getCityConfig() computes them from `domain` when absent.
 * Uses looseObject to allow additional fields without breaking validation.
 */
export const cityConfigSchema = z.looseObject({
  instance_type: z.enum(['blog', 'wiki', 'club']).optional(),
  name: z.string(),
  display_name: z.string(),
  tagline: z.string(),
  description: z.string(),
  url: z.string().optional(),
  domain: z.string(),
  cdn_url: z.string().optional(),
  videos_cdn_url: z.string().optional(),
  timezone: z.string(),
  locale: z.string(),
  locales: z.array(z.string()).optional(),
  author: z.looseObject({
    name: z.string(),
    email: z.string(),
    url: z.string(),
    twitter: z.string().optional(),
    photo_url: z.string().optional(),
  }),
  plausible_domain: z.string().optional(),
  site_title_html: z.string().optional(),
  center: z.object({ lat: z.number(), lng: z.number() }),
  bounds: z.object({ north: z.number(), south: z.number(), east: z.number(), west: z.number() }),
  place_categories: z.record(z.string(), z.array(z.string())),
  privacy_zone: z.object({
    lat: z.number().optional(),
    lng: z.number().optional(),
    radius_m: z.number().optional(),
    jitter_m: z.number().optional(),
    default_enabled: z.boolean(),
  }).optional(),
  acp_club_code: z.string().optional(),
  results_privacy: z.enum(['full_name', 'last_name_only', 'initials']).optional(),
  page_posters: z.record(z.string(), z.string()).optional(),
  weather: z.object({
    min_temp: z.number().optional(),
    max_temp: z.number().optional(),
    max_wind_kmh: z.number().optional(),
  }).optional(),
});

/** Full CityConfig type with derived fields guaranteed present after getCityConfig(). */
export interface CityConfig {
  instance_type?: 'blog' | 'wiki' | 'club';
  name: string;
  display_name: string;
  tagline: string;
  description: string;
  url: string;
  domain: string;
  cdn_url: string;
  videos_cdn_url: string;
  timezone: string;
  locale: string;
  locales?: string[];
  author: {
    name: string;
    email: string;
    url: string;
    twitter?: string;
    photo_url?: string;
  };
  plausible_domain: string;
  site_title_html: string;
  center: { lat: number; lng: number };
  bounds: { north: number; south: number; east: number; west: number };
  place_categories: Record<string, string[]>;
  privacy_zone?: {
    lat?: number;
    lng?: number;
    radius_m?: number;
    jitter_m?: number;
    default_enabled: boolean;
  };
  acp_club_code?: string;
  results_privacy?: 'full_name' | 'last_name_only' | 'initials';
  page_posters?: Partial<Record<'home' | 'about' | 'calendar' | 'map', string>>;
  weather?: {
    min_temp?: number;
    max_temp?: number;
    max_wind_kmh?: number;
  };
}

let cached: CityConfig | null = null;

export function getCityConfig(): CityConfig {
  if (cached) return cached;
  const configPath = path.join(cityDir, 'config.yml');
  const raw = fs.readFileSync(configPath, 'utf-8');
  const config = cityConfigSchema.parse(yaml.load(raw)) as CityConfig;

  // Derive defaults from domain and display_name
  if (config.domain) {
    if (!config.url) config.url = `https://${config.domain}`;
    if (!config.cdn_url) config.cdn_url = `https://${config.domain}`;
    if (!config.videos_cdn_url) config.videos_cdn_url = `https://${config.domain}`;
    if (!config.plausible_domain) config.plausible_domain = config.domain;
  }
  if (config.display_name && !config.site_title_html) {
    config.site_title_html = config.display_name;
  }

  cached = config;
  return cached;
}

export function isBlogInstance(): boolean {
  return getCityConfig().instance_type === 'blog';
}

export function isClubInstance(): boolean {
  return getCityConfig().instance_type === 'club';
}
