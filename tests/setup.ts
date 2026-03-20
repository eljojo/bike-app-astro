import fs from 'node:fs';

// Clean up stale test databases from crashed test runs
for (const file of fs.readdirSync('.')) {
  if (file.startsWith('.test-') && file.endsWith('.db')) {
    for (const ext of ['', '-wal', '-shm']) {
      try { fs.unlinkSync(file + ext); } catch {}
    }
  }
}

// Segment translations are now a static constant in segment-registry.ts.
// No runtime initialization needed.
