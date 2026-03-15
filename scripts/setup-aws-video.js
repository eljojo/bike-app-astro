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
 * Usage (run inside nix develop):
 *   make setup-video
 *   make setup-video ARGS="configure-instance --prefix ottawa --domain ottawabybike.ca --wrangler-env production"
 *
 * Or directly:
 *   node scripts/setup-aws-video.js
 *   node scripts/setup-aws-video.js configure-instance \
 *     --prefix ottawa --domain ottawabybike.ca \
 *     --wrangler-env production
 */

import { execSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomBytes } from 'node:crypto';
import readline from 'node:readline';

function exitOnSigint() {
  console.log('');
  process.exit(130);
}

export function ask(q) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  return new Promise((resolve) => {
    let settled = false;

    const cleanup = () => {
      rl.removeListener('SIGINT', onSigint);
      rl.removeListener('close', onClose);
    };

    const finish = (value) => {
      if (settled) return;
      settled = true;
      cleanup();
      rl.close();
      resolve(value);
    };

    const onSigint = () => {
      cleanup();
      rl.close();
      exitOnSigint();
    };

    const onClose = () => {
      if (!settled) {
        settled = true;
        cleanup();
        process.exit(0);
      }
    };

    rl.once('SIGINT', onSigint);
    rl.once('close', onClose);
    rl.question(q, (answer) => finish(answer));
  });
}

const __dirname = dirname(fileURLToPath(import.meta.url));

// --- Helpers ---

export function safeExec(cmd, opts = {}) {
  try {
    return execSync(cmd, opts);
  } catch (err) {
    if (err.signal === 'SIGINT' || err.status === 130) {
      exitOnSigint();
    }
    throw err;
  }
}

export function run(cmd, opts = {}) {
  return safeExec(cmd, { encoding: 'utf-8', stdio: opts.stdio || 'pipe', ...opts }).trim();
}

export function aws(cmd, { silent = false, allowFailure = false } = {}) {
  try {
    return run(`aws --no-cli-pager ${cmd}`, {
      stdio: silent ? ['ignore', 'pipe', 'pipe'] : ['ignore', 'pipe', 'inherit'],
    });
  } catch (err) {
    if (allowFailure) return null;
    throw err;
  }
}

export function awsJson(cmd) {
  const result = aws(cmd, { silent: true });
  return result ? JSON.parse(result) : null;
}

export function awsExists(cmd) {
  return aws(cmd, { silent: true, allowFailure: true }) !== null;
}

export function log(msg) { console.log(`  ✓ ${msg}`); }
export function logSkip(msg) { console.log(`  · ${msg} (already exists)`); }
export function logAction(msg) { console.log(`  → ${msg}`); }

// --- Auto-Detection ---

export function getAwsAccountId() {
  const identity = awsJson('sts get-caller-identity');
  return identity?.Account;
}

