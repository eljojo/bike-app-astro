// scripts/lib/wikidata.mjs
//
// Wikidata enrichment for any bikepaths entry with a wikidata tag.
// Uses the REST API (not SPARQL). Test fixtures are real API responses,
// not invented shapes.

const WIKIDATA_API = 'https://www.wikidata.org/w/rest.php/wikibase/v1/entities/items';

const P_LENGTH = 'P2043';
const P_INCEPTION = 'P571';
const P_WEBSITE = 'P856';
const P_IMAGE = 'P18';
const P_COMMONS_CAT = 'P373';
const P_OPERATOR = 'P126';
const P_INSTANCE_OF = 'P31';
const P_OSM_RELATION = 'P402';
const P_ACTIVITIES = 'P2789';
const P_SOCIAL = 'P3984';
const P_PLATFORM = 'P553';

const EXPECTED_INSTANCE_OF = new Set([
  'Q221722',   // bike path
  'Q12670591', // trail
  'Q34442',    // road
  'Q1529437',  // rail trail
  'Q170826',   // greenway
  'Q786014',   // pedestrian path
  'Q3352369',  // multi-use path
  'Q79007',    // street
  'Q12280',    // bridge
  'Q537127',   // bridge (alt)
  'Q1068842',  // footbridge
  'Q353027',   // cycling route
]);

const CYCLING_ACTIVITIES = new Set([
  'Q53121',   // cycling
  'Q2024660', // cross-country cycling
  'Q3095844', // bicycle touring
]);

// Social media platform map: Q-ID → { name, urlTemplate }
const PLATFORM_MAP = {
  Q984:    { name: 'reddit',    urlTemplate: 'https://www.reddit.com/r/{username}' },
  Q918:    { name: 'x',         urlTemplate: 'https://x.com/{username}' },
  Q209330: { name: 'instagram', urlTemplate: 'https://www.instagram.com/{username}' },
  Q355:    { name: 'facebook',  urlTemplate: 'https://www.facebook.com/{username}' },
};

// Detect platform from a reference URL
function detectPlatformFromUrl(url) {
  if (url.includes('reddit.com'))    return PLATFORM_MAP.Q984;
  if (url.includes('x.com') || url.includes('twitter.com')) return PLATFORM_MAP.Q918;
  if (url.includes('instagram.com')) return PLATFORM_MAP.Q209330;
  if (url.includes('facebook.com'))  return PLATFORM_MAP.Q355;
  return null;
}

const Q_KILOMETRE = 'Q828224';
const Q_METRE = 'Q11573';

export async function fetchWikidataEntity(qid, fetchFn = fetch) {
  const url = `${WIKIDATA_API}/${qid}`;
  const res = await fetchFn(url, {
    headers: { 'Accept': 'application/json', 'User-Agent': 'whereto.bike/1.0 (https://ottawabybike.ca)' },
  });
  if (!res.ok) throw new Error(`Wikidata ${qid}: ${res.status}`);
  return res.json();
}

