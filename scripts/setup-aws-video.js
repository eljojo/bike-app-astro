#!/usr/bin/env node

/**
 * Idempotent setup script for the video pipeline AWS infrastructure.
 *
 * Two phases:
 *   1. ensureSharedResources() — S3 buckets, IAM roles, Lambda, EventBridge
 *   2. configureInstance()     — per-instance CORS, webhook map, secrets, Sippy
 *
 * Every operation checks first, creates/updates only if needed.
 * Uses AWS CLI via child_process (same pattern as blog setup.js uses for wrangler).
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
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import readline from 'node:readline';

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((resolve) => rl.question(q, resolve));

const __dirname = dirname(fileURLToPath(import.meta.url));

// --- Helpers ---

function aws(cmd, { silent = false, allowFailure = false } = {}) {
  try {
    const result = execSync(`aws ${cmd}`, {
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
    // Get the ARN
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

  // Inline policy for S3, MediaConvert
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
  // Wait for role propagation
  console.log('    Waiting 10s for IAM role propagation...');
  execSync('sleep 10');

  const role = awsJson(`iam get-role --role-name ${roleName}`);
  return role.Role.Arn;
}

function ensureFfprobeLayer(region) {
  const layerName = 'ffprobe';

  // Check if layer already exists in our account
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

  const tmpDir = execSync('mktemp -d', { encoding: 'utf-8' }).trim();
  execSync(`mkdir -p ${tmpDir}/bin`);

  // Download static ffprobe from johnvansickle.com (widely used, x86_64)
  execSync(
    `curl -sL https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz | tar xJ -C ${tmpDir}/bin --strip-components=1 --wildcards '*/ffprobe'`,
    { stdio: 'pipe' },
  );
  execSync(`cd ${tmpDir} && zip -r layer.zip bin/`, { stdio: 'pipe' });

  const result = aws(
    `lambda publish-layer-version --layer-name ${layerName} --zip-file fileb://${tmpDir}/layer.zip --compatible-runtimes nodejs22.x --region ${region}`,
    { silent: true },
  );
  const parsed = JSON.parse(result);
  execSync(`rm -rf ${tmpDir}`);

  log(`Published ffprobe layer: ${parsed.LayerVersionArn}`);
  return parsed.LayerVersionArn;
}

function ensureLambda(name, roleArn, config) {
  const { region, originsBucket, outputsBucket, mediaConvertQueue, mediaConvertRole } = config;

  // Check if function exists
  if (awsExists(`lambda get-function --function-name ${name}`)) {
    logSkip(`Lambda function: ${name}`);
    // Update code
    const lambdaDir = resolve(__dirname, '..', 'aws', 'video-agent');
    execSync('npm ci --production', { cwd: lambdaDir, stdio: 'pipe' });
    execSync('zip -r function.zip handler.mjs package.json node_modules/', { cwd: lambdaDir, stdio: 'pipe' });
    aws(`lambda update-function-code --function-name ${name} --zip-file fileb://${lambdaDir}/function.zip --publish`, { silent: true });
    log(`Updated Lambda code: ${name}`);
    return;
  }

  // Build the zip
  const lambdaDir = resolve(__dirname, '..', 'aws', 'video-agent');
  execSync('npm ci --production', { cwd: lambdaDir, stdio: 'pipe' });
  execSync('zip -r function.zip handler.mjs package.json node_modules/', { cwd: lambdaDir, stdio: 'pipe' });

  // ffprobe Lambda layer — published to our own account
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

  // Get Lambda ARN
  const fnInfo = awsJson(`lambda get-function --function-name ${lambdaName}`);
  const lambdaArn = fnInfo.Configuration.FunctionArn;

  // Add Lambda as target
  const targets = JSON.stringify([{ Id: 'video-agent', Arn: lambdaArn }]);
  aws(`events put-targets --rule ${ruleName} --targets '${targets}'`);

  // Grant EventBridge permission to invoke Lambda
  aws([
    `lambda add-permission --function-name ${lambdaName}`,
    `--statement-id eventbridge-mediaconvert`,
    `--action lambda:InvokeFunction`,
    `--principal events.amazonaws.com`,
    `--source-arn $(aws events describe-rule --name ${ruleName} --query 'Arn' --output text)`,
  ].join(' '), { allowFailure: true }); // May already exist

  log(`Created EventBridge rule: ${ruleName}`);
}

