import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

interface AuthorEntry {
  name: string;
  count: number;
}

interface UserData {
  id: string;
  username: string;
  email?: string | null;
  bannedAt?: string | null;
}

export interface Contributor {
  username: string;
  gravatarHash: string;
}

function md5(str: string): string {
  return createHash('md5').update(str.trim().toLowerCase()).digest('hex');
}

/**
 * Parse git log output into a map of email -> { name, count }.
 * Input: flat array of lines from `git log --format='%H%n%ae%n%an'`
 * (every 3 lines = one commit: hash, email, name)
 */
export function groupCommitsByAuthor(lines: string[]): Map<string, AuthorEntry> {
  const map = new Map<string, AuthorEntry>();
  for (let i = 0; i + 2 < lines.length; i += 3) {
    const email = lines[i + 1];
    const name = lines[i + 2];
    if (!email) continue;
    const existing = map.get(email);
    if (existing) {
      existing.count++;
    } else {
      map.set(email, { name, count: 1 });
    }
  }
  return map;
}

/**
 * Resolve authors to contributors with gravatar hashes.
 * - App users (username+userId@whereto.bike): look up in usersData for real email
 * - Manual commits (regular email): use commit email for gravatar
 * - Merge if an app user's real email also appears as a manual commit email
 * - Exclude banned users
 * - Sort by commit count descending
 */
export function resolveContributors(
  authorMap: Map<string, AuthorEntry>,
  usersData: UserData[],
): Contributor[] {
  // No DB access — fall back to git author names
  if (usersData.length === 0) {
    return resolveWithoutDb(authorMap);
  }

  const userById = new Map(usersData.map(u => [u.id, u]));
  const userByEmail = new Map(
    usersData.filter(u => u.email).map(u => [u.email!, u]),
  );

  const resolved = new Map<string, { username: string; email: string; count: number }>();

  for (const [authorEmail, entry] of authorMap) {
    // Try app commit format: username+userId@whereto.bike
    const appMatch = authorEmail.match(/^(.+)\+(.+)@whereto\.bike$/);
    if (appMatch) {
      const userId = appMatch[2];
      const user = userById.get(userId);
      if (!user) continue; // userId not in DB — skip entirely
      if (user.bannedAt) continue;
      const key = user.id;
      const email = user.email || authorEmail;
      const existing = resolved.get(key);
      if (existing) {
        existing.count += entry.count;
      } else {
        resolved.set(key, { username: user.username, email, count: entry.count });
      }
      continue;
    }

    // Regular email — only include if it belongs to a known DB user
    const user = userByEmail.get(authorEmail);
    if (!user) continue; // no DB match — skip, never use git author name
    if (user.bannedAt) continue;
    const key = user.id;
    const existing = resolved.get(key);
    if (existing) {
      existing.count += entry.count;
    } else {
      resolved.set(key, { username: user.username, email: authorEmail, count: entry.count });
    }
  }

  return [...resolved.values()]
    .sort((a, b) => b.count - a.count)
    .map(({ username, email }) => ({
      username,
      gravatarHash: md5(email),
    }));
}

function resolveWithoutDb(authorMap: Map<string, AuthorEntry>): Contributor[] {
  const results: { username: string; email: string; count: number }[] = [];

  for (const [authorEmail, entry] of authorMap) {
    const appMatch = authorEmail.match(/^(.+)\+(.+)@whereto\.bike$/);
    const username = appMatch ? appMatch[1] : entry.name;
    results.push({ username, email: authorEmail, count: entry.count });
  }

  return results
    .sort((a, b) => b.count - a.count)
    .map(({ username, email }) => ({
      username,
      gravatarHash: md5(email),
    }));
}

/**
 * Load users from D1 (CI) or local SQLite (dev).
 * Emails stay in memory only — never written to disk or CI logs.
 */
function loadUsers(): UserData[] {
  if (process.env.RUNTIME === 'local') {
    const dbPath = process.env.LOCAL_DB_PATH || path.resolve(import.meta.dirname, '../.data/local.db');
    if (!fs.existsSync(dbPath)) return [];
    try {
      const Database = require('better-sqlite3');
      const db = new Database(dbPath, { readonly: true });
      const rows = db.prepare('SELECT id, username, email, banned_at as bannedAt FROM users').all();
      db.close();
      return rows;
    } catch {
      console.warn('Failed to load users from local SQLite');
      return [];
    }
  }

  // CI: query production D1 via wrangler (needs CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID).
  // --config is required: wrangler won't auto-discover .jsonc files.
  try {
    const output = execSync(
      'npx wrangler d1 execute DB --config wrangler.jsonc --env production --remote --json --command "SELECT id, username, email, banned_at as bannedAt FROM users"',
      { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] },
    );
    const parsed = JSON.parse(output);
    return parsed[0].results;
  } catch {
    // Fail silently — never log raw output (contains emails)
    console.warn('Failed to load users from D1 (missing credentials?)');
    return [];
  }
}

// Main execution — only when run directly, not when imported for tests
const isDirectRun = process.argv[1] && (
  process.argv[1].endsWith('build-contributors.ts') ||
  process.argv[1].endsWith('build-contributors.js')
);

if (isDirectRun) {
  const CONTENT_DIR = process.env.CONTENT_DIR || path.resolve(import.meta.dirname, '../../bike-routes');
  const CITY = process.env.CITY || 'ottawa';

  const gitLog = execSync(
    `git -C "${CONTENT_DIR}" log --format="%H%n%ae%n%an" -- "${CITY}/"`,
    { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 },
  );
  const lines = gitLog.trim().split('\n').filter(Boolean);
  const authorMap = groupCommitsByAuthor(lines);
  const usersData = loadUsers();

  const contributors = resolveContributors(authorMap, usersData);
  const outDir = path.resolve(import.meta.dirname, '../.astro');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'contributors.json'), JSON.stringify(contributors));
  console.log(`Wrote ${contributors.length} contributors to .astro/contributors.json`);
}