export function extractBikePathMetadata(entity) {
  const meta = {};

  // descriptions are plain strings in the REST API response
  if (entity.descriptions?.en) meta.description_en = entity.descriptions.en;
  if (entity.descriptions?.fr) meta.description_fr = entity.descriptions.fr;

  const lengthClaim = entity.statements?.[P_LENGTH]?.[0];
  if (lengthClaim) {
    // amount is a string like "+220" or "+5.3"
    const amount = parseFloat(lengthClaim.value.content.amount);
    // unit is a full URL like "http://www.wikidata.org/entity/Q828224"
    const unit = lengthClaim.value.content.unit;
    if (unit?.includes(Q_METRE)) meta.length_km = amount / 1000;
    else meta.length_km = amount; // km or unknown — store as-is
  }

  const inceptionClaim = entity.statements?.[P_INCEPTION]?.[0];
  if (inceptionClaim) {
    // time is "+1970-00-00T00:00:00Z", precision 8 = decade, 9 = year
    const time = inceptionClaim.value.content.time;
    const precision = inceptionClaim.value.content.precision;
    // time starts with "+YYYY" or "-YYYY"
    const year = parseInt(time.replace(/^[+-]/, '').slice(0, 4), 10);
    if (precision <= 8) {
      meta.inception = `${Math.floor(year / 10) * 10}s`;
    } else {
      meta.inception = String(year);
    }
  }

  const websiteClaim = entity.statements?.[P_WEBSITE]?.[0];
  if (websiteClaim) {
    // website value is a plain URL string in content
    meta.website = websiteClaim.value.content;
  }

  // P18 — Commons image filename
  const imageClaim = entity.statements?.[P_IMAGE]?.[0];
  if (imageClaim) {
    meta.commons_image = imageClaim.value.content;
  }

  // P373 — Commons category name
  const commonsCatClaim = entity.statements?.[P_COMMONS_CAT]?.[0];
  if (commonsCatClaim) {
    meta.commons_category = commonsCatClaim.value.content;
  }

  // P126 — operator Q-ID
  const operatorClaim = entity.statements?.[P_OPERATOR]?.[0];
  if (operatorClaim) {
    meta.operator_qid = operatorClaim.value.content;
  }

  // P31 — instance of (multiple Q-IDs)
  const instanceOfClaims = entity.statements?.[P_INSTANCE_OF];
  if (instanceOfClaims?.length) {
    meta.instance_of = instanceOfClaims.map(c => c.value.content);
  }

  // P3984 — social media accounts
  const socialClaims = entity.statements?.[P_SOCIAL] || [];
  const social = [];
  for (const claim of socialClaims) {
    const username = claim.value.content;

    // Try P553 qualifier first for platform identification
    const platformQualifier = claim.qualifiers?.find(q => q.property.id === P_PLATFORM);
    let platform = null;
    if (platformQualifier) {
      platform = PLATFORM_MAP[platformQualifier.value.content] || null;
    }

    // Fallback: detect platform from P854 reference URL
    if (!platform) {
      for (const ref of claim.references || []) {
        for (const part of ref.parts || []) {
          if (part.property.id === 'P854') {
            platform = detectPlatformFromUrl(part.value.content);
            if (platform) break;
          }
        }
        if (platform) break;
      }
    }

    if (platform) {
      social.push({
        platform: platform.name,
        username,
        url: platform.urlTemplate.replace('{username}', username),
      });
    }
  }
  meta.social = social;

  // sitelinks — Wikipedia links for en and fr
  const sitelinks = {};
  if (entity.sitelinks?.enwiki) {
    sitelinks.en = { title: entity.sitelinks.enwiki.title, url: entity.sitelinks.enwiki.url };
  }
  if (entity.sitelinks?.frwiki) {
    sitelinks.fr = { title: entity.sitelinks.frwiki.title, url: entity.sitelinks.frwiki.url };
  }
  if (Object.keys(sitelinks).length > 0) {
    meta.wikipedia_sitelinks = sitelinks;
  }

  return meta;
}

export function validateWikidataEntity(entity, entry) {
  const name = entry.name || entry.wikidata;

  // P402 — OSM relation ID cross-check
  const p402Claims = entity.statements?.[P_OSM_RELATION];
  if (p402Claims?.length && entry.osm_relations?.length) {
    const osmRelId = p402Claims[0].value.content;
    const entryIds = entry.osm_relations.map(String);
    if (!entryIds.includes(String(osmRelId))) {
      console.warn(`  ⚠ ${name}: Wikidata P402=${osmRelId} not found in osm_relations [${entryIds.join(', ')}]`);
    }
  }

  // P31 — instance-of sanity check
  const p31Claims = entity.statements?.[P_INSTANCE_OF];
  if (p31Claims?.length) {
    const qids = p31Claims.map(c => c.value.content);
    const hasExpected = qids.some(q => EXPECTED_INSTANCE_OF.has(q));
    if (!hasExpected) {
      console.warn(`  ⚠ ${name}: unexpected Wikidata instance_of [${qids.join(', ')}] — verify correct entity`);
    }
  }

  // P2789 — compatible activities cycling check
  const p2789Claims = entity.statements?.[P_ACTIVITIES];
  if (p2789Claims?.length) {
    const activityQids = p2789Claims.map(c => c.value.content);
    const hasCycling = activityQids.some(q => CYCLING_ACTIVITIES.has(q));
    if (!hasCycling) {
      console.warn(`  ⚠ ${name}: Wikidata entity has no cycling activity in P2789 — may be wrong entity`);
    }
  }
}

