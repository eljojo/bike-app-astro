import type { APIContext } from 'astro';
import { env } from '../../lib/env/env.service';
import { createGitService } from '../../lib/git/git-factory';
import { db } from '../../lib/get-db';
import { users } from '../../db/schema';
import { like, inArray, or } from 'drizzle-orm';
import { authorize } from '../../lib/auth/authorize';
import { jsonResponse, jsonError } from '../../lib/api-response';
import { parseAuthorEmail } from '../../lib/git/commit-author';
import { checkRateLimit, recordAttempt } from '../../lib/auth/rate-limit';
import { createHash } from 'node:crypto';

type ResolvedUser = { id: string; username: string; role: string; bannedAt: string | null; wasGuest?: boolean };

export const prerender = false;

const ANON_LIMIT = 30; // requests per hour for anonymous users

export async function POST({ request, locals }: APIContext) {
  const user = authorize(locals, 'view-history');
  if (user instanceof Response) {
    // Allow anonymous browsing with IP-based rate limiting
    const ip = request.headers.get('cf-connecting-ip')
      || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      || 'unknown';
    const database = db();
    const limited = await checkRateLimit(database, 'view-history', [ip], ANON_LIMIT);
    if (limited) return jsonError('Too many requests', 429);
    await recordAttempt(database, 'view-history', [ip]);
  }

  const { path, perPage = 20, page = 1 } = await request.json();
  const baseBranch = env.GIT_BRANCH || 'main';

  const git = createGitService({
    token: env.GITHUB_TOKEN,
    owner: env.GIT_OWNER,
    repo: env.GIT_DATA_REPO,
    branch: baseBranch,
  });

  const commits = await git.listCommits({ path, perPage, page });

  const database = db();

  // Parse all commit emails and collect unique lookup keys
  const parsed = commits.map((c) => parseAuthorEmail(c.author.email));
  const userIds = new Set<string>();
  const usernames = new Set<string>();
  const personalEmails = new Set<string>();

  for (let i = 0; i < commits.length; i++) {
    const p = parsed[i];
    if (!p) {
      personalEmails.add(commits[i].author.email);
    } else {
      if (p.userId) userIds.add(p.userId);
      if (p.username) usernames.add(p.username);
    }
  }

  // Batch-fetch all candidate users in one query
  const conditions = [];
  if (userIds.size > 0) conditions.push(inArray(users.id, [...userIds]));
  if (usernames.size > 0) conditions.push(inArray(users.username, [...usernames]));
  if (personalEmails.size > 0) conditions.push(inArray(users.email, [...personalEmails]));

  const allUsers = conditions.length > 0
    ? await database.select().from(users).where(or(...conditions))
    : [];

  // Build lookup indexes
  const byId = new Map(allUsers.map((u) => [u.id, u]));
  const byUsername = new Map(allUsers.map((u) => [u.username, u]));
  const byEmail = new Map(allUsers.filter((u) => u.email).map((u) => [u.email!, u]));

  // Resolve each commit — previousUsernames is a LIKE query, handled as a fallback
  const unresolvedUsernames = new Set<string>();

  const enriched = commits.map((c, i) => {
    const p = parsed[i];

    if (!p) {
      const user = byEmail.get(c.author.email);
      return { ...c, resolvedUser: user ? toResolved(user) : null, gravatarHash: gravatarHash(user?.email ?? c.author.email) };
    }

    if (p.userId) {
      const user = byId.get(p.userId);
      if (user) return { ...c, resolvedUser: toResolved(user), gravatarHash: gravatarHash(user.email ?? c.author.email) };
    }

    if (p.username) {
      const user = byUsername.get(p.username);
      if (user) return { ...c, resolvedUser: toResolved(user), gravatarHash: gravatarHash(user.email ?? c.author.email) };
      unresolvedUsernames.add(p.username);
    }

    return { ...c, resolvedUser: null as ResolvedUser | null, gravatarHash: gravatarHash(c.author.email) };
  });

  // Fallback: batch previousUsernames lookup for any still-unresolved usernames
  if (unresolvedUsernames.size > 0) {
    const prevUsers = await database.select().from(users)
      .where(or(...[...unresolvedUsernames].map((u) => like(users.previousUsernames, `%${u}%`))));
    const byPrevUsername = new Map<string, typeof prevUsers[number]>();
    for (const u of prevUsers) {
      if (!u.previousUsernames) continue;
      for (const name of unresolvedUsernames) {
        if (u.previousUsernames.includes(name)) byPrevUsername.set(name, u);
      }
    }

    for (let i = 0; i < enriched.length; i++) {
      if (enriched[i].resolvedUser) continue;
      const p = parsed[i];
      if (!p?.username) continue;
      const user = byPrevUsername.get(p.username);
      if (user) enriched[i] = { ...enriched[i], resolvedUser: { ...toResolved(user), wasGuest: true }, gravatarHash: gravatarHash(user.email ?? commits[i].author.email) };
    }
  }

  return jsonResponse({ commits: enriched });
}

function toResolved(u: { id: string; username: string; role: string; bannedAt: string | null }): ResolvedUser {
  return { id: u.id, username: u.username, role: u.role, bannedAt: u.bannedAt };
}

function gravatarHash(email: string): string {
  return createHash('md5').update(email.trim().toLowerCase()).digest('hex');
}
