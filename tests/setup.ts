import fs from 'node:fs';

// Clean up stale test databases from crashed test runs
for (const file of fs.readdirSync('.')) {
  if (file.startsWith('.test-') && file.endsWith('.db')) {
    for (const ext of ['', '-wal', '-shm']) {
      try { fs.unlinkSync(file + ext); } catch {}
    }
  }
}

// Tell env.service to take the local-adapter branch instead of `await
// import('cloudflare:workers')`, which doesn't resolve outside the Workers
// runtime. Tests that need the env-bound DB (loadAdminEventList, etc.) read
// LOCAL_DB_PATH; we set a per-worker default so workers don't collide and
// integration tests can override it before importing the module under test.
process.env.RUNTIME = 'local';
if (!process.env.LOCAL_DB_PATH) {
  const tmp = process.env.RUNNER_TEMP || process.env.TMPDIR || '/tmp';
  process.env.LOCAL_DB_PATH = `${tmp}/.test-integration-${process.pid}.db`;
}

// Segment translations are now a static constant in segment-registry.ts.
// No runtime initialization needed.
