import type { APIContext } from 'astro';
import { env } from '../../lib/env';
import { createGitService } from '../../lib/git-factory';
import { db } from '../../lib/get-db';
import { users } from '../../db/schema';
import { eq, like } from 'drizzle-orm';
import { GIT_OWNER, GIT_DATA_REPO } from '../../lib/config';
import { requireAdmin } from '../../lib/auth';
import { jsonResponse, jsonError } from '../../lib/api-response';

export const prerender = false;

export async function POST({ request, locals }: APIContext) {
  try {
    requireAdmin(locals.user);
  } catch {
    return jsonError('Unauthorized', 401);
  }

  const { path, perPage = 20, page = 1 } = await request.json();
  const baseBranch = env.GIT_BRANCH || 'main';

  const git = createGitService({
    token: env.GITHUB_TOKEN,
    owner: GIT_OWNER,
    repo: GIT_DATA_REPO,
    branch: baseBranch,
  });

  const commits = await git.listCommits({ path, perPage, page });

  const database = db();
  const enriched = await Promise.all(commits.map(async (c) => {
    const emailMatch = c.author.email.match(/^(.+)@whereto\.bike$/);
    if (!emailMatch) return { ...c, resolvedUser: null };

    const handle = emailMatch[1];
    const [user] = await database.select().from(users)
      .where(eq(users.username, handle))
      .limit(1);

    if (user) {
      return { ...c, resolvedUser: { id: user.id, username: user.username, role: user.role, bannedAt: user.bannedAt } };
    }

    const [prevUser] = await database.select().from(users)
      .where(like(users.previousUsernames, `%${handle}%`))
      .limit(1);

    if (prevUser) {
      return { ...c, resolvedUser: { id: prevUser.id, username: prevUser.username, role: prevUser.role, bannedAt: prevUser.bannedAt, wasGuest: true } };
    }

    return { ...c, resolvedUser: null };
  }));

  return jsonResponse({ commits: enriched });
}
