#!/usr/bin/env node

/**
 * Idempotent city setup script.
 *
 * Like Ansible or Terraform — discovers cities from the data repo and
 * ensures each one is fully provisioned: wrangler env, CI matrix, Worker
 * secrets, R2 CORS, D1 migrations, build, deploy.
 *
 * By the end of the script, the city is up and running.
 *
 * Follows the same pattern as setup-aws-video.js: idempotent ensure*
 * functions, auto-detect what's derivable, prompt for the rest.
 *
 * Usage (run inside nix develop):
 *   make setup-city                          # ensure all cities
 *   make setup-city ARGS="--city santiago"   # ensure just one
 *   make setup-city ARGS="--dry-run"         # show what would change
 */

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import {
  ask, run, safeExec, log, logSkip, logAction,
  wranglerCmd, setWranglerSecret,
  getCloudflareAccountId, getCloudflareApiToken,
  ensureR2Cors,
} from './setup-aws-video.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// City Discovery
// ---------------------------------------------------------------------------

function discoverCities(contentDir) {
  const entries = readdirSync(contentDir, { withFileTypes: true });
  const cities = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const configPath = join(contentDir, entry.name, 'config.yml');
    if (!existsSync(configPath)) continue;

    const raw = readFileSync(configPath, 'utf8');
    const config = yaml.load(raw);

    cities.push({
      name: entry.name,
      domain: config.domain || `${entry.name}.whereto.bike`,
      display_name: config.display_name || config.name || entry.name,
    });
  }

  return cities.sort((a, b) => a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------------------
// Wrangler Environment
// ---------------------------------------------------------------------------

function readWranglerConfig() {
  const raw = readFileSync(resolve(ROOT, 'wrangler.jsonc'), 'utf8');
  const stripped = raw
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
  return JSON.parse(stripped);
}

function writeWranglerConfig(config) {
  writeFileSync(resolve(ROOT, 'wrangler.jsonc'), JSON.stringify(config, null, 2) + '\n');
}

function ensureWranglerEnv(config, city) {
  const envKey = `${city.name}-production`;

  if (city.name === 'ottawa') {
    logSkip(`wrangler env: ottawa uses "production" (template)`);
    return false;
  }

  if (config.env[envKey]) {
    logSkip(`wrangler env: ${envKey}`);
    return false;
  }

  const template = config.env['production'];
  const newEnv = JSON.parse(JSON.stringify(template));
  newEnv.name = `bike-${city.name}-production`;
  newEnv.vars = { ...newEnv.vars };
  newEnv.vars.STORAGE_KEY_PREFIX = `${city.name}/`;
  delete newEnv.vars.VIDEO_PREFIX;
  delete newEnv.vars.MEDIACONVERT_REGION;

  config.env[envKey] = newEnv;
  logAction(`wrangler env: added ${envKey}`);
  return true;
}

// ---------------------------------------------------------------------------
// CI Workflow Matrix
// ---------------------------------------------------------------------------

const WORKFLOW_PATH = resolve(ROOT, '.github/workflows/production.yml');

function ensureCityInWorkflow(cityName) {
  if (cityName === 'ottawa') {
    logSkip('workflow: ottawa is always in CI');
    return false;
  }

  let content = readFileSync(WORKFLOW_PATH, 'utf8');
  let changed = false;

  // 1. Rebuild-all echo line
  const echoMatch = content.match(/(echo\s+'cities=\[)("(?:[^"]*)"(?:,"(?:[^"]*)")+)\]/);
  if (echoMatch) {
    const cities = echoMatch[2].split(',').map(s => s.replace(/"/g, ''));
    if (!cities.includes(cityName)) {
      cities.push(cityName);
      content = content.replace(echoMatch[0], `${echoMatch[1]}${cities.map(c => `"${c}"`).join(',')}]`);
      logAction(`workflow: added ${cityName} to rebuild-all echo`);
      changed = true;
    } else {
      logSkip(`workflow: ${cityName} in rebuild-all echo`);
    }
  }

  // 2. Matrix include
  if (new RegExp(`^\\s+- city: ${cityName}$`, 'm').test(content)) {
    logSkip(`workflow: ${cityName} in matrix include`);
  } else {
    const entry = [
      `          - city: ${cityName}`,
      `            wrangler-env: ${cityName}-production`,
      `            run-migrations: false`,
    ].join('\n');
    content = content.replace('      fail-fast: false', entry + '\n      fail-fast: false');
    logAction(`workflow: added ${cityName} to matrix include`);
    changed = true;
  }

  if (changed) writeFileSync(WORKFLOW_PATH, content);
  return changed;
}

// ---------------------------------------------------------------------------
// Worker Secrets
// ---------------------------------------------------------------------------

/**
 * Ensure all required Worker secrets are set for a city environment.
 *
 * Auto-detects: R2_ACCOUNT_ID (from Cloudflare CLI), R2_BUCKET_NAME (from wrangler config).
 * Prompts for: GITHUB_TOKEN, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY.
 *
 * Prompted values are cached in promptCache so multi-city runs prompt once.
 */
async function ensureSecrets(city, wranglerEnv, wranglerConfig, promptCache) {
  if (city.name === 'ottawa') return; // Ottawa's secrets are managed manually

  console.log('\n  Worker secrets:\n');

  // List existing secrets to know what's already set
  let existingSecrets = '';
  try {
    existingSecrets = run(`${wranglerCmd()} secret list --env ${wranglerEnv}`);
  } catch {
    // Worker may not exist yet — that's fine, we'll set all secrets
  }

  const secretExists = (name) => existingSecrets.includes(name);

  // --- Auto-detected ---

  // R2_ACCOUNT_ID: derivable from Cloudflare CLI
  const accountId = getCloudflareAccountId();
  if (!accountId) {
    console.error('  ✗ Cannot detect Cloudflare account ID. Is wrangler logged in?');
    console.error('    Run: wrangler login');
    process.exit(1);
  }
  setWranglerSecret('R2_ACCOUNT_ID', accountId, wranglerEnv);

  // R2_BUCKET_NAME: from the R2 binding in wrangler config
  const r2Binding = wranglerConfig.env?.[wranglerEnv]?.r2_buckets?.[0]
    || wranglerConfig.env?.['production']?.r2_buckets?.[0];
  const bucketName = r2Binding?.bucket_name;
  if (bucketName) {
    setWranglerSecret('R2_BUCKET_NAME', bucketName, wranglerEnv);
  } else {
    console.warn('  ⚠ Could not detect R2 bucket name from wrangler config');
  }

  // --- Prompted (cached across cities) ---

  const prompted = [
    {
      name: 'GITHUB_TOKEN',
      guidance: [
        'GitHub Personal Access Token for admin git operations.',
        'Create at: https://github.com/settings/personal-access-tokens/new',
        'Permissions: Contents + Pull requests (R/W) on bike-routes + bike-app-astro',
      ],
    },
    {
      name: 'R2_ACCESS_KEY_ID',
      guidance: [
        'Cloudflare R2 API token Access Key ID (for presigned uploads).',
        'Create at: Cloudflare dashboard → R2 → Manage R2 API Tokens',
        'Permissions: Object Read & Write',
      ],
    },
    {
      name: 'R2_SECRET_ACCESS_KEY',
      guidance: [
        'Cloudflare R2 API token Secret Access Key (paired with the above).',
      ],
    },
  ];

  for (const { name, guidance } of prompted) {
    if (secretExists(name)) {
      logSkip(`${name}`);
      continue;
    }

    // Check cache from a prior city in this run
    if (promptCache.has(name)) {
      setWranglerSecret(name, promptCache.get(name), wranglerEnv, { force: true });
      continue;
    }

    // Prompt
    console.log('');
    for (const line of guidance) console.log(`  ${line}`);
    const value = (await ask(`  ${name}: `)).trim();
    if (!value) {
      console.warn(`  ⚠ Skipped ${name} — set it later with: echo "VALUE" | ${wranglerCmd()} secret put ${name} --env ${wranglerEnv}`);
      continue;
    }

    promptCache.set(name, value);
    setWranglerSecret(name, value, wranglerEnv, { force: true });
  }
}

// ---------------------------------------------------------------------------
// R2 CORS
// ---------------------------------------------------------------------------

async function ensureR2CorsForCity(city, wranglerConfig, accountId, apiToken) {
  if (city.name === 'ottawa') return;

  const r2Binding = wranglerConfig.env?.['production']?.r2_buckets?.[0];
  const bucketName = r2Binding?.bucket_name;
  if (!bucketName) {
    console.warn('  ⚠ Cannot configure R2 CORS — no R2 bucket found in wrangler config');
    return;
  }

  await ensureR2Cors(bucketName, city.domain, accountId, apiToken);
}

// ---------------------------------------------------------------------------
// Stub Deploy
// ---------------------------------------------------------------------------

/**
 * Deploy a stub worker to create the Worker in Cloudflare.
 * Real builds and deploys are CI's job — the setup script just
 * ensures the Worker exists so secrets and domains can be attached.
 * Same pattern as create-bike-blog's setup.js.
 */
function deployStub(wranglerEnv) {
  // Check if the worker already exists by trying to list secrets
  try {
    run(`${wranglerCmd()} secret list --env ${wranglerEnv}`);
    logSkip(`Worker exists (${wranglerEnv})`);
    return;
  } catch {
    // Worker doesn't exist yet — deploy stub
  }

  logAction(`Deploying stub worker to create ${wranglerEnv}...`);

  const stubPath = resolve(ROOT, '.data', 'stub-worker.mjs');

  // Track which directories we create so we can clean up
  const created = [];
  const ensureDir = (dir) => {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
      created.push(dir);
    }
  };

  ensureDir(resolve(ROOT, '.data'));
  // Wrangler validates assets.directory exists. A previous build may have
  // left dist/server/wrangler.json which redirects config and expects
  // dist/client — create both to satisfy either path.
  ensureDir(resolve(ROOT, 'dist'));
  ensureDir(resolve(ROOT, 'dist', 'client'));

  writeFileSync(stubPath, 'export default { fetch() { return new Response("Setting up — check back soon!"); } };\n');

  try {
    safeExec(
      `${wranglerCmd()} deploy ${stubPath} --env ${wranglerEnv}`,
      { stdio: 'inherit', cwd: ROOT },
    );
    log(`Stub worker deployed (${wranglerEnv})`);
  } catch (err) {
    console.error(`  ✗ Stub deploy failed for ${wranglerEnv}`);
    throw err;
  } finally {
    rmSync(stubPath, { force: true });
    // Clean up directories we created (reverse order — children first)
    for (const dir of created.reverse()) {
      try { rmSync(dir, { recursive: true, force: true }); } catch { /* may have other contents */ }
    }
  }
}

// ---------------------------------------------------------------------------
// Custom Domain
// ---------------------------------------------------------------------------

async function ensureCustomDomain(city, accountId, apiToken) {
  if (city.name === 'ottawa') return;

  const workerName = `bike-${city.name}-production`;

  // Try to add custom domain via Cloudflare API
  if (accountId && apiToken) {
    try {
      // Check if domain is already attached
      const listRes = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/domains`,
        { headers: { 'Authorization': `Bearer ${apiToken}` } },
      );
      if (listRes.ok) {
        const listData = await listRes.json();
        const existing = listData.result?.find(d => d.hostname === city.domain);
        if (existing) {
          logSkip(`Custom domain: ${city.domain}`);
          return;
        }
      }

      // Attach domain
      const res = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/domains`,
        {
          method: 'PUT',
          headers: {
            'Authorization': `Bearer ${apiToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            hostname: city.domain,
            service: workerName,
            environment: 'production',
          }),
        },
      );

      if (res.ok) {
        log(`Custom domain: ${city.domain} → ${workerName}`);
        return;
      }

      const data = await res.json().catch(() => null);
      const errMsg = data?.errors?.[0]?.message || `HTTP ${res.status}`;
      console.warn(`  ⚠ Could not attach domain automatically: ${errMsg}`);
    } catch (err) {
      console.warn(`  ⚠ Custom domain API call failed: ${err.message}`);
    }
  }

  // Fallback: manual instructions
  console.log('');
  console.log(`  Manual step — custom domain for ${city.name}:`);
  console.log(`    1. Cloudflare dashboard → Workers & Pages → ${workerName} → Settings → Domains & Routes`);
  console.log(`    2. Add custom domain: ${city.domain}`);
  console.log(`    (The domain's zone must be on the same Cloudflare account)`);
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    contentDir: resolve(ROOT, '..', 'bike-routes'),
    city: null,
    dryRun: false,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--content-dir':
        opts.contentDir = resolve(args[++i]);
        break;
      case '--city':
        opts.city = args[++i];
        break;
      case '--dry-run':
        opts.dryRun = true;
        break;
      default:
        console.error(`Unknown argument: ${args[i]}`);
        console.error('Usage: node scripts/setup-city.js [--content-dir PATH] [--city NAME] [--dry-run]');
        process.exit(1);
    }
  }

  return opts;
}

async function main() {
  const opts = parseArgs();

  if (!existsSync(opts.contentDir)) {
    console.error(`Content directory not found: ${opts.contentDir}`);
    process.exit(1);
  }

  console.log(`\nCity setup (${opts.dryRun ? 'DRY RUN' : 'live'})\n`);

  // Preflight: verify Cloudflare access
  const accountId = getCloudflareAccountId();
  const apiToken = getCloudflareApiToken();
  if (!opts.dryRun && (!accountId || !apiToken)) {
    console.error('  ✗ Cloudflare credentials not detected.');
    console.error('    Make sure wrangler is logged in: wrangler login');
    process.exit(1);
  }
  if (accountId) log(`Cloudflare account: ${accountId}`);

  const cities = discoverCities(opts.contentDir);
  console.log(`  Discovered ${cities.length} cities: ${cities.map(c => c.name).join(', ')}\n`);

  const citiesToProcess = opts.city
    ? cities.filter(c => c.name === opts.city)
    : cities;

  if (opts.city && citiesToProcess.length === 0) {
    console.error(`City not found: ${opts.city}`);
    process.exit(1);
  }

  const wranglerConfig = readWranglerConfig();
  const originalWorkflow = readFileSync(WORKFLOW_PATH, 'utf8');
  const promptCache = new Map();
  let wranglerChanged = false;

  for (const city of citiesToProcess) {
    const wranglerEnv = city.name === 'ottawa' ? 'production' : `${city.name}-production`;

    console.log(`\n${'═'.repeat(50)}`);
    console.log(`  ${city.display_name} (${city.name})`);
    console.log(`  ${city.domain}`);
    console.log(`${'═'.repeat(50)}`);

    // Step 1: Config files
    console.log('\n  Config:\n');
    if (ensureWranglerEnv(wranglerConfig, city)) wranglerChanged = true;
    ensureCityInWorkflow(city.name);

    // Write wrangler config immediately — subsequent steps need the env to exist
    if (wranglerChanged) {
      writeWranglerConfig(wranglerConfig);
      wranglerChanged = false; // reset — already written
    }

    if (opts.dryRun) {
      console.log('\n  (dry run — skipping stub deploy, secrets, CORS, domain)\n');
      continue;
    }

    // Step 2: Stub deploy (creates Worker in Cloudflare if it doesn't exist)
    console.log('\n  Worker:\n');
    deployStub(wranglerEnv);

    // Step 3: Worker secrets
    await ensureSecrets(city, wranglerEnv, wranglerConfig, promptCache);

    // Step 4: R2 CORS
    console.log('\n  R2 CORS:\n');
    await ensureR2CorsForCity(city, wranglerConfig, accountId, apiToken);

    // Step 5: Custom domain
    console.log('\n  Domain:\n');
    await ensureCustomDomain(city, accountId, apiToken);

    // Done
    console.log(`\n  ✓ ${city.display_name} provisioned at https://${city.domain}`);
    console.log(`    Stub worker deployed — push to main to trigger CI build + real deploy.`);
    console.log(`    After CI deploys, visit https://${city.domain}/setup to create the first admin account.`);
  }

  // Restore workflow if dry run
  if (opts.dryRun) {
    writeFileSync(WORKFLOW_PATH, originalWorkflow);
    console.log('\n  Dry run complete. No changes made.\n');
  }

  console.log('');
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
