/**
 * Read the Drizzle migration SQL and apply it with CREATE TABLE IF NOT EXISTS.
 *
 * Used by both local dev (src/db/local.ts) and e2e test helpers
 * to bootstrap SQLite from the single source of truth in drizzle/migrations/.
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
  const root = findProjectRoot(__dirname);
  const migrationPath = path.join(root, 'drizzle', 'migrations', '0000_init.sql');
  const sql = fs.readFileSync(migrationPath, 'utf-8');

  const statements = sql
    .split('--> statement-breakpoint')
    .map(s => s.trim())
    .filter(Boolean)
    .map(s => s.replace(/^CREATE TABLE\b/i, 'CREATE TABLE IF NOT EXISTS'))
    .map(s => s.replace(/^CREATE UNIQUE INDEX\b/i, 'CREATE UNIQUE INDEX IF NOT EXISTS'))
    .map(s => s.replace(/^CREATE INDEX\b/i, 'CREATE INDEX IF NOT EXISTS'));

  for (const stmt of statements) {
    db.exec(stmt);
  }
}
