#!/usr/bin/env node

/**
 * Idempotent city setup script.
 *
 * Discovers cities from the data repo, ensures each has a wrangler.jsonc
 * environment and a CI workflow matrix entry. Safe to run repeatedly —
 * skips anything already configured.
 *
 * Usage (run inside nix develop):
 *   make setup-city
 *   make setup-city ARGS="--city santiago"
 *   make setup-city ARGS="--dry-run"
 *
 * Or directly:
 *   node scripts/setup-city.js [--content-dir PATH] [--city NAME] [--dry-run]
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { log, logSkip, logAction } from './setup-aws-video.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// --- City Discovery ---

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
      name: entry.name, // directory name is the canonical identifier
      domain: config.domain || `${entry.name}.whereto.bike`,
      display_name: config.display_name || config.name || entry.name,
    });
  }

  return cities.sort((a, b) => a.name.localeCompare(b.name));
}

// --- Wrangler Environment Management ---

function readWranglerConfig() {
  const raw = readFileSync(resolve(ROOT, 'wrangler.jsonc'), 'utf8');
  // Strip // line comments and /* */ block comments for JSON parsing
  const stripped = raw
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
  return JSON.parse(stripped);
}

function writeWranglerConfig(config) {
  const json = JSON.stringify(config, null, 2) + '\n';
  writeFileSync(resolve(ROOT, 'wrangler.jsonc'), json);
}

function ensureWranglerEnv(config, city) {
  const envKey = `${city.name}-production`;

  // Ottawa uses "production" directly — it's the template, not a city env
  if (city.name === 'ottawa') {
    logSkip(`wrangler env: ottawa uses "production" (template)`);
    return false;
  }

  if (config.env[envKey]) {
    logSkip(`wrangler env: ${envKey}`);
    return false;
  }

  // Clone the production (Ottawa) template
  const template = config.env['production'];
  const newEnv = JSON.parse(JSON.stringify(template));

  newEnv.name = `bike-${city.name}-production`;

  // Set city-specific vars, remove Ottawa-specific ones
  newEnv.vars = { ...newEnv.vars };
  newEnv.vars.STORAGE_KEY_PREFIX = `${city.name}/`;
  delete newEnv.vars.VIDEO_PREFIX;
  delete newEnv.vars.MEDIACONVERT_REGION;

  config.env[envKey] = newEnv;
  logAction(`wrangler env: added ${envKey}`);
  return true;
}

// --- CI Workflow Matrix Update ---

const WORKFLOW_PATH = resolve(ROOT, '.github/workflows/production.yml');

function ensureCityInWorkflow(cityName) {
  // Ottawa is always present, skip
  if (cityName === 'ottawa') {
    logSkip(`workflow: ottawa is always in CI`);
    return false;
  }

  let content = readFileSync(WORKFLOW_PATH, 'utf8');
  let changed = false;

  // 1. Update the "rebuild all" echo line (the one with multiple cities, not the single-city lines)
  const echoMatch = content.match(/(echo\s+'cities=\[)("(?:[^"]*)"(?:,"(?:[^"]*)")+)\]/);
  if (echoMatch) {
    const arrayStr = echoMatch[2]; // e.g. "ottawa","demo","brevet"
    const cities = arrayStr.split(',').map(s => s.replace(/"/g, ''));
    if (!cities.includes(cityName)) {
      cities.push(cityName);
      const newArrayStr = cities.map(c => `"${c}"`).join(',');
      const oldFull = echoMatch[0];
      const newFull = `${echoMatch[1]}${newArrayStr}]`;
      content = content.replace(oldFull, newFull);
      logAction(`workflow: added ${cityName} to rebuild-all echo`);
      changed = true;
    } else {
      logSkip(`workflow: ${cityName} in rebuild-all echo`);
    }
  }

  // 2. Update the matrix include array
  const matrixCityPattern = new RegExp(`^\\s+- city: ${cityName}$`, 'm');
  if (matrixCityPattern.test(content)) {
    logSkip(`workflow: ${cityName} in matrix include`);
  } else {
    // Insert before fail-fast line
    const failFastLine = '      fail-fast: false';
    const newEntry = [
      `          - city: ${cityName}`,
      `            wrangler-env: ${cityName}-production`,
      `            run-migrations: false`,
    ].join('\n');
    content = content.replace(failFastLine, newEntry + '\n' + failFastLine);
    logAction(`workflow: added ${cityName} to matrix include`);
    changed = true;
  }

  if (changed) {
    writeFileSync(WORKFLOW_PATH, content);
  }
  return changed;
}

// --- Summary ---

function printManualSteps(city) {
  if (city.name === 'ottawa') return;

  console.log('');
  console.log(`  Remaining manual steps for ${city.name}:`);
  console.log(`    1. DNS: CNAME ${city.domain} -> bike-${city.name}-production.{account}.workers.dev`);
  console.log(`    2. Custom domain: Cloudflare dashboard -> Workers -> bike-${city.name}-production -> Settings -> Domains`);
  console.log(`    3. First deploy: nix develop --command bash -c "CITY=${city.name} make build && npx wrangler deploy --env ${city.name}-production"`);
}

// --- CLI ---

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

  if (opts.dryRun) {
    console.log('\n  DRY RUN — no files will be written\n');
  }

  const cities = discoverCities(opts.contentDir);
  console.log(`  Discovered ${cities.length} cities: ${cities.map(c => c.name).join(', ')}`);

  const citiesToProcess = opts.city
    ? cities.filter(c => c.name === opts.city)
    : cities;

  if (opts.city && citiesToProcess.length === 0) {
    console.error(`City not found: ${opts.city}`);
    process.exit(1);
  }

  const config = readWranglerConfig();
  // Save original workflow content for dry-run restore
  const originalWorkflow = readFileSync(WORKFLOW_PATH, 'utf8');
  let wranglerChanged = false;
  let workflowChanged = false;

  for (const city of citiesToProcess) {
    console.log(`\n  ${city.display_name} (${city.name})`);
    console.log('  ' + '\u2500'.repeat(40));

    if (ensureWranglerEnv(config, city)) wranglerChanged = true;
    if (ensureCityInWorkflow(city.name)) workflowChanged = true;
    printManualSteps(city);
  }

  if (opts.dryRun) {
    // Restore workflow file if we modified it during dry run
    if (workflowChanged) {
      writeFileSync(WORKFLOW_PATH, originalWorkflow);
    }
    console.log('\n  Dry run complete. No files were modified.\n');
  } else {
    if (wranglerChanged) {
      writeWranglerConfig(config);
      log('wrote wrangler.jsonc');
    }
    // Workflow is written inline by ensureCityInWorkflow
    if (workflowChanged) {
      log('wrote .github/workflows/production.yml');
    }
    if (!wranglerChanged && !workflowChanged) {
      console.log('\n  Everything already configured. No changes needed.\n');
    } else {
      console.log('');
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
