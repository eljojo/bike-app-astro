/**
 * Maps country names to ISO 3166-1 alpha-2 codes, then converts to flag emoji
 * using regional indicator symbols.
 */

const COUNTRY_CODES: Record<string, string> = {
  'afghanistan': 'AF', 'albania': 'AL', 'algeria': 'DZ', 'argentina': 'AR',
  'australia': 'AU', 'austria': 'AT', 'belgium': 'BE', 'bolivia': 'BO',
  'brazil': 'BR', 'canada': 'CA', 'chile': 'CL', 'china': 'CN',
  'colombia': 'CO', 'costa rica': 'CR', 'croatia': 'HR', 'cuba': 'CU',
  'czech republic': 'CZ', 'czechia': 'CZ', 'denmark': 'DK',
  'ecuador': 'EC', 'egypt': 'EG', 'england': 'GB', 'estonia': 'EE',
  'finland': 'FI', 'france': 'FR', 'germany': 'DE', 'greece': 'GR',
  'guatemala': 'GT', 'hungary': 'HU', 'iceland': 'IS', 'india': 'IN',
  'indonesia': 'ID', 'ireland': 'IE', 'israel': 'IL', 'italy': 'IT',
  'japan': 'JP', 'kenya': 'KE', 'latvia': 'LV', 'lithuania': 'LT',
  'luxembourg': 'LU', 'malaysia': 'MY', 'mexico': 'MX', 'morocco': 'MA',
  'nepal': 'NP', 'netherlands': 'NL', 'new zealand': 'NZ', 'nicaragua': 'NI',
  'norway': 'NO', 'panama': 'PA', 'peru': 'PE', 'philippines': 'PH',
  'poland': 'PL', 'portugal': 'PT', 'romania': 'RO', 'russia': 'RU',
  'scotland': 'GB', 'south africa': 'ZA', 'south korea': 'KR', 'spain': 'ES',
  'sweden': 'SE', 'switzerland': 'CH', 'taiwan': 'TW', 'thailand': 'TH',
  'turkey': 'TR', 'ukraine': 'UA', 'united kingdom': 'GB', 'uk': 'GB',
  'united states': 'US', 'usa': 'US', 'uruguay': 'UY', 'vietnam': 'VN',
};

function isoToFlag(code: string): string {
  return String.fromCodePoint(
    ...code.split('').map(c => 0x1F1E6 + c.charCodeAt(0) - 65),
  );
}

/** Convert a country name to its flag emoji. Returns empty string if unknown. */
export function countryToFlag(country: string): string {
  if (!country) return '';
  const code = COUNTRY_CODES[country.toLowerCase()];
  return code ? isoToFlag(code) : '';
}
