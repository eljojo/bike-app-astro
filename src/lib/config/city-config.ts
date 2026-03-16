import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { cityDir } from './config.server';

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
    twitter: string;
    photo_url: string;
  };
  plausible_domain: string;
  site_title_html: string;
  center: { lat: number; lng: number };
  bounds: { north: number; south: number; east: number; west: number };
  place_categories: Record<string, string[]>;
  privacy_zone?: {
    lat: number;
    lng: number;
    radius_m: number;
    default_enabled: boolean;
  };
  acp_club_code?: string;
  results_privacy?: 'full_name' | 'last_name_only' | 'initials';
}

let cached: CityConfig | null = null;

export function getCityConfig(): CityConfig {
  if (cached) return cached;
  const configPath = path.join(cityDir, 'config.yml');
  const raw = fs.readFileSync(configPath, 'utf-8');
  const config = yaml.load(raw) as CityConfig;

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
