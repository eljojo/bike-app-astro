/**
 * Single source of truth for which secrets/keys a whereto.bike instance needs.
 *
 * Both setup-city.js (wiki/club) and the blog's setup.js import this list.
 * When AppEnv changes, update this file — both scripts adapt.
 *
 * Each entry maps to a binding the app reads from AppEnv at runtime
 * (see src/lib/config/app-env.ts).
 */

/**
 * @typedef {object} SecretEntry
 * @property {string} name — env/secret binding name (matches AppEnv field)
 * @property {boolean} required — will the app crash without it?
 * @property {'secret'|'var'} kind — wrangler secret (encrypted) or var (plaintext in config)
 * @property {string[]} instanceTypes — which instance types need it: 'wiki', 'blog', 'club'
 * @property {string|null} autoDetect — auto-detection method key, or null if must be prompted
 * @property {string} description — human-readable description for prompts
 * @property {string} howTo — instructions for obtaining the value
 */

/** @type {SecretEntry[]} */
export const SECRETS = [
  // -------------------------------------------------------------------------
  // Core — required for admin to function at all
  // -------------------------------------------------------------------------
  {
    name: 'GITHUB_TOKEN',
    required: true,
    kind: 'secret',
    instanceTypes: ['wiki', 'blog', 'club'],
    autoDetect: null,
    description: 'Personal access token for saving content edits',
    howTo: `1. Go to https://github.com/settings/personal-access-tokens/new
    2. Token name: "whereto-bike admin" (or any name you'll recognise)
    3. Expiration: 90 days (set a calendar reminder to rotate)
    4. Resource owner: your GitHub account
    5. Repository access: select both bike-routes AND bike-app-astro
    6. Permissions (on both repos):
       - Contents: Read and write
       - Pull requests: Read and write
    7. Click "Generate token" and copy it`,
  },

  // -------------------------------------------------------------------------
  // R2 — photo/media uploads via presigned URLs
  // -------------------------------------------------------------------------
  {
    name: 'R2_ACCOUNT_ID',
    required: true,
    kind: 'secret',
    instanceTypes: ['wiki', 'blog', 'club'],
    autoDetect: 'cloudflare-account-id',
    description: 'Cloudflare account ID (for R2 presigned URLs and CSP)',
    howTo: 'Auto-detected from wrangler login',
  },
  {
    name: 'R2_BUCKET_NAME',
    required: true,
    kind: 'secret',
    instanceTypes: ['wiki', 'blog', 'club'],
    autoDetect: 'wrangler-r2-binding',
    description: 'R2 bucket name (for presigned upload URLs)',
    howTo: 'Auto-detected from wrangler.jsonc R2 binding',
  },
  {
    name: 'R2_ACCESS_KEY_ID',
    required: true,
    kind: 'secret',
    instanceTypes: ['wiki', 'blog', 'club'],
    autoDetect: null,
    description: 'R2 API token Access Key ID (for presigned photo/media uploads)',
    howTo: `1. Cloudflare dashboard → R2 → "Manage R2 API Tokens"
    2. Click "Create API token"
    3. Token name: "whereto-bike uploads"
    4. Permissions: Object Read & Write
    5. Specify bucket: select your media bucket (e.g. eljojo-bike-prod)
    6. TTL: no expiration (or set a rotation reminder)
    7. Click "Create API Token"
    8. Copy "Access Key ID" — this is R2_ACCESS_KEY_ID`,
  },
  {
    name: 'R2_SECRET_ACCESS_KEY',
    required: true,
    kind: 'secret',
    instanceTypes: ['wiki', 'blog', 'club'],
    autoDetect: null,
    description: 'R2 API token Secret Access Key (paired with Access Key ID)',
    howTo: `Same token creation screen as R2_ACCESS_KEY_ID above.
    Copy "Secret Access Key" — shown only once, save it somewhere safe.`,
  },

  // -------------------------------------------------------------------------
  // Email login (SES) — without these, only passkey login works
  // -------------------------------------------------------------------------
  {
    name: 'SES_ACCESS_KEY_ID',
    required: false,
    kind: 'secret',
    instanceTypes: ['wiki', 'blog', 'club'],
    autoDetect: null,
    description: 'AWS IAM access key for sending magic link login emails via Amazon SES',
    howTo: `1. Go to https://console.aws.amazon.com/iam/home#/users
    2. Create a new IAM user (e.g. "whereto-ses-sender")
    3. Attach the "AmazonSESFullAccess" managed policy
    4. Go to Security credentials → Create access key
    5. Choose "Application running outside AWS"
    6. Copy "Access key ID"
    Without SES configured, only passkey login works (no email magic links).`,
  },
  {
    name: 'SES_SECRET_ACCESS_KEY',
    required: false,
    kind: 'secret',
    instanceTypes: ['wiki', 'blog', 'club'],
    autoDetect: null,
    description: 'AWS IAM secret key (paired with SES access key)',
    howTo: `Same screen as SES_ACCESS_KEY_ID above.
    Copy "Secret access key" — shown only once, save it somewhere safe.`,
  },
  {
    name: 'SES_REGION',
    required: false,
    kind: 'secret',
    instanceTypes: ['wiki', 'blog', 'club'],
    autoDetect: null,
    description: 'AWS region where SES identity is verified (e.g., us-east-1)',
    howTo: `Go to https://console.aws.amazon.com/ses/home
    Check the region dropdown in the top-right corner.
    Common regions: us-east-1, eu-west-1, ap-southeast-2.
    Must match the region where your domain/email is verified.`,
  },
  {
    name: 'SES_FROM',
    required: false,
    kind: 'secret',
    instanceTypes: ['wiki', 'blog', 'club'],
    autoDetect: 'city-domain',
    description: 'From address for login emails (must be verified in SES)',
    howTo: `Go to SES console → Verified identities.
    Verify either the domain (recommended) or a specific email address.
    For new AWS accounts in sandbox mode, recipients must also be verified.
    To send to any address, request production access in the SES console.
    Auto-detected as noreply@{domain} if not set.`,
  },

  // -------------------------------------------------------------------------
  // Map tiles
  // -------------------------------------------------------------------------
  {
    name: 'THUNDERFOREST_API_KEY',
    required: false,
    kind: 'secret',
    instanceTypes: ['wiki', 'blog', 'club'],
    autoDetect: null,
    description: 'Thunderforest API key for cycle/outdoors/transport map tile layers',
    howTo: `1. Go to https://www.thunderforest.com and sign up (free hobby tier available)
    2. Dashboard → your API key is shown on the main page
    3. The free tier allows 150,000 tiles/month — enough for most sites
    Without this, maps fall back to a plain OSM layer.`,
  },

  // -------------------------------------------------------------------------
  // Analytics
  // -------------------------------------------------------------------------
  {
    name: 'PLAUSIBLE_API_KEY',
    required: false,
    kind: 'secret',
    instanceTypes: ['wiki', 'club'],
    autoDetect: null,
    description: 'Plausible Analytics API key (for admin stats dashboard)',
    howTo: `1. Log in to your Plausible dashboard
    2. Settings → API Keys → "New API Key"
    3. Name it (e.g. "whereto-bike stats sync")
    4. Copy the key
    The city's config.yml plausible_domain must match a site in your Plausible account.
    Without this, the admin stats dashboard shows no data.`,
  },

  // -------------------------------------------------------------------------
  // Route imports
  // -------------------------------------------------------------------------
  {
    name: 'RWGPS_API_KEY',
    required: false,
    kind: 'secret',
    instanceTypes: ['wiki', 'club'],
    autoDetect: null,
    description: 'RideWithGPS API key (for importing routes from RWGPS URLs)',
    howTo: `1. Go to https://ridewithgps.com/api and request API access
    2. Once approved, your API key is shown in your account settings
    Without this, the "Import from RideWithGPS" button in the route creator won't work.
    Enter blank to skip if you don't need RWGPS import.`,
  },
  {
    name: 'RWGPS_AUTH_TOKEN',
    required: false,
    kind: 'secret',
    instanceTypes: ['wiki', 'club'],
    autoDetect: null,
    description: 'RideWithGPS auth token (paired with API key)',
    howTo: `Provided alongside RWGPS_API_KEY when your API access is approved.
    Enter blank to skip if you skipped RWGPS_API_KEY.`,
  },

  // -------------------------------------------------------------------------
  // Place search
  // -------------------------------------------------------------------------
  {
    name: 'GOOGLE_PLACES_API_KEY',
    required: false,
    kind: 'secret',
    instanceTypes: ['wiki', 'blog', 'club'],
    autoDetect: null,
    description: 'Google Places API key (auto-populate place details + import routes from Google Maps URLs)',
    howTo: `1. Go to https://console.cloud.google.com/apis/credentials
    2. Create credentials → API Key
    3. Click "Restrict Key":
       - Application restrictions: None (or HTTP referrers with your domain)
       - API restrictions: Restrict key → enable:
         - Places API (New)
         - Directions API
    4. Copy the API key
    Without this, place auto-fill and Google Maps route import won't work.
    Enter blank to skip if not needed.`,
  },

  // -------------------------------------------------------------------------
  // Map image proxy
  // -------------------------------------------------------------------------
  {
    name: 'GOOGLE_MAPS_STATIC_API_KEY',
    required: false,
    kind: 'secret',
    instanceTypes: ['wiki', 'blog'],
    autoDetect: null,
    description: 'Google Maps Static API key for map image proxy (og:image thumbnails)',
    howTo: `1. Go to https://console.cloud.google.com/apis/credentials
    2. Create credentials → API Key (or reuse your existing Google key)
    3. Click "Restrict Key":
       - API restrictions: enable Maps Static API
    4. Copy the API key
    Without this, bike path social card images won't be generated on demand.
    Enter blank to skip if not needed.`,
  },

  // -------------------------------------------------------------------------
  // Strava (blog only)
  // -------------------------------------------------------------------------
  {
    name: 'STRAVA_CLIENT_ID',
    required: false,
    kind: 'secret',
    instanceTypes: ['blog'],
    autoDetect: null,
    description: 'Strava OAuth app Client ID (for importing rides from Strava)',
    howTo: `1. Go to https://www.strava.com/settings/api
    2. Create an application:
       - Application Name: your blog name
       - Category: Other
       - Website: https://yourdomain.com
       - Authorization Callback Domain: yourdomain.com
    3. Copy "Client ID"
    Without this, the Strava import feature won't be available.
    Enter blank to skip if you don't need Strava import.`,
  },
  {
    name: 'STRAVA_CLIENT_SECRET',
    required: false,
    kind: 'secret',
    instanceTypes: ['blog'],
    autoDetect: null,
    description: 'Strava OAuth app Client Secret',
    howTo: `Same app page as STRAVA_CLIENT_ID above → "Client Secret".
    Enter blank to skip if you skipped STRAVA_CLIENT_ID.`,
  },

  // -------------------------------------------------------------------------
  // Video pipeline (managed by setup-aws-video.js, listed here for completeness)
  // -------------------------------------------------------------------------
  {
    name: 'MEDIACONVERT_ACCESS_KEY_ID',
    required: false,
    kind: 'secret',
    instanceTypes: ['wiki', 'blog'],
    autoDetect: 'video-setup',
    description: 'AWS presign user key for video uploads (set by setup-aws-video.js)',
    howTo: 'Run: make setup-video ARGS="configure-instance --prefix <city> --domain <domain>"',
  },
  {
    name: 'MEDIACONVERT_SECRET_ACCESS_KEY',
    required: false,
    kind: 'secret',
    instanceTypes: ['wiki', 'blog'],
    autoDetect: 'video-setup',
    description: 'AWS presign user secret (set by setup-aws-video.js)',
    howTo: 'Same as MEDIACONVERT_ACCESS_KEY_ID',
  },
  {
    name: 'S3_ORIGINALS_BUCKET',
    required: false,
    kind: 'secret',
    instanceTypes: ['wiki', 'blog'],
    autoDetect: 'video-setup',
    description: 'S3 bucket for video originals (set by setup-aws-video.js)',
    howTo: 'Same as MEDIACONVERT_ACCESS_KEY_ID',
  },
  {
    name: 'WEBHOOK_SECRET',
    required: false,
    kind: 'secret',
    instanceTypes: ['wiki', 'blog'],
    autoDetect: 'video-setup',
    description: 'Shared secret for video webhook (set by setup-aws-video.js)',
    howTo: 'Same as MEDIACONVERT_ACCESS_KEY_ID',
  },
];

/**
 * Get secrets for a specific instance type.
 * @param {'wiki'|'blog'|'club'} instanceType
 * @returns {SecretEntry[]}
 */
export function secretsForInstanceType(instanceType) {
  return SECRETS.filter((s) => s.instanceTypes.includes(instanceType));
}

/**
 * Get secrets that need prompting (not auto-detected, not managed by other scripts).
 * @param {'wiki'|'blog'|'club'} instanceType
 * @returns {SecretEntry[]}
 */
export function promptableSecrets(instanceType) {
  return secretsForInstanceType(instanceType).filter(
    (s) => s.autoDetect === null,
  );
}

/**
 * Get secrets that are auto-detected.
 * @param {'wiki'|'blog'|'club'} instanceType
 * @returns {SecretEntry[]}
 */
export function autoDetectableSecrets(instanceType) {
  return secretsForInstanceType(instanceType).filter(
    (s) => s.autoDetect !== null && s.autoDetect !== 'video-setup',
  );
}
