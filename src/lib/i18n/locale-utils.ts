import { getCityConfig } from '../config/city-config';

export type LocaleShort = string; // 'en', 'fr'

/** Get the short locale code for URLs: 'en-CA' → 'en' */
export function shortLocale(locale: string): LocaleShort {
  return locale.split('-')[0];
}

/** Get the full locale code for Intl formatting: 'en' → 'en-CA' */
export function fullLocale(short: LocaleShort): string {
  const config = getCityConfig();
  const all = config.locales || [config.locale];
  return all.find(l => l.startsWith(short)) || config.locale;
}

/** Get the default short locale for this city */
export function defaultLocale(): LocaleShort {
  return shortLocale(getCityConfig().locale);
}

/** Get all supported short locales for this city */
export function supportedLocales(): LocaleShort[] {
  const config = getCityConfig();
  const all = config.locales || [config.locale];
  return all.map(shortLocale);
}

/** Get the human-readable display name for a locale, capitalised (e.g. 'fr' → 'Français') */
export function localeLabel(locale: string): string {
  try {
    const display = new Intl.DisplayNames([locale], { type: 'language' });
    const name = display.of(locale);
    return name ? name.charAt(0).toUpperCase() + name.slice(1) : locale;
  } catch {
    return locale;
  }
}
