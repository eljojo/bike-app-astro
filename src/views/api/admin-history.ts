import type { APIContext } from 'astro';
import { env } from '../../lib/env/env.service';
import { createGitService } from '../../lib/git/git-factory';
import { db } from '../../lib/get-db';
import { users } from '../../db/schema';
import { eq, like } from 'drizzle-orm';
import { authorize } from '../../lib/auth/authorize';
import { jsonResponse } from '../../lib/api-response';
import { parseAuthorEmail } from '../../lib/git/commit-author';

export const prerender = false;

export async function POST({ request, locals }: APIContext) {
  const user = authorize(locals, 'view-history');
  if (user instanceof Response) return user;

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
  const enriched = await Promise.all(commits.map(async (c) => {
    const parsed = parseAuthorEmail(c.author.email);
    if (!parsed) return { ...c, resolvedUser: null };

    // New format: look up by userId first
    if (parsed.userId) {
      const [user] = await database.select().from(users)
        .where(eq(users.id, parsed.userId))
        .limit(1);
      if (user) {
        return { ...c, resolvedUser: { id: user.id, username: user.username, role: user.role, bannedAt: user.bannedAt } };
      }
    }

    // Old format or userId not found: look up by username
    if (parsed.username) {
      const [user] = await database.select().from(users)
        .where(eq(users.username, parsed.username))
        .limit(1);
      if (user) {
        return { ...c, resolvedUser: { id: user.id, username: user.username, role: user.role, bannedAt: user.bannedAt } };
      }

      // Fall back to previousUsernames
      const [prevUser] = await database.select().from(users)
        .where(like(users.previousUsernames, `%${parsed.username}%`))
        .limit(1);
      if (prevUser) {
        return { ...c, resolvedUser: { id: prevUser.id, username: prevUser.username, role: prevUser.role, bannedAt: prevUser.bannedAt, wasGuest: true } };
      }
    }

    return { ...c, resolvedUser: null };
  }));

  return jsonResponse({ commits: enriched });
}