export async function resolveOperatorNames(entries, fetchFn = fetch) {
  // Collect unique operator Q-IDs
  const qidToEntries = new Map();
  for (const entry of entries) {
    const qid = entry.wikidata_meta?.operator_qid;
    if (!qid) continue;
    if (!qidToEntries.has(qid)) qidToEntries.set(qid, []);
    qidToEntries.get(qid).push(entry);
  }

  for (const [qid, group] of qidToEntries) {
    let name = qid;
    let website = null;
    try {
      const entity = await fetchWikidataEntity(qid, fetchFn);
      name = entity.labels?.en || entity.labels?.fr || qid;
      const websiteClaim = entity.statements?.[P_WEBSITE]?.[0];
      if (websiteClaim) website = websiteClaim.value.content;
    } catch {
      // fall back to Q-ID string
    }
    for (const entry of group) {
      entry.wikidata_meta.operator = name;
      if (website) entry.wikidata_meta.operator_website = website;
    }
  }
}

export async function fetchWikipediaExtracts(entries, fetchFn = fetch, { concurrency = 4 } = {}) {
  const candidates = entries.filter(e => e.wikidata_meta?.wikipedia_sitelinks);
  if (candidates.length === 0) return;

  const queue = [...candidates];

  async function worker() {
    let entry;
    while ((entry = queue.shift()) !== undefined) {
      const sitelinks = entry.wikidata_meta.wikipedia_sitelinks;
      for (const lang of Object.keys(sitelinks)) {
        const title = sitelinks[lang].title;
        const url = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
        try {
          const res = await fetchFn(url, {
            headers: { 'User-Agent': 'whereto.bike/1.0 (https://ottawabybike.ca)' },
          });
          if (!res.ok) continue;
          const data = await res.json();
          if (data.extract) {
            entry.wikidata_meta[`wikipedia_extract_${lang}`] = data.extract;
          }
        } catch {
          // skip failed fetches silently
        }
      }
      delete entry.wikidata_meta.wikipedia_sitelinks;
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, candidates.length) }, () => worker()));
}

export async function enrichWithWikidata(entries, { fetchFn = fetch, concurrency = 4 } = {}) {
  const candidates = entries.filter(e => e.wikidata && !e.wikidata_meta);
  if (candidates.length === 0) return 0;

  let enriched = 0;
  const queue = [...candidates];

  async function worker() {
    let entry;
    while ((entry = queue.shift()) !== undefined) {
      try {
        const entity = await fetchWikidataEntity(entry.wikidata, fetchFn);
        const meta = extractBikePathMetadata(entity);
        validateWikidataEntity(entity, entry);
        // labels are plain strings in the REST API response
        if (!entry.name_fr && entity.labels?.fr) entry.name_fr = entity.labels.fr;
        if (!entry.name_en && entity.labels?.en) entry.name_en = entity.labels.en;
        entry.wikidata_meta = meta;
        enriched++;
      } catch (err) {
        console.error(`  Wikidata ${entry.wikidata}: ${err.message}`);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, candidates.length) }, () => worker()));

  await resolveOperatorNames(entries, fetchFn);
  await fetchWikipediaExtracts(entries, fetchFn, { concurrency });

  return enriched;
}
