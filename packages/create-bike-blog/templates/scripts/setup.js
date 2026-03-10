import { execSync } from 'node:child_process';
import fs from 'node:fs';
import readline from 'node:readline';

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((resolve) => rl.question(q, resolve));

function run(cmd, opts = {}) {
  return execSync(cmd, { encoding: 'utf-8', stdio: opts.stdio || 'pipe', ...opts }).trim();
}

function commandExists(cmd) {
  try {
    execSync(`which ${cmd}`, { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

function readWranglerConfig() {
  const raw = fs.readFileSync('wrangler.jsonc', 'utf-8');
  const stripped = raw.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  return JSON.parse(stripped);
}

function hasResourceIds() {
  try {
    const config = readWranglerConfig();
    const db = config.d1_databases?.[0];
    return db?.database_id && db.database_id !== 'TODO';
  } catch {
    return false;
  }
}

function hasGitRemote() {
  try {
    run('git remote get-url origin');
    return true;
  } catch {
    return false;
  }
}

// --- Steps ---

async function stepCloudflare(folderName) {
  console.log('\n  Step 1/2: Cloudflare');
  console.log('  ────────────────────');

  if (hasResourceIds()) {
    console.log('  ✓ Resources already provisioned (wrangler.jsonc has IDs)\n');
    return;
  }

  if (!commandExists('wrangler')) {
    console.log('  ✗ wrangler not found\n');
    console.log('  You can install it with: npm i -g wrangler\n');
    console.log('  Or set up Cloudflare manually:');
    console.log(`    1. Create a D1 database named "${folderName}-db"`);
    console.log(`    2. Create an R2 bucket named "${folderName}-media"`);
    console.log(`    3. Create a KV namespace for TILE_CACHE`);
    console.log('    4. Add the resource IDs to wrangler.jsonc\n');

    const answer = await ask('  Continue without wrangler? [Y/n] ');
    if (answer.toLowerCase() === 'n') {
      console.log('\n  Install wrangler and run npm run setup again.\n');
      process.exit(0);
    }
    console.log('  ⚠ Skipping Cloudflare setup — complete it manually before deploying.\n');
    return;
  }

  // Check login
  try {
    const whoami = run('wrangler whoami');
    const accountMatch = whoami.match(/(\S+@\S+)/);
    console.log(`  ✓ wrangler found, logged in as ${accountMatch?.[1] || 'authenticated'}\n`);
  } catch {
    console.log('  ✗ wrangler not logged in\n');
    const answer = await ask('  Run wrangler login? [Y/n] ');
    if (answer.toLowerCase() === 'n') {
      console.log('\n  Log in with: wrangler login\n  Then run npm run setup again.\n');
      process.exit(0);
    }
    execSync('wrangler login', { stdio: 'inherit' });
    console.log();
  }

  console.log('  I\'ll deploy a placeholder worker to create your database,');
  console.log('  storage, and cache:\n');
  console.log('    wrangler deploy --x-provision\n');

  const answer = await ask('  Proceed? [Y/n] ');
  if (answer.toLowerCase() === 'n') {
    console.log('\n  Skipped. Run npm run setup again when ready.\n');
    return;
  }

  // Create stub worker and ensure dist/ exists (wrangler validates assets.directory)
  fs.mkdirSync('.data', { recursive: true });
  const stubPath = '.data/stub-worker.mjs';
  const distCreated = !fs.existsSync('dist');
  if (distCreated) fs.mkdirSync('dist', { recursive: true });
  fs.writeFileSync(stubPath, 'export default { fetch() { return new Response("Setting up — check back soon!"); } };\n');

  try {
    execSync(`wrangler deploy ${stubPath} --x-provision`, { stdio: 'inherit' });
    console.log('\n  ✓ Resources created, IDs written to wrangler.jsonc\n');
  } catch {
    console.error('\n  ✗ Deploy failed. Check the error above and try again.\n');
    process.exit(1);
  } finally {
    fs.rmSync(stubPath, { force: true });
    if (distCreated) fs.rmSync('dist', { recursive: true, force: true });
  }
}

async function stepGitHub(folderName) {
  console.log('\n  Step 2/2: GitHub');
  console.log('  ────────────────');

  if (!commandExists('gh')) {
    console.log('  ✗ gh not found\n');
    console.log('  You can install it from: https://cli.github.com\n');
    console.log('  Or set up GitHub manually:');
    console.log('    1. Create a repo at github.com');
    console.log('    2. git remote add origin <url>');
    console.log('    3. Add repo secrets in Settings → Secrets → Actions:');
    console.log('       - CLOUDFLARE_API_TOKEN: your Cloudflare API token');
    console.log('       - CLOUDFLARE_ACCOUNT_ID: your account ID\n');

    const answer = await ask('  Continue without gh? [Y/n] ');
    if (answer.toLowerCase() === 'n') {
      console.log('\n  Install gh and run npm run setup again.\n');
      process.exit(0);
    }
    console.log('  ⚠ Skipping GitHub setup — complete it manually.\n');
    return;
  }

  // Check login
  let ghUser;
  try {
    ghUser = run('gh auth status 2>&1').match(/Logged in to .* account (\S+)/)?.[1]
      || run('gh api user -q .login');
  } catch {
    console.log('  ✗ gh not logged in\n');
    const answer = await ask('  Run gh auth login? [Y/n] ');
    if (answer.toLowerCase() === 'n') {
      console.log('\n  Log in with: gh auth login\n  Then run npm run setup again.\n');
      process.exit(0);
    }
    execSync('gh auth login', { stdio: 'inherit' });
    ghUser = run('gh api user -q .login');
  }
  console.log(`  ✓ gh found, logged in as ${ghUser}\n`);

  // Collect what we need to do
  const needsRepo = !hasGitRemote();
  const repoName = `${ghUser}/${folderName}`;

  // Token
  console.log('  GitHub Actions needs a Cloudflare API token to deploy.\n');
  console.log('  Create one at:');
  console.log('    https://dash.cloudflare.com/profile/api-tokens\n');
  console.log('  Click "Create Token", then "Edit Cloudflare Workers" → "Use template".');
  console.log('  On the next screen:');
  console.log('    - Add permission: Account → D1 → Edit');
  console.log('    - Add permission: Account → Workers R2 Storage → Edit');
  console.log('    - Account Resources: pick your account');
  console.log('    - Zone Resources: "All zones" (or pick your domain)');
  console.log('  Click "Continue to summary" → "Create Token" → copy it.\n');

  const token = await ask('  Paste your token: ');
  if (!token.trim()) {
    console.log('\n  No token provided. Run npm run setup again when ready.\n');
    return;
  }

  // Get account ID
  let accountId;
  try {
    const whoami = run('wrangler whoami 2>/dev/null');
    accountId = whoami.match(/([a-f0-9]{32})/)?.[1];
  } catch { /* ignore */ }

  if (!accountId) {
    accountId = await ask('  Paste your Cloudflare Account ID: ');
  }

  // Show what we'll do
  console.log('\n  I\'ll run:\n');
  if (needsRepo) {
    console.log(`    gh repo create ${repoName} --private --source .`);
  }
  console.log('    gh secret set CLOUDFLARE_API_TOKEN');
  console.log(`    gh secret set CLOUDFLARE_ACCOUNT_ID (${accountId?.slice(0, 8)}...)`);
  console.log();

  const answer = await ask('  Proceed? [Y/n] ');
  if (answer.toLowerCase() === 'n') {
    console.log('\n  Skipped. Run npm run setup again when ready.\n');
    return;
  }

  if (needsRepo) {
    try {
      execSync(`gh repo create ${repoName} --private --source .`, { stdio: 'inherit' });
      console.log(`\n  ✓ Repo created: github.com/${repoName}`);
    } catch {
      console.error('\n  ✗ Repo creation failed. Create it manually and run setup again.\n');
      return;
    }
  }

  // Set secrets
  try {
    const secretInput = (name, value) => {
      execSync(`gh secret set ${name}`, {
        input: value,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    };
    secretInput('CLOUDFLARE_API_TOKEN', token.trim());
    secretInput('CLOUDFLARE_ACCOUNT_ID', accountId.trim());
    console.log('  ✓ Secrets configured\n');
  } catch {
    console.error('\n  ✗ Failed to set secrets. Set them manually in repo Settings → Secrets.\n');
  }
}

// --- Main ---

async function main() {
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf-8'));
  const folderName = pkg.name;

  console.log(`\n  Setting up ${folderName} for deployment.`);

  await stepCloudflare(folderName);
  await stepGitHub(folderName);

  // Offer to commit and push
  let remoteUrl;
  try {
    remoteUrl = run('git remote get-url origin');
  } catch { /* no remote */ }

  if (remoteUrl) {
    console.log('  ──────────────────────');
    const deploy = await ask('  Commit and push to trigger first deploy? [Y/n] ');
    if (deploy.toLowerCase() !== 'n') {
      execSync('git add wrangler.jsonc', { stdio: 'pipe' });
      try {
        execSync('git commit -m "setup complete"', { stdio: 'pipe' });
      } catch {
        // nothing to commit — that's fine
      }
      execSync('git push -u origin main', { stdio: 'inherit' });

      const actionsUrl = remoteUrl
        .replace(/\.git$/, '')
        .replace('git@github.com:', 'https://github.com/')
        + '/actions';
      console.log(`\n  ✓ Pushed! Watch your first deploy at:\n\n    ${actionsUrl}\n`);
    } else {
      console.log('\n  When you\'re ready:\n');
      console.log('    git add wrangler.jsonc && git commit -m "setup complete" && git push -u origin main\n');
    }
  } else {
    console.log('  ──────────────────────');
    console.log('  All done! Commit and push to deploy:\n');
    console.log('    git add wrangler.jsonc && git commit -m "setup complete" && git push -u origin main\n');
  }

  // TODO: offer to configure custom domain on Cloudflare

  rl.close();
}

main().catch((err) => {
  console.error('  Error:', err.message);
  process.exit(1);
});
