import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { cityDir } from './config';
import { shortLocale, defaultLocale } from './locale-utils';

type TagTranslations = Record<string, Record<string, string>>;

let cached: TagTranslations | null = null;

function load(): TagTranslations {
  if (cached) return cached;
  const filePath = path.join(cityDir, 'tag-translations.yml');
  if (!fs.existsSync(filePath)) {
    cached = {};
    return cached;
  }
  cached = (yaml.load(fs.readFileSync(filePath, 'utf-8')) as TagTranslations) || {};
  return cached;
}

/**
 * Load the raw tag translations map.
 * Used to pass translations to client-side components.
 */
export function loadTagTranslations(): TagTranslations {
  return load();
}

/**
 * Translate a route tag for the given locale.
 * Returns the original tag if no translation exists.
 */
export function tTag(tag: string, locale: string | undefined): string {
  const short = shortLocale(locale || defaultLocale());
  const entry = load()[tag];
  return entry?.[short] ?? tag;
}