export function commandExists(cmd) {
  try {
    safeExec(`which ${cmd}`, { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

export function wranglerCmd() {
  return commandExists('wrangler') ? 'wrangler' : 'npx wrangler';
}

export function getCloudflareAccountId() {
  if (process.env.CLOUDFLARE_ACCOUNT_ID) return process.env.CLOUDFLARE_ACCOUNT_ID;

  try {
    const output = run(`${wranglerCmd()} whoami 2>/dev/null`);
    const match = output.match(/([a-f0-9]{32})/);
    if (match) return match[1];
  } catch (err) {
    console.warn(`  ⚠ wrangler whoami failed: ${err.message}`);
  }

  return null;
}

export function getCloudflareApiToken() {
  if (process.env.CLOUDFLARE_API_TOKEN) return process.env.CLOUDFLARE_API_TOKEN;

  try {
    const output = run(`${wranglerCmd()} auth token 2>/dev/null`);
    // wrangler auth token may include a banner line — grab the last line
    const token = output.split('\n').pop().trim();
    if (token) return token;
  } catch (err) {
    console.warn(`  ⚠ wrangler auth token failed: ${err.message}`);
  }

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

  // Always update policy to ensure latest permissions — pass JSON via stdin to avoid shell quoting issues
  safeExec(`aws iam put-user-policy --user-name ${userName} --policy-name ${policyName} --policy-document file:///dev/stdin`, {
    input: JSON.stringify(policyDocument),
    stdio: ['pipe', 'pipe', 'inherit'],
    encoding: 'utf-8',
  });
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
export function rotateKeys(userName) {
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
export function ensurePresignUser(prefix, originsBucket) {
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

export function ensureBucket(name, region) {
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

function ensureMediaConvertRole(region, originsBucket, outputsBucket) {
  const roleName = 'MediaConvert_Default_Role';
  const trustPolicy = {
    Version: '2012-10-17',
    Statement: [{
      Effect: 'Allow',
      Principal: { Service: 'mediaconvert.amazonaws.com' },
      Action: 'sts:AssumeRole',
    }],
  };

  if (awsExists(`iam get-role --role-name ${roleName}`)) {
    logSkip(`IAM role: ${roleName}`);
  } else {
    safeExec(`aws iam create-role --role-name ${roleName} --assume-role-policy-document file:///dev/stdin`, {
      input: JSON.stringify(trustPolicy),
      stdio: ['pipe', 'pipe', 'inherit'],
      encoding: 'utf-8',
    });
    log(`Created IAM role: ${roleName}`);
  }

  // Always ensure trust policy is correct
  safeExec(`aws iam update-assume-role-policy --role-name ${roleName} --policy-document file:///dev/stdin`, {
    input: JSON.stringify(trustPolicy),
    stdio: ['pipe', 'pipe', 'inherit'],
    encoding: 'utf-8',
  });

  // Remove any attached managed policies (e.g. console-created ones like
  // MediaConvert_Default_Role_*) — we use a scoped inline policy instead
  const attached = awsJson(`iam list-attached-role-policies --role-name ${roleName}`);
  for (const policy of attached?.AttachedPolicies || []) {
    aws(`iam detach-role-policy --role-name ${roleName} --policy-arn ${policy.PolicyArn}`);
    logAction(`Detached broad policy: ${policy.PolicyName}`);
  }

  // Always ensure scoped S3 policy (full access but only to our buckets)
  const s3Policy = {
    Version: '2012-10-17',
    Statement: [
      {
        Effect: 'Allow',
        Action: 's3:*',
        Resource: [
          `arn:aws:s3:::${originsBucket}`,
          `arn:aws:s3:::${originsBucket}/*`,
          `arn:aws:s3:::${outputsBucket}`,
          `arn:aws:s3:::${outputsBucket}/*`,
        ],
      },
    ],
  };
  safeExec(`aws iam put-role-policy --role-name ${roleName} --policy-name mediaconvert-s3 --policy-document file:///dev/stdin`, {
    input: JSON.stringify(s3Policy),
    stdio: ['pipe', 'pipe', 'inherit'],
    encoding: 'utf-8',
  });

  // Return the actual ARN (may include /service-role/ path prefix)
  const role = awsJson(`iam get-role --role-name ${roleName}`);
  return role.Role.Arn;
}

function ensureLambdaRole(mcRoleArn, originsBucket, outputsBucket) {
  const roleName = 'video-agent-lambda-role';
  const exists = awsExists(`iam get-role --role-name ${roleName}`);

  if (!exists) {
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
    log(`Created IAM role: ${roleName}`);
  } else {
    logSkip(`IAM role: ${roleName}`);
  }

  // Always update inline policy to ensure latest permissions
  const inlinePolicy = {
    Version: '2012-10-17',
    Statement: [
      {
        Effect: 'Allow',
        Action: ['s3:GetObject', 's3:PutObject'],
        Resource: [`arn:aws:s3:::${originsBucket}/*`, `arn:aws:s3:::${outputsBucket}/*`],
      },
      {
        Effect: 'Allow',
        Action: ['mediaconvert:CreateJob', 'mediaconvert:DescribeEndpoints'],
        Resource: '*',
      },
      {
        Effect: 'Allow',
        Action: 'iam:PassRole',
        Resource: mcRoleArn,
      },
    ],
  };
  safeExec(`aws iam put-role-policy --role-name ${roleName} --policy-name video-agent-policy --policy-document file:///dev/stdin`, {
    input: JSON.stringify(inlinePolicy),
    stdio: ['pipe', 'pipe', 'inherit'],
    encoding: 'utf-8',
  });

  if (!exists) {
    console.log('    Waiting 10s for IAM role propagation...');
    run('sleep 10');
  }

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

export function ensureLambda(name, roleArn, config) {
  const { region, originsBucket, outputsBucket, mediaConvertQueue, mediaConvertRole } = config;

  if (awsExists(`lambda get-function --function-name ${name}`)) {
    logSkip(`Lambda function: ${name}`);
    const lambdaDir = resolve(__dirname, '..', 'aws', 'video-agent');
    run('npm ci --production', { cwd: lambdaDir, stdio: 'pipe' });
    run('zip -r function.zip handler.mjs package.json node_modules/', { cwd: lambdaDir, stdio: 'pipe' });
    aws(`lambda update-function-code --function-name ${name} --zip-file fileb://${lambdaDir}/function.zip --publish`, { silent: true });
    log(`Updated Lambda code: ${name}`);
    return false;
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
  return true;
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

export function updateLambdaWebhookMap(lambdaName, prefix, domain) {
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

  let secret = envVars.WEBHOOK_SECRET;
  if (secret) {
    logSkip('WEBHOOK_SECRET already set on Lambda');
  } else {
    secret = randomBytes(32).toString('hex');
    envVars.WEBHOOK_SECRET = secret;
    aws(`lambda update-function-configuration --function-name ${lambdaName} --environment '${JSON.stringify({ Variables: envVars })}'`, { silent: true });
    log('Generated WEBHOOK_SECRET on Lambda');
  }

  // Always propagate to the Worker env (each city/env needs the shared secret)
  try {
    const envArg = wranglerEnv ? `--env ${wranglerEnv}` : '';
    safeExec(`${wranglerCmd()} secret put WEBHOOK_SECRET ${envArg}`, {
      input: secret,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    log(`Set WEBHOOK_SECRET on Worker (${wranglerEnv || 'default'})`);
  } catch (err) {
    console.warn(`  ⚠ Could not set WEBHOOK_SECRET on Worker: ${err.message}`);
    console.warn(`    Run manually: echo "VALUE" | ${wranglerCmd()} secret put WEBHOOK_SECRET${wranglerEnv ? ` --env ${wranglerEnv}` : ''}`);
  }
}

export function ensureR2Bucket(bucketName) {
  try {
    const list = run(`${wranglerCmd()} r2 bucket list`);
    if (list.includes(bucketName)) {
      logSkip(`R2 bucket: ${bucketName}`);
      return;
    }
  } catch { /* can't list */ }

  try {
    run(`${wranglerCmd()} r2 bucket create ${bucketName}`);
    log(`Created R2 bucket: ${bucketName}`);
  } catch (err) {
    console.warn(`  ⚠ Could not create R2 bucket: ${err.message}`);
    console.warn(`    Create manually in Cloudflare dashboard: ${bucketName}`);
  }
}

export async function isSippyActive(r2BucketName, accountId, apiToken) {
  if (!accountId || !apiToken) return false;
  try {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets/${r2BucketName}/sippy`,
      { headers: { 'Authorization': `Bearer ${apiToken}` } },
    );
    if (!res.ok) return false;
    const data = await res.json();
    return !!data.result?.source;
  } catch {
    return false;
  }
}

export async function configureSippy(r2BucketName, outputsBucket, region, accountId, apiToken, awsCreds) {
  if (!accountId) {
    console.error('  ✗ Cannot configure Sippy — Cloudflare account ID not detected');
    console.error('    Set CLOUDFLARE_ACCOUNT_ID or run: wrangler login (inside nix develop)');
    process.exit(1);
  }

  if (!apiToken) {
    console.error('  ✗ Cannot configure Sippy — Cloudflare API token not detected');
    console.error('    Set CLOUDFLARE_API_TOKEN or run: wrangler login (inside nix develop)');
    process.exit(1);
  }

  // Sippy needs R2 API credentials to write to the destination bucket.
  // These are separate from the Cloudflare API token.
  console.log('  Sippy needs R2 API credentials (S3-compatible) to pull objects into R2.');
  console.log('  Create them at: Cloudflare dashboard → R2 → Manage R2 API Tokens');
  console.log('  The token needs Object Read & Write on the target bucket.\n');
  const r2KeyId = (await ask('  R2 Access Key ID (Enter to skip Sippy): ')).trim();
  if (!r2KeyId) {
    console.log('    → skipped. Configure Sippy manually in the dashboard.\n');
    return false;
  }
  const r2AccessKey = (await ask('  R2 Secret Access Key: ')).trim();
  if (!r2AccessKey) {
    console.log('    → skipped. Configure Sippy manually in the dashboard.\n');
    return false;
  }

  logAction(`Configuring Sippy: R2 ${r2BucketName} ← S3 ${outputsBucket}`);

  const body = {
    source: {
      provider: 'aws',
      bucket: outputsBucket,
      region,
      accessKeyId: awsCreds.accessKeyId,
      secretAccessKey: awsCreds.secretAccessKey,
    },
    destination: {
      provider: 'r2',
      accessKeyId: r2KeyId,
      secretAccessKey: r2AccessKey,
    },
  };

  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets/${r2BucketName}/sippy`,
    {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    },
  );

  const data = await res.json().catch(() => null);

  if (res.ok) {
    log(`Configured Sippy on R2 bucket: ${r2BucketName}`);
    return true;
  }

  const errors = data?.errors?.map(e => e.message).join(', ') || `HTTP ${res.status}`;
  console.warn(`  ⚠ Sippy configuration failed: ${errors}`);
  const redacted = {
    source: { ...body.source, secretAccessKey: '***' },
    destination: { ...body.destination, secretAccessKey: '***' },
  };
  console.warn(`    Request body: ${JSON.stringify(redacted)}`);
  console.warn(`    Response: ${JSON.stringify(data)}`);
  console.warn('    Configure manually: Cloudflare dashboard → R2 → bucket → Settings → Sippy');
  console.warn(`    Source: S3 bucket "${outputsBucket}" in ${region}`);
  return false;
}

export function setWranglerSecret(name, value, wranglerEnv, { force = false } = {}) {
  const envArg = wranglerEnv ? `--env ${wranglerEnv}` : '';

  if (!force) {
    try {
      const list = run(`${wranglerCmd()} secret list ${envArg}`);
      if (list.includes(name)) {
        logSkip(`Wrangler secret: ${name}`);
        return;
      }
    } catch { /* can't list */ }
  }

  try {
    safeExec(`${wranglerCmd()} secret put ${name} ${envArg}`, {
      input: value,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    log(`Set ${name} on Worker (${wranglerEnv || 'default'})`);
  } catch (err) {
    console.warn(`  ⚠ Could not set ${name}: ${err.message}`);
    console.warn(`    Run manually: echo "VALUE" | ${wranglerCmd()} secret put ${name} ${envArg}`);
  }
}

// --- GitHub Actions CI ---

function secretInput(repo, name, value) {
  safeExec(`gh secret set ${name} --repo ${repo}`, {
    input: value,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

export function storeGitHubSecrets(repo, creds) {
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

export async function setupSharedResources(opts = {}) {
  const {
    region = 'us-east-1',
    originsBucket = 'bike-video-originals',
    outputsBucket = 'bike-video-outputs',
    lambdaName = 'video-agent',
    ghRepo: ghRepoArg,
  } = opts;

  console.log(`\nSetting up shared video pipeline resources (${region})\n`);

  const awsAccountId = getAwsAccountId();
  if (!awsAccountId) {
    console.error('  ✗ Could not detect AWS account ID. Is AWS CLI configured?');
    process.exit(1);
  }

  ensureBucket(originsBucket, region);
  ensureBucket(outputsBucket, region);

  const mcRoleArn = ensureMediaConvertRole(region, originsBucket, outputsBucket);
  const lambdaRoleArn = ensureLambdaRole(mcRoleArn, originsBucket, outputsBucket);

  let mcQueue = '';
  try {
    awsJson(`mediaconvert describe-endpoints --region ${region}`);
    mcQueue = `arn:aws:mediaconvert:${region}:${awsAccountId}:queues/Default`;
  } catch {
    console.warn('  ⚠ Could not determine MediaConvert queue ARN');
  }

  const lambdaCreated = ensureLambda(lambdaName, lambdaRoleArn, {
    region,
    originsBucket,
    outputsBucket,
    mediaConvertQueue: mcQueue,
    mediaConvertRole: mcRoleArn,
  });

  ensureEventBridgeRule(lambdaName, region);
  ensureS3Trigger(lambdaName, originsBucket);

  // CI deployment user — only if Lambda was newly created
  if (lambdaCreated) {
    let ghRepo = ghRepoArg;
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
      ci.cleanup();
    } else if (!ghRepo) {
      console.log('  ⚠ Could not detect GitHub repo — skipping CI key rotation');
      console.log('    Run with --gh-repo owner/repo to set up CI credentials');
    } else {
      console.log('  ⚠ gh CLI not found — skipping CI key rotation');
      console.log('    Install: https://cli.github.com/');
    }
  } else {
    console.log('\n  Lambda already exists — skipping CI user setup (managed by existing repo)\n');
  }

  console.log('\nShared resources setup complete.\n');
  return { lambdaCreated };
}

export async function configureInstance(opts = {}) {
  const {
    prefix,
    domain,
    wranglerEnv,
    lambdaName = 'video-agent',
    originsBucket = 'bike-video-originals',
    outputsBucket = 'bike-video-outputs',
    region = 'us-east-1',
    r2Bucket = 'whereto-bike-videos',
    ghRepo: ghRepoArg,
  } = opts;

  if (!prefix || !domain) {
    console.error('configureInstance requires prefix and domain');
    process.exit(1);
  }

  console.log(`\nConfiguring instance: ${prefix} (${domain})\n`);

  // --- Preflight: verify Cloudflare access before touching keys ---
  const cfAccountId = getCloudflareAccountId();
  const cfApiToken = getCloudflareApiToken();
  if (!cfAccountId || !cfApiToken) {
    console.error('  ✗ Cloudflare credentials not detected — aborting before any key rotation');
    console.error('    Make sure wrangler is in PATH (run inside nix develop or use: make setup-video)');
    console.error('    Or set CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN env vars');
    process.exit(1);
  }
  log(`Cloudflare account: ${cfAccountId}`);

  // --- AWS-side ---
  console.log('\n  AWS:\n');
  ensureBucketCors(originsBucket, domain);
  updateLambdaWebhookMap(lambdaName, prefix, domain);
  ensureWebhookSecret(lambdaName, wranglerEnv);

  // --- IAM users (create/update policy, then rotate keys) ---
  console.log('\n  IAM users:\n');
  const presignUserName = ensurePresignUser(prefix, originsBucket);

  // Check if Sippy is already active before touching the sippy user
  const sippyActive = await isSippyActive(r2Bucket, cfAccountId, cfApiToken);

  let sippyUserName;
  let sippy;
  if (sippyActive) {
    logSkip('Sippy already configured — skipping sippy user key rotation');
  } else {
    sippyUserName = ensureSippyUser(outputsBucket);
    sippy = rotateKeys(sippyUserName);
  }

  // Rotate presign keys (per-prefix, always safe)
  const presign = rotateKeys(presignUserName);

  if (sippy) {
    // Wait for new AWS keys to propagate
    logAction('Waiting for new AWS keys to propagate...');
    const keyEnv = {
      ...process.env,
      AWS_ACCESS_KEY_ID: sippy.creds.accessKeyId,
      AWS_SECRET_ACCESS_KEY: sippy.creds.secretAccessKey,
    };
    for (let i = 0; i < 12; i++) {
      try {
        safeExec(`aws --no-cli-pager s3api head-bucket --bucket ${outputsBucket}`, {
          stdio: 'pipe',
          env: keyEnv,
        });
        log('AWS keys are active');
        break;
      } catch {
        if (i === 11) {
          console.warn('    ⚠ Keys may not be active yet — Sippy setup might fail, re-run to retry');
        } else {
          await new Promise(r => setTimeout(r, 5_000));
        }
      }
    }
  }

  // --- Cloudflare-side ---
  console.log('\n  Cloudflare:\n');
  ensureR2Bucket(r2Bucket);

  if (sippy) {
    const sippyOk = await configureSippy(r2Bucket, outputsBucket, region, cfAccountId, cfApiToken, sippy.creds);
    if (sippyOk) sippy.cleanup();
  }

  // --- Wrangler secrets ---
  console.log('\n  Wrangler secrets:\n');
  setWranglerSecret('MEDIACONVERT_ACCESS_KEY_ID', presign.creds.accessKeyId, wranglerEnv, { force: true });
  setWranglerSecret('MEDIACONVERT_SECRET_ACCESS_KEY', presign.creds.secretAccessKey, wranglerEnv, { force: true });
  setWranglerSecret('S3_ORIGINALS_BUCKET', originsBucket, wranglerEnv);
  setWranglerSecret('VIDEO_PREFIX', prefix, wranglerEnv);
  presign.cleanup();

  // --- VIDEO_PREFIX in CI ---
  let ghRepo = ghRepoArg;
  if (!ghRepo) {
    try {
      const remote = run('git remote get-url origin', { stdio: ['pipe', 'pipe', 'pipe'] });
      const match = remote.match(/github\.com[:/](.+?)(?:\.git)?$/);
      if (match) ghRepo = match[1];
    } catch { /* not a git repo or no remote */ }
  }

  let videoPrefixSet = false;
  if (ghRepo) {
    try {
      run('gh --version', { stdio: 'pipe' });
      safeExec(`gh variable set VIDEO_PREFIX --repo ${ghRepo} --body "${prefix}"`, { stdio: 'pipe' });
      log(`Set VIDEO_PREFIX=${prefix} on ${ghRepo}`);
      videoPrefixSet = true;
    } catch {
      console.warn(`  ⚠ Could not set VIDEO_PREFIX GitHub variable — set it manually`);
    }
  }

  // --- Summary ---
  console.log('\n  Done.\n');
  const manualSteps = [];
  manualSteps.push(
    `Set custom domain on R2 bucket "${r2Bucket}": videos.whereto.bike`,
    `  Cloudflare dashboard → R2 → ${r2Bucket} → Settings → Custom Domains`,
  );
  if (!videoPrefixSet) {
    manualSteps.push(`Set VIDEO_PREFIX=${prefix} as a GitHub Actions variable for the build step`);
  }
  if (manualSteps.length > 0) {
    console.log('  Remaining manual steps:');
    let step = 1;
    for (const line of manualSteps) {
      if (line.startsWith('  ')) {
        console.log(`       ${line}`);
      } else {
        console.log(`    ${step}. ${line}`);
        step++;
      }
    }
  }
  console.log('');
}

// --- CLI entry point ---

const args = parseArgs(process.argv.slice(2));

async function main() {
  if (args._command === 'configure-instance') {
    const { prefix, domain, wranglerEnv, lambdaName, originsBucket, originalsBucket, outputsBucket, region, r2Bucket, ghRepo } = args;
    if (!prefix || !domain) {
      console.error('Usage: setup-aws-video.js configure-instance --prefix <city> --domain <domain> [--wrangler-env <env>] [--r2-bucket <name>]');
      process.exit(1);
    }
    await configureInstance({ prefix, domain, wranglerEnv, lambdaName, originsBucket: originsBucket || originalsBucket, outputsBucket, region, r2Bucket, ghRepo });
  } else {
    await setupSharedResources({
      region: args.region,
      originsBucket: args.originsBucket || args.originalsBucket,
      outputsBucket: args.outputsBucket,
      lambdaName: args.lambdaName,
      ghRepo: args.ghRepo,
    });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