function ensureS3Trigger(lambdaName, originsBucket) {
  // Check if notification configuration already exists
  const existing = awsJson(`s3api get-bucket-notification-configuration --bucket ${originsBucket}`);
  const configs = existing?.LambdaFunctionConfigurations || [];
  if (configs.some(c => c.Id === 'video-agent-upload')) {
    logSkip(`S3 trigger on ${originsBucket}`);
    return;
  }

  const fnInfo = awsJson(`lambda get-function --function-name ${lambdaName}`);
  const lambdaArn = fnInfo.Configuration.FunctionArn;

  // Grant S3 permission to invoke Lambda
  aws([
    `lambda add-permission --function-name ${lambdaName}`,
    `--statement-id s3-upload-trigger`,
    `--action lambda:InvokeFunction`,
    `--principal s3.amazonaws.com`,
    `--source-arn arn:aws:s3:::${originsBucket}`,
  ].join(' '), { allowFailure: true });

  // Add notification configuration (merge with existing)
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
  const existing = awsJson(`s3api get-bucket-cors --bucket ${bucket}`) || { CORSRules: [] };
  const rules = existing.CORSRules || [];

  const origin = `https://${domain}`;
  const hasOrigin = rules.some(r => r.AllowedOrigins?.includes(origin));
  if (hasOrigin) {
    logSkip(`CORS for ${domain} on ${bucket}`);
    return;
  }

  // Add or merge CORS rule
  if (rules.length === 0) {
    rules.push({
      AllowedHeaders: ['*'],
      AllowedMethods: ['PUT'],
      AllowedOrigins: [origin],
      MaxAgeSeconds: 3600,
    });
  } else {
    // Append origin to first rule
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

  // Set on Worker too
  try {
    const envArg = wranglerEnv ? `--env ${wranglerEnv}` : '';
    execSync(`echo "${secret}" | npx wrangler secret put WEBHOOK_SECRET ${envArg}`, {
      stdio: 'pipe',
      encoding: 'utf-8',
    });
    log(`Set WEBHOOK_SECRET on Worker (${wranglerEnv || 'default'})`);
  } catch (err) {
    console.warn(`  ⚠ Could not set WEBHOOK_SECRET on Worker: ${err.message}`);
    console.warn(`    Run manually: echo "${secret}" | npx wrangler secret put WEBHOOK_SECRET${wranglerEnv ? ` --env ${wranglerEnv}` : ''}`);
  }
}

function configureSippy(accountId, bucketName, outputsBucket, region) {
  if (!accountId) {
    console.warn('  ⚠ Skipping Sippy — CLOUDFLARE_ACCOUNT_ID not set');
    return;
  }

  const apiToken = process.env.CLOUDFLARE_API_TOKEN;
  if (!apiToken) {
    console.warn('  ⚠ Skipping Sippy — CLOUDFLARE_API_TOKEN not set');
    return;
  }

  logAction(`Configuring Sippy: R2 ${bucketName} ← S3 ${outputsBucket}`);

  try {
    const body = JSON.stringify({
      source: {
        provider: 's3',
        region,
        bucket: outputsBucket,
        accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
      },
    });

    execSync(`curl -s -X PUT "https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets/${bucketName}/sippy" -H "Authorization: Bearer ${apiToken}" -H "Content-Type: application/json" -d '${body}'`, { stdio: 'pipe' });
    log(`Configured Sippy on R2 bucket: ${bucketName}`);
  } catch (err) {
    console.warn(`  ⚠ Sippy configuration failed: ${err.message}`);
  }
}

// --- GitHub Actions CI ---

function secretInput(repo, name, value) {
  execSync(`gh secret set ${name} --repo ${repo}`, {
    input: value,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

async function configureGitHubSecrets(repo) {
  // Check gh CLI is available
  try {
    execSync('gh --version', { stdio: 'pipe' });
  } catch {
    console.warn('  ⚠ gh CLI not found — skipping GitHub Actions secrets');
    console.warn('    Install: https://cli.github.com/');
    console.warn('    Then set these secrets manually on your repo:');
    console.warn('      AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY');
    return;
  }

  // Check what's already set
  let secretList = '';
  try {
    secretList = execSync(`gh secret list --repo ${repo}`, { encoding: 'utf-8', stdio: 'pipe' });
  } catch { /* repo may not exist yet */ }

  const hasAccessKey = secretList.includes('AWS_ACCESS_KEY_ID');
  const hasSecretKey = secretList.includes('AWS_SECRET_ACCESS_KEY');

  if (hasAccessKey && hasSecretKey) {
    logSkip('GitHub Actions AWS secrets');
    return;
  }

  console.log('\n  GitHub Actions needs AWS credentials to deploy the Lambda on each push.');
  console.log('  Use an IAM user with the AWSLambda_FullAccess policy attached.');
  console.log('  (You can reuse an existing IAM user — just attach the policy in the IAM console.)\n');

  // Try env first, prompt if missing
  let accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  let secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;

  if (!hasAccessKey) {
    if (accessKeyId) {
      console.log(`  Using AWS_ACCESS_KEY_ID from environment.\n`);
    } else {
      accessKeyId = (await ask('  AWS Access Key ID for CI (Enter to skip): ')).trim();
      if (!accessKeyId) {
        console.log('    → skipped. Set later: gh secret set AWS_ACCESS_KEY_ID\n');
        return;
      }
    }
    try {
      secretInput(repo, 'AWS_ACCESS_KEY_ID', accessKeyId);
      log(`Set AWS_ACCESS_KEY_ID on ${repo}`);
    } catch (err) {
      console.warn(`  ⚠ Failed to set AWS_ACCESS_KEY_ID: ${err.message}`);
      return;
    }
  } else {
    logSkip('AWS_ACCESS_KEY_ID');
  }

  if (!hasSecretKey) {
    if (secretAccessKey) {
      console.log(`  Using AWS_SECRET_ACCESS_KEY from environment.\n`);
    } else {
      secretAccessKey = (await ask('  AWS Secret Access Key for CI (Enter to skip): ')).trim();
      if (!secretAccessKey) {
        console.log('    → skipped. Set later: gh secret set AWS_SECRET_ACCESS_KEY\n');
        return;
      }
    }
    try {
      secretInput(repo, 'AWS_SECRET_ACCESS_KEY', secretAccessKey);
      log(`Set AWS_SECRET_ACCESS_KEY on ${repo}`);
    } catch (err) {
      console.warn(`  ⚠ Failed to set AWS_SECRET_ACCESS_KEY: ${err.message}`);
    }
  } else {
    logSkip('AWS_SECRET_ACCESS_KEY');
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

async function main() {
  if (args._command === 'configure-instance') {
    // Per-instance configuration
    const { prefix, domain, wranglerEnv, lambdaName = 'video-agent', originsBucket, outputsBucket, region = 'us-east-1' } = args;
    if (!prefix || !domain) {
      console.error('Usage: setup-aws-video.js configure-instance --prefix <city> --domain <domain> [--wrangler-env <env>]');
      process.exit(1);
    }

    console.log(`\nConfiguring instance: ${prefix} (${domain})\n`);

    const bucket = originsBucket || 'bike-video-originals';
    ensureBucketCors(bucket, domain);
    updateLambdaWebhookMap(lambdaName, prefix, domain);
    ensureWebhookSecret(lambdaName, wranglerEnv);

    // Sippy (optional)
    const cfAccountId = process.env.CLOUDFLARE_ACCOUNT_ID;
    const r2BucketName = args.r2Bucket;
    if (cfAccountId && r2BucketName) {
      configureSippy(cfAccountId, r2BucketName, outputsBucket || 'bike-video-outputs', region);
    }

    console.log('\nInstance configuration complete.\n');
  } else {
    // Shared resources setup
    const region = args.region || 'us-east-1';
    const originsBucket = args.originalsBucket || 'bike-video-originals';
    const outputsBucket = args.outputsBucket || 'bike-video-outputs';
    const lambdaName = args.lambdaName || 'video-agent';

    console.log(`\nSetting up shared video pipeline resources (${region})\n`);

    ensureBucket(originsBucket, region);
    ensureBucket(outputsBucket, region);

    const mcRole = ensureMediaConvertRole(region);
    const lambdaRoleArn = ensureLambdaRole();

    // Get MediaConvert queue (default queue)
    let mcQueue = '';
    try {
      const queues = awsJson(`mediaconvert describe-endpoints --region ${region}`);
      // The default queue ARN follows a pattern; we'll use the endpoint for now
      mcQueue = `arn:aws:mediaconvert:${region}:${awsJson('sts get-caller-identity')?.Account}:queues/Default`;
    } catch {
      console.warn('  ⚠ Could not determine MediaConvert queue ARN');
    }

    ensureLambda(lambdaName, lambdaRoleArn, {
      region,
      originsBucket,
      outputsBucket,
      mediaConvertQueue: mcQueue,
      mediaConvertRole: `arn:aws:iam::${awsJson('sts get-caller-identity')?.Account}:role/${mcRole}`,
    });

    ensureEventBridgeRule(lambdaName, region);
    ensureS3Trigger(lambdaName, originsBucket);

    // Configure GitHub Actions secrets for CI Lambda deploy
    let ghRepo = args.ghRepo;
    if (!ghRepo) {
      try {
        const remote = execSync('git remote get-url origin', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
        const match = remote.match(/github\.com[:/](.+?)(?:\.git)?$/);
        if (match) ghRepo = match[1];
      } catch { /* not a git repo or no remote */ }
    }
    if (ghRepo) {
      await configureGitHubSecrets(ghRepo);
    } else {
      console.log('\n  ⚠ Could not detect GitHub repo — skipping CI secrets');
      console.log('    Run with --gh-repo owner/repo or set AWS secrets in GitHub manually');
    }

    console.log('\nShared resources setup complete.\n');
  }
}

main().finally(() => rl.close());
