import { getCityConfig } from './city-config';

interface LocaleStrings {
  elevation: Record<string, string>;
  shape: Record<string, string>;
  categories: Record<string, [string, string]>;
  place_summary_prefix: string;
}

const locales: Record<string, LocaleStrings> = {
  en: {
    elevation: {
      flat: 'a flat route 👍',
      mostly_flat: 'flatter than most routes 👍',
      fairly_flat: 'a fairly flat route 🚴',
      average: 'about average elevation 👀',
      above_average: 'harder than average elevation 📈',
      hard: 'very hard elevation ⚠️⛰️',
      very_hard: 'very very hard elevation ⚠️🌋',
    },
    shape: {
      loop: 'loop',
      'out-and-back': 'out & back',
    },
    categories: {
      cafe: ['cafe', 'cafes'],
      restaurant: ['restaurant', 'restaurants'],
      park: ['park', 'parks'],
      beach: ['beach', 'beaches'],
      'bike-shop': ['bike shop', 'bike shops'],
      'bike-trail': ['trail', 'trails'],
      'water-fountain': ['water fountain', 'water fountains'],
      'chill-spot': ['chill spot', 'chill spots'],
      lookout: ['lookout', 'lookouts'],
      bridge: ['bridge', 'bridges'],
      poutine: ['poutine spot', 'poutine spots'],
      beer: ['brewery', 'breweries'],
      pizza: ['pizza spot', 'pizza spots'],
      'ice-cream': ['ice cream spot', 'ice cream spots'],
      'bike-rental': ['bike rental', 'bike rentals'],
      ferry: ['ferry', 'ferries'],
      parking: ['parking lot', 'parking lots'],
      'meeting-point': ['meeting point', 'meeting points'],
      'camping-spot': ['campsite', 'campsites'],
      wc: ['restroom', 'restrooms'],
    },
    place_summary_prefix: 'passes',
  },
};

function getLocale(): LocaleStrings {
  const config = getCityConfig();
  return locales[config.locale] || locales.en;
}

export function tElevation(key: string): string {
  return getLocale().elevation[key] || key;
}

export function tShape(key: string): string {
  return getLocale().shape[key] || key;
}

export function tCategory(category: string, count: number): string {
  const locale = getLocale();
  const names = locale.categories[category] || [category, category + 's'];
  return count === 1 ? names[0] : names[1];
}

export function tPlaceSummary(places: { category: string; count: number }[]): string {
  const locale = getLocale();
  const parts = places.map(p => `${p.count} ${tCategory(p.category, p.count)}`);
  return locale.place_summary_prefix + ' ' + parts.join(', ');
}
