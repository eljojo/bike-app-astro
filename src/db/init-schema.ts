/**
 * Read the Drizzle migration SQL and apply it with CREATE TABLE IF NOT EXISTS.
 *
 * Used by both local dev (src/db/local.ts) and e2e test helpers
 * to bootstrap SQLite from the single source of truth in drizzle/migrations/.
 *
 * Uses findProjectRoot() to locate the project root from any working directory,
 * since Playwright tests may run from e2e/admin/ rather than project root.
 */
import fs from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';

function findProjectRoot(startDir: string): string {
  let dir = startDir;
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
    dir = path.dirname(dir);
  }
  return startDir;
}

export function initSchema(db: InstanceType<typeof Database>) {
  const projectRoot = findProjectRoot(process.cwd());
  const migrationsDir = path.join(projectRoot, 'drizzle', 'migrations');
  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
    const statements = sql
      .split('--> statement-breakpoint')
      .map(s => s.trim())
      .filter(Boolean)
      .map(s => s.replace(/^--.*\n/gm, '').trim())
      .filter(Boolean)
      .map(s => s.replace(/^CREATE TABLE\b/i, 'CREATE TABLE IF NOT EXISTS'))
      .map(s => s.replace(/^CREATE UNIQUE INDEX\b/i, 'CREATE UNIQUE INDEX IF NOT EXISTS'))
      .map(s => s.replace(/^CREATE INDEX\b/i, 'CREATE INDEX IF NOT EXISTS'));

    for (const stmt of statements) {
      try {
        db.exec(stmt);
      } catch (err: unknown) {
        // ALTER TABLE migrations may fail on re-run (e.g. column already exists).
        // This is expected when 0000_init.sql already includes the final schema.
        const msg = err instanceof Error ? err.message : '';
        const stmtTrimmed = stmt.replace(/^--.*\n/gm, '').trim();
        if (stmtTrimmed.match(/^ALTER TABLE/i) && msg.includes('duplicate column')) continue;
        if (msg.includes('no such table')) continue;
        throw err;
      }
    }
  }
}
