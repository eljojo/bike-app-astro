#!/usr/bin/env node

/**
 * Idempotent setup script for the video pipeline infrastructure.
 *
 * Like Ansible or Terraform — runs from a machine with root AWS + Cloudflare
 * credentials and configures everything automatically. No interactive prompts.
 *
 * Two phases:
 *   1. (default)            — S3 buckets, IAM roles, Lambda, EventBridge, CI user
 *   2. configure-instance   — per-instance CORS, webhook, IAM users, Sippy, secrets
 *
 * IAM users are created with least-privilege policies:
 *   - whereto-presign-{prefix}  — S3 PutObject on originals bucket (per-prefix)
 *   - whereto-sippy             — S3 GetObject on outputs bucket (shared)
 *   - whereto-ci-deploy         — Lambda deploy only (shared)
 *
 * Keys are rotated on every run for security.
 *
 * Usage:
 *   node scripts/setup-aws-video.js --region us-east-1 \
 *     --originals-bucket bike-video-originals \
 *     --outputs-bucket bike-video-outputs \
 *     --lambda-name video-agent \
 *     --gh-repo owner/repo
 *
 *   node scripts/setup-aws-video.js configure-instance \
 *     --prefix ottawa --domain ottawabybike.ca \
 *     --wrangler-env production
 */

import { execSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';

function exitOnSigint() {
  console.log('');
  process.exit(130);
}

const __dirname = dirname(fileURLToPath(import.meta.url));

// --- Helpers ---

function run(cmd, opts = {}) {
  try {
    return execSync(cmd, opts);
  } catch (err) {
    if (err.signal === 'SIGINT' || err.status === 130) {
      exitOnSigint();
    }
    throw err;
  }
}

function aws(cmd, { silent = false, allowFailure = false } = {}) {
  try {
    const result = run(`aws ${cmd}`, {
      encoding: 'utf-8',
      stdio: silent ? ['pipe', 'pipe', 'pipe'] : ['pipe', 'pipe', 'inherit'],
    });
    return result.trim();
  } catch (err) {
    if (allowFailure) return null;
    throw err;
  }
}

function awsJson(cmd) {
  const result = aws(cmd, { silent: true });
  return result ? JSON.parse(result) : null;
}

function awsExists(cmd) {
  return aws(cmd, { silent: true, allowFailure: true }) !== null;
}

function log(msg) { console.log(`  ✓ ${msg}`); }
function logSkip(msg) { console.log(`  · ${msg} (already exists)`); }
function logAction(msg) { console.log(`  → ${msg}`); }

// --- Auto-Detection ---

function getAwsAccountId() {
  const identity = awsJson('sts get-caller-identity');
  return identity?.Account;
}

function getCloudflareAccountId() {
  if (process.env.CLOUDFLARE_ACCOUNT_ID) return process.env.CLOUDFLARE_ACCOUNT_ID;

  try {
    const output = run('npx wrangler whoami 2>&1', { encoding: 'utf-8', stdio: 'pipe' });
    // Account ID is a 32-char hex string in the table output
    const match = output.match(/\b([0-9a-f]{32})\b/);
    if (match) return match[1];
  } catch { /* wrangler not authenticated */ }

  return null;
}

function getCloudflareApiToken() {
  if (process.env.CLOUDFLARE_API_TOKEN) return process.env.CLOUDFLARE_API_TOKEN;

  // Same approach as the blog setup script — wrangler auth token prints the token directly
  try {
    const output = run('npx wrangler auth token 2>/dev/null', { encoding: 'utf-8', stdio: 'pipe' });
    // Output may include a banner line — grab the last non-empty line
    const token = output.split('\n').pop().trim();
    if (token) return token;
  } catch { /* wrangler not authenticated */ }

  return null;
}

// --- IAM User Management ---

/** Create IAM user and attach inline policy. Does NOT touch keys. */
function ensureIamUserAndPolicy(userName, policyName, policyDocument) {
  if (!awsExists(`iam get-user --user-name ${userName}`)) {
    aws(`iam create-user --user-name ${userName}`);
    log(`Created IAM user: ${userName}`);
  } else {
    logSkip(`IAM user: ${userName}`);
  }

  // Always update policy to ensure latest permissions
  aws(`iam put-user-policy --user-name ${userName} --policy-name ${policyName} --policy-document '${JSON.stringify(policyDocument)}'`);
}

/**
 * Zero-downtime key rotation using AWS's 2-key support.
 *
 * 1. Create new key (old key still active — no downtime window)
 * 2. Return { creds, cleanup }
 * 3. Caller updates all consumers with new creds
 * 4. Caller calls cleanup() to delete old key(s)
 *
 * If already at the 2-key limit, deletes the oldest first.
 */
function rotateKeys(userName) {
  const existing = awsJson(`iam list-access-keys --user-name ${userName}`);
  const oldKeys = existing?.AccessKeyMetadata || [];

  // AWS max is 2 keys — if at limit, delete oldest to make room
  if (oldKeys.length >= 2) {
    oldKeys.sort((a, b) => new Date(a.CreateDate) - new Date(b.CreateDate));
    aws(`iam delete-access-key --user-name ${userName} --access-key-id ${oldKeys[0].AccessKeyId}`);
    logAction(`Deleted oldest key for ${userName} (was at 2-key limit)`);
    oldKeys.shift();
  }

  // Create new key while old key remains active
  const newKey = awsJson(`iam create-access-key --user-name ${userName}`);
  log(`Created new access key for ${userName}`);

  const creds = {
    accessKeyId: newKey.AccessKey.AccessKeyId,
    secretAccessKey: newKey.AccessKey.SecretAccessKey,
  };

  // Caller invokes after updating all consumers
  const oldKeyIds = oldKeys.map(k => k.AccessKeyId);
  function cleanup() {
    for (const keyId of oldKeyIds) {
      aws(`iam delete-access-key --user-name ${userName} --access-key-id ${keyId}`);
    }
    if (oldKeyIds.length > 0) {
      log(`Deleted old key(s) for ${userName}`);
    }
  }

  return { creds, cleanup };
}

/** Per-prefix user for S3 presigned uploads. Scoped to prefix path in originals bucket. */
function ensurePresignUser(prefix, originsBucket) {
  const userName = `whereto-presign-${prefix}`;
  ensureIamUserAndPolicy(userName, 'presign-s3-upload', {
    Version: '2012-10-17',
    Statement: [{
      Effect: 'Allow',
      Action: ['s3:PutObject'],
      Resource: `arn:aws:s3:::${originsBucket}/${prefix}/*`,
    }],
  });
  return userName;
}

/** Shared user for R2 Sippy to read transcoded outputs from S3. */
function ensureSippyUser(outputsBucket) {
  const userName = 'whereto-sippy';
  ensureIamUserAndPolicy(userName, 'sippy-s3-read', {
    Version: '2012-10-17',
    Statement: [
      {
        Effect: 'Allow',
        Action: ['s3:GetObject'],
        Resource: `arn:aws:s3:::${outputsBucket}/*`,
      },
      {
        Effect: 'Allow',
        Action: ['s3:ListBucket'],
        Resource: `arn:aws:s3:::${outputsBucket}`,
      },
    ],
  });
  return userName;
}

/** Shared user for GitHub Actions to deploy Lambda code. */
function ensureCiUser(lambdaName, region, accountId) {
  const userName = 'whereto-ci-deploy';
  ensureIamUserAndPolicy(userName, 'ci-lambda-deploy', {
    Version: '2012-10-17',
    Statement: [{
      Effect: 'Allow',
      Action: [
        'lambda:UpdateFunctionCode',
        'lambda:GetFunction',
        'lambda:PublishVersion',
      ],
      Resource: `arn:aws:lambda:${region}:${accountId}:function:${lambdaName}`,
    }],
  });
  return userName;
}

// --- Shared Resources ---

function ensureBucket(name, region) {
  if (awsExists(`s3api head-bucket --bucket ${name}`)) {
    logSkip(`S3 bucket: ${name}`);
    return;
  }
  const locationConstraint = region === 'us-east-1'
    ? ''
    : `--create-bucket-configuration LocationConstraint=${region}`;
  aws(`s3api create-bucket --bucket ${name} --region ${region} ${locationConstraint}`);
  log(`Created S3 bucket: ${name}`);
}

function ensureMediaConvertRole(region) {
  const roleName = 'MediaConvert_Default_Role';
  if (awsExists(`iam get-role --role-name ${roleName}`)) {
    logSkip(`IAM role: ${roleName}`);
    return roleName;
  }

  const trustPolicy = JSON.stringify({
    Version: '2012-10-17',
    Statement: [{
      Effect: 'Allow',
      Principal: { Service: 'mediaconvert.amazonaws.com' },
      Action: 'sts:AssumeRole',
    }],
  });

  aws(`iam create-role --role-name ${roleName} --assume-role-policy-document '${trustPolicy}'`);
  aws(`iam attach-role-policy --role-name ${roleName} --policy-arn arn:aws:iam::aws:policy/AmazonS3FullAccess`);
  log(`Created IAM role: ${roleName}`);
  return roleName;
}

function ensureLambdaRole() {
  const roleName = 'video-agent-lambda-role';
  if (awsExists(`iam get-role --role-name ${roleName}`)) {
    logSkip(`IAM role: ${roleName}`);
    const role = awsJson(`iam get-role --role-name ${roleName}`);
    return role.Role.Arn;
  }

  const trustPolicy = JSON.stringify({
    Version: '2012-10-17',
    Statement: [{
      Effect: 'Allow',
      Principal: { Service: 'lambda.amazonaws.com' },
      Action: 'sts:AssumeRole',
    }],
  });

  aws(`iam create-role --role-name ${roleName} --assume-role-policy-document '${trustPolicy}'`);
  aws(`iam attach-role-policy --role-name ${roleName} --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole`);

  const inlinePolicy = JSON.stringify({
    Version: '2012-10-17',
    Statement: [
      {
        Effect: 'Allow',
        Action: ['s3:GetObject', 's3:PutObject'],
        Resource: 'arn:aws:s3:::*',
      },
      {
        Effect: 'Allow',
        Action: ['mediaconvert:CreateJob', 'mediaconvert:DescribeEndpoints'],
        Resource: '*',
      },
    ],
  });
  aws(`iam put-role-policy --role-name ${roleName} --policy-name video-agent-policy --policy-document '${inlinePolicy}'`);

  log(`Created IAM role: ${roleName}`);
  console.log('    Waiting 10s for IAM role propagation...');
  run('sleep 10');

  const role = awsJson(`iam get-role --role-name ${roleName}`);
  return role.Role.Arn;
}

function ensureFfprobeLayer(region) {
  const layerName = 'ffprobe';

  const existing = aws(`lambda list-layer-versions --layer-name ${layerName} --max-items 1`, { silent: true, allowFailure: true });
  if (existing) {
    const parsed = JSON.parse(existing);
    if (parsed.LayerVersions && parsed.LayerVersions.length > 0) {
      const arn = parsed.LayerVersions[0].LayerVersionArn;
      logSkip(`ffprobe layer: ${arn}`);
      return arn;
    }
  }

  logAction('Publishing ffprobe Lambda layer (downloading static binary)...');

  const tmpDir = run('mktemp -d', { encoding: 'utf-8' }).trim();
  run(`mkdir -p ${tmpDir}/bin`);

  run(
    `curl -sL https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz | tar xJ -C ${tmpDir}/bin --strip-components=1 --wildcards '*/ffprobe'`,
    { stdio: 'pipe' },
  );
  run(`cd ${tmpDir} && zip -r layer.zip bin/`, { stdio: 'pipe' });

  const result = aws(
    `lambda publish-layer-version --layer-name ${layerName} --zip-file fileb://${tmpDir}/layer.zip --compatible-runtimes nodejs22.x --region ${region}`,
    { silent: true },
  );
  const parsed = JSON.parse(result);
  run(`rm -rf ${tmpDir}`);

  log(`Published ffprobe layer: ${parsed.LayerVersionArn}`);
  return parsed.LayerVersionArn;
}

function ensureLambda(name, roleArn, config) {
  const { region, originsBucket, outputsBucket, mediaConvertQueue, mediaConvertRole } = config;

  if (awsExists(`lambda get-function --function-name ${name}`)) {
    logSkip(`Lambda function: ${name}`);
    const lambdaDir = resolve(__dirname, '..', 'aws', 'video-agent');
    run('npm ci --production', { cwd: lambdaDir, stdio: 'pipe' });
    run('zip -r function.zip handler.mjs package.json node_modules/', { cwd: lambdaDir, stdio: 'pipe' });
    aws(`lambda update-function-code --function-name ${name} --zip-file fileb://${lambdaDir}/function.zip --publish`, { silent: true });
    log(`Updated Lambda code: ${name}`);
    return;
  }

  const lambdaDir = resolve(__dirname, '..', 'aws', 'video-agent');
  run('npm ci --production', { cwd: lambdaDir, stdio: 'pipe' });
  run('zip -r function.zip handler.mjs package.json node_modules/', { cwd: lambdaDir, stdio: 'pipe' });

  const layerArn = ensureFfprobeLayer(region);
  const layerArg = `--layers ${layerArn}`;

  const envVars = JSON.stringify({
    Variables: {
      S3_ORIGINALS_BUCKET: originsBucket,
      S3_OUTPUTS_BUCKET: outputsBucket,
      MEDIACONVERT_QUEUE: mediaConvertQueue || '',
      MEDIACONVERT_ROLE: mediaConvertRole || '',
      WEBHOOK_MAP: '{}',
      WEBHOOK_SECRET: '',
    },
  });

  aws([
    `lambda create-function --function-name ${name}`,
    `--runtime nodejs22.x --handler handler.handler`,
    `--role ${roleArn}`,
    `--zip-file fileb://${lambdaDir}/function.zip`,
    `--timeout 60 --memory-size 512`,
    `--environment '${envVars}'`,
    layerArg,
  ].filter(Boolean).join(' '));

  log(`Created Lambda function: ${name}`);
}

function ensureEventBridgeRule(lambdaName, region) {
  const ruleName = 'video-agent-mediaconvert-completion';

  if (awsExists(`events describe-rule --name ${ruleName}`)) {
    logSkip(`EventBridge rule: ${ruleName}`);
    return;
  }

  const pattern = JSON.stringify({
    source: ['aws.mediaconvert'],
    'detail-type': ['MediaConvert Job State Change'],
    detail: { status: ['COMPLETE', 'ERROR'] },
  });

  aws(`events put-rule --name ${ruleName} --event-pattern '${pattern}' --state ENABLED`);

  const fnInfo = awsJson(`lambda get-function --function-name ${lambdaName}`);
  const lambdaArn = fnInfo.Configuration.FunctionArn;

  const targets = JSON.stringify([{ Id: 'video-agent', Arn: lambdaArn }]);
  aws(`events put-targets --rule ${ruleName} --targets '${targets}'`);

  aws([
    `lambda add-permission --function-name ${lambdaName}`,
    `--statement-id eventbridge-mediaconvert`,
    `--action lambda:InvokeFunction`,
    `--principal events.amazonaws.com`,
    `--source-arn $(aws events describe-rule --name ${ruleName} --query 'Arn' --output text)`,
  ].join(' '), { allowFailure: true });

  log(`Created EventBridge rule: ${ruleName}`);
}

function ensureS3Trigger(lambdaName, originsBucket) {
  const existing = awsJson(`s3api get-bucket-notification-configuration --bucket ${originsBucket}`);
  const configs = existing?.LambdaFunctionConfigurations || [];
  if (configs.some(c => c.Id === 'video-agent-upload')) {
    logSkip(`S3 trigger on ${originsBucket}`);
    return;
  }

  const fnInfo = awsJson(`lambda get-function --function-name ${lambdaName}`);
  const lambdaArn = fnInfo.Configuration.FunctionArn;

  aws([
    `lambda add-permission --function-name ${lambdaName}`,
    `--statement-id s3-upload-trigger`,
    `--action lambda:InvokeFunction`,
    `--principal s3.amazonaws.com`,
    `--source-arn arn:aws:s3:::${originsBucket}`,
  ].join(' '), { allowFailure: true });

  const newConfig = {
    ...existing,
    LambdaFunctionConfigurations: [
      ...configs,
      {
        Id: 'video-agent-upload',
        LambdaFunctionArn: lambdaArn,
        Events: ['s3:ObjectCreated:*'],
      },
    ],
  };

  aws(`s3api put-bucket-notification-configuration --bucket ${originsBucket} --notification-configuration '${JSON.stringify(newConfig)}'`);
  log(`Created S3 upload trigger on ${originsBucket}`);
}

// --- Per-Instance Configuration ---

function ensureBucketCors(bucket, domain) {
  let existing;
  try {
    existing = awsJson(`s3api get-bucket-cors --bucket ${bucket}`);
  } catch {
    // No CORS config yet — start fresh
    existing = null;
  }
  const rules = existing?.CORSRules || [];

  const origin = `https://${domain}`;
  const hasOrigin = rules.some(r => r.AllowedOrigins?.includes(origin));
  if (hasOrigin) {
    logSkip(`CORS for ${domain} on ${bucket}`);
    return;
  }

  if (rules.length === 0) {
    rules.push({
      AllowedHeaders: ['*'],
      AllowedMethods: ['PUT'],
      AllowedOrigins: [origin],
      MaxAgeSeconds: 3600,
    });
  } else {
    rules[0].AllowedOrigins = [...(rules[0].AllowedOrigins || []), origin];
  }

  aws(`s3api put-bucket-cors --bucket ${bucket} --cors-configuration '${JSON.stringify({ CORSRules: rules })}'`);
  log(`Added CORS origin ${origin} to ${bucket}`);
}

function updateLambdaWebhookMap(lambdaName, prefix, domain) {
  const fnConfig = awsJson(`lambda get-function-configuration --function-name ${lambdaName}`);
  const envVars = fnConfig.Environment?.Variables || {};

  let webhookMap = {};
  try { webhookMap = JSON.parse(envVars.WEBHOOK_MAP || '{}'); } catch { /* empty */ }

  const url = `https://${domain}/api/video/webhook`;
  if (webhookMap[prefix] === url) {
    logSkip(`Webhook map entry: ${prefix} → ${url}`);
    return;
  }

  webhookMap[prefix] = url;
  envVars.WEBHOOK_MAP = JSON.stringify(webhookMap);

  aws(`lambda update-function-configuration --function-name ${lambdaName} --environment '${JSON.stringify({ Variables: envVars })}'`, { silent: true });
  log(`Updated webhook map: ${prefix} → ${url}`);
}

function ensureWebhookSecret(lambdaName, wranglerEnv) {
  const fnConfig = awsJson(`lambda get-function-configuration --function-name ${lambdaName}`);
  const envVars = fnConfig.Environment?.Variables || {};

  if (envVars.WEBHOOK_SECRET) {
    logSkip('WEBHOOK_SECRET already set');
    return;
  }

  const secret = randomBytes(32).toString('hex');
  envVars.WEBHOOK_SECRET = secret;

  aws(`lambda update-function-configuration --function-name ${lambdaName} --environment '${JSON.stringify({ Variables: envVars })}'`, { silent: true });
  log('Generated WEBHOOK_SECRET on Lambda');

  try {
    const envArg = wranglerEnv ? `--env ${wranglerEnv}` : '';
    run(`echo "${secret}" | npx wrangler secret put WEBHOOK_SECRET ${envArg}`, {
      stdio: 'pipe',
      encoding: 'utf-8',
    });
    log(`Set WEBHOOK_SECRET on Worker (${wranglerEnv || 'default'})`);
  } catch (err) {
    console.warn(`  ⚠ Could not set WEBHOOK_SECRET on Worker: ${err.message}`);
    console.warn(`    Run manually: echo "${secret}" | npx wrangler secret put WEBHOOK_SECRET${wranglerEnv ? ` --env ${wranglerEnv}` : ''}`);
  }
}

function ensureR2Bucket(bucketName) {
  try {
    const list = run('npx wrangler r2 bucket list', { encoding: 'utf-8', stdio: 'pipe' });
    if (list.includes(bucketName)) {
      logSkip(`R2 bucket: ${bucketName}`);
      return;
    }
  } catch { /* can't list */ }

  try {
    run(`npx wrangler r2 bucket create ${bucketName}`, { stdio: 'pipe' });
    log(`Created R2 bucket: ${bucketName}`);
  } catch (err) {
    console.warn(`  ⚠ Could not create R2 bucket: ${err.message}`);
    console.warn(`    Create manually in Cloudflare dashboard: ${bucketName}`);
  }
}

function configureSippy(r2BucketName, outputsBucket, region, accountId, apiToken, awsCreds) {
  if (!accountId) {
    console.error('  ✗ Cannot configure Sippy — Cloudflare account ID not detected');
    console.error('    Set CLOUDFLARE_ACCOUNT_ID or authenticate wrangler (npx wrangler login)');
    process.exit(1);
  }

  if (!apiToken) {
    console.error('  ✗ Cannot configure Sippy — Cloudflare API token not detected');
    console.error('    Set CLOUDFLARE_API_TOKEN or authenticate wrangler (npx wrangler login)');
    process.exit(1);
  }

  logAction(`Configuring Sippy: R2 ${r2BucketName} ← S3 ${outputsBucket}`);

  try {
    const body = JSON.stringify({
      source: {
        provider: 's3',
        region,
        bucket: outputsBucket,
        accessKeyId: awsCreds.accessKeyId,
        secretAccessKey: awsCreds.secretAccessKey,
      },
    });

    run(
      `curl -sf -X PUT "https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets/${r2BucketName}/sippy" -H "Authorization: Bearer ${apiToken}" -H "Content-Type: application/json" -d '${body}'`,
      { stdio: 'pipe' },
    );
    log(`Configured Sippy on R2 bucket: ${r2BucketName}`);
  } catch (err) {
    console.warn(`  ⚠ Sippy configuration failed: ${err.message}`);
    console.warn('    Configure manually: Cloudflare dashboard → R2 → bucket → Settings → Sippy');
    console.warn(`    Source: S3 bucket "${outputsBucket}" in ${region}`);
  }
}

function setWranglerSecret(name, value, wranglerEnv, { force = false } = {}) {
  const envArg = wranglerEnv ? `--env ${wranglerEnv}` : '';

  if (!force) {
    try {
      const list = run(`npx wrangler secret list ${envArg}`, { encoding: 'utf-8', stdio: 'pipe' });
      if (list.includes(name)) {
        logSkip(`Wrangler secret: ${name}`);
        return;
      }
    } catch { /* can't list */ }
  }

  try {
    run(`echo "${value}" | npx wrangler secret put ${name} ${envArg}`, {
      stdio: 'pipe',
      encoding: 'utf-8',
    });
    log(`Set ${name} on Worker (${wranglerEnv || 'default'})`);
  } catch (err) {
    console.warn(`  ⚠ Could not set ${name}: ${err.message}`);
    console.warn(`    Run manually: echo "VALUE" | npx wrangler secret put ${name} ${envArg}`);
  }
}

// --- GitHub Actions CI ---

function secretInput(repo, name, value) {
  run(`gh secret set ${name} --repo ${repo}`, {
    input: value,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

function storeGitHubSecrets(repo, creds) {
  try {
    run('gh --version', { stdio: 'pipe' });
  } catch {
    console.warn('  ⚠ gh CLI not found — set GitHub secrets manually:');
    console.warn(`    gh secret set AWS_ACCESS_KEY_ID --repo ${repo}`);
    console.warn(`    gh secret set AWS_SECRET_ACCESS_KEY --repo ${repo}`);
    return;
  }

  try {
    secretInput(repo, 'AWS_ACCESS_KEY_ID', creds.accessKeyId);
    log(`Set AWS_ACCESS_KEY_ID on ${repo}`);
  } catch (err) {
    console.warn(`  ⚠ Failed to set AWS_ACCESS_KEY_ID: ${err.message}`);
  }

  try {
    secretInput(repo, 'AWS_SECRET_ACCESS_KEY', creds.secretAccessKey);
    log(`Set AWS_SECRET_ACCESS_KEY on ${repo}`);
  } catch (err) {
    console.warn(`  ⚠ Failed to set AWS_SECRET_ACCESS_KEY: ${err.message}`);
  }
}

// --- CLI ---

function parseArgs(args) {
  const opts = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      opts[key] = args[i + 1] || true;
      if (typeof opts[key] === 'string') i++;
    } else {
      opts._command = args[i];
    }
  }
  return opts;
}

const args = parseArgs(process.argv.slice(2));

function main() {
  if (args._command === 'configure-instance') {
    const { prefix, domain, wranglerEnv, lambdaName = 'video-agent', originsBucket, outputsBucket, region = 'us-east-1', r2Bucket = 'whereto-bike-videos' } = args;
    if (!prefix || !domain) {
      console.error('Usage: setup-aws-video.js configure-instance --prefix <city> --domain <domain> [--wrangler-env <env>] [--r2-bucket <name>]');
      process.exit(1);
    }

    const bucket = originsBucket || 'bike-video-originals';
    const outputs = outputsBucket || 'bike-video-outputs';

    console.log(`\nConfiguring instance: ${prefix} (${domain})\n`);

    // --- Preflight: verify Cloudflare access before touching keys ---
    const cfAccountId = getCloudflareAccountId();
    const cfApiToken = getCloudflareApiToken();
    if (!cfAccountId || !cfApiToken) {
      console.error('  ✗ Cloudflare credentials not detected — aborting before any key rotation');
      console.error('    Set CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN, or run: npx wrangler login');
      process.exit(1);
    }
    log(`Cloudflare account: ${cfAccountId}`);

    // --- AWS-side ---
    console.log('\n  AWS:\n');
    ensureBucketCors(bucket, domain);
    updateLambdaWebhookMap(lambdaName, prefix, domain);
    ensureWebhookSecret(lambdaName, wranglerEnv);

    // --- IAM users (create/update policy, then rotate keys) ---
    console.log('\n  IAM users:\n');
    const presignUserName = ensurePresignUser(prefix, bucket);
    const sippyUserName = ensureSippyUser(outputs);

    // Rotate keys — old keys stay active until consumers are updated
    const presign = rotateKeys(presignUserName);
    const sippy = rotateKeys(sippyUserName);

    // --- Cloudflare-side (update Sippy with new sippy key) ---
    console.log('\n  Cloudflare:\n');
    ensureR2Bucket(r2Bucket);
    configureSippy(r2Bucket, outputs, region, cfAccountId, cfApiToken, sippy.creds);
    sippy.cleanup(); // old sippy key no longer needed

    // --- Wrangler secrets (update presign creds on Worker) ---
    console.log('\n  Wrangler secrets:\n');
    setWranglerSecret('MEDIACONVERT_ACCESS_KEY_ID', presign.creds.accessKeyId, wranglerEnv, { force: true });
    setWranglerSecret('MEDIACONVERT_SECRET_ACCESS_KEY', presign.creds.secretAccessKey, wranglerEnv, { force: true });
    setWranglerSecret('S3_ORIGINALS_BUCKET', bucket, wranglerEnv);
    setWranglerSecret('VIDEO_PREFIX', prefix, wranglerEnv);
    presign.cleanup(); // old presign key no longer needed

    // --- Summary ---
    console.log('\n  Done.\n');
    console.log('  Remaining manual steps:');
    console.log(`    1. Set custom domain on R2 bucket "${r2Bucket}": videos.whereto.bike`);
    console.log(`       Cloudflare dashboard → R2 → ${r2Bucket} → Settings → Custom Domains`);
    console.log(`    2. Verify VIDEO_PREFIX in wrangler.jsonc vars matches: "${prefix}"`);
    console.log(`    3. Set VIDEO_PREFIX=${prefix} in CI env vars for the build step`);
    console.log(`    4. Deploy: make deploy`);
    console.log('');
  } else {
    // --- Shared resources setup ---
    const region = args.region || 'us-east-1';
    const originsBucket = args.originalsBucket || 'bike-video-originals';
    const outputsBucket = args.outputsBucket || 'bike-video-outputs';
    const lambdaName = args.lambdaName || 'video-agent';

    console.log(`\nSetting up shared video pipeline resources (${region})\n`);

    const awsAccountId = getAwsAccountId();
    if (!awsAccountId) {
      console.error('  ✗ Could not detect AWS account ID. Is AWS CLI configured?');
      process.exit(1);
    }

    ensureBucket(originsBucket, region);
    ensureBucket(outputsBucket, region);

    const mcRole = ensureMediaConvertRole(region);
    const lambdaRoleArn = ensureLambdaRole();

    let mcQueue = '';
    try {
      awsJson(`mediaconvert describe-endpoints --region ${region}`);
      mcQueue = `arn:aws:mediaconvert:${region}:${awsAccountId}:queues/Default`;
    } catch {
      console.warn('  ⚠ Could not determine MediaConvert queue ARN');
    }

    ensureLambda(lambdaName, lambdaRoleArn, {
      region,
      originsBucket,
      outputsBucket,
      mediaConvertQueue: mcQueue,
      mediaConvertRole: `arn:aws:iam::${awsAccountId}:role/${mcRole}`,
    });

    ensureEventBridgeRule(lambdaName, region);
    ensureS3Trigger(lambdaName, originsBucket);

    // --- CI deployment user ---
    // Verify GitHub access BEFORE rotating keys (P2 fix: don't invalidate old keys
    // if we can't store the new ones)
    let ghRepo = args.ghRepo;
    if (!ghRepo) {
      try {
        const remote = run('git remote get-url origin', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
        const match = remote.match(/github\.com[:/](.+?)(?:\.git)?$/);
        if (match) ghRepo = match[1];
      } catch { /* not a git repo or no remote */ }
    }

    let hasGhCli = false;
    try {
      run('gh --version', { stdio: 'pipe' });
      hasGhCli = true;
    } catch { /* gh not available */ }

    console.log('\n  CI deployment IAM user:\n');
    const ciUserName = ensureCiUser(lambdaName, region, awsAccountId);

    if (ghRepo && hasGhCli) {
      const ci = rotateKeys(ciUserName);
      storeGitHubSecrets(ghRepo, ci.creds);
      ci.cleanup(); // old CI key no longer needed
    } else if (!ghRepo) {
      console.log('  ⚠ Could not detect GitHub repo — skipping CI key rotation');
      console.log('    Run with --gh-repo owner/repo to set up CI credentials');
    } else {
      console.log('  ⚠ gh CLI not found — skipping CI key rotation');
      console.log('    Install: https://cli.github.com/');
    }

    console.log('\nShared resources setup complete.\n');
  }
}

main();
