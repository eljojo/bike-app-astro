/**
 * Read the Drizzle migration SQL and apply it with CREATE TABLE IF NOT EXISTS.
 *
 * Used by both local dev (src/db/local.ts) and e2e test helpers
 * to bootstrap SQLite from the single source of truth in drizzle/migrations/.
 *
 * Uses process.cwd() which is the project root in all contexts:
 * - astro dev / astro preview (local dev)
 * - playwright test runner (e2e tests)
 */
import fs from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';

export function initSchema(db: InstanceType<typeof Database>) {
  const migrationsDir = path.join(process.cwd(), 'drizzle', 'migrations');
  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
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
}
