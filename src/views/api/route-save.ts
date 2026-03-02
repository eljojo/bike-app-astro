import type { APIContext } from 'astro';
import { env } from '../../lib/env';
import { GitService } from '../../lib/git-service';
import { getDb } from '../../db';
import { routeEdits } from '../../db/schema';
import { eq } from 'drizzle-orm';
import { marked } from 'marked';
import yaml from 'js-yaml';

export const prerender = false;

interface RouteUpdate {
  frontmatter: Record<string, unknown>;
  body: string;
  media: Array<{
    key: string;
    caption?: string;
    cover?: boolean;
  }>;
}

export async function POST({ params, request, locals }: APIContext) {
  const { slug } = params;
  const user = locals.user;

  if (!user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!slug || !/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(slug)) {
    return new Response(JSON.stringify({ error: 'Invalid slug' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let update: RouteUpdate;
  try {
    update = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Validate frontmatter keys
  const allowedKeys = new Set(['name', 'tagline', 'tags', 'distance', 'status', 'difficulty', 'surface', 'title']);
  const unknownKeys = Object.keys(update.frontmatter || {}).filter(k => !allowedKeys.has(k));
  if (unknownKeys.length > 0) {
    return new Response(JSON.stringify({ error: `Unknown frontmatter keys: ${unknownKeys.join(', ')}` }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const git = new GitService({
      token: env.GITHUB_TOKEN,
      owner: 'eljojo',
      repo: 'bike-routes',
    });

    const city = 'ottawa';
    const basePath = `${city}/routes/${slug}`;
    const db = getDb(env.DB);

    // Compare-and-swap: read current file SHA from GitHub
    const currentFile = await git.readFile(`${basePath}/index.md`);

    // Check for concurrent edits (only if this route already exists)
    if (currentFile) {
      const cached = await db.select().from(routeEdits).where(eq(routeEdits.slug, slug)).get();
      if (cached && cached.githubSha !== currentFile.sha) {
        return new Response(JSON.stringify({
          error: 'This route was modified since you last edited it. Please reload to get the latest version.',
        }), {
          status: 409,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    const files: Array<{ path: string; content: string }> = [];

    // Build index.md content
    const frontmatterStr = yaml.dump(update.frontmatter, {
      lineWidth: -1,
      quotingType: '"',
      forceQuotes: false,
    }).trimEnd();

    const indexContent = `---\n${frontmatterStr}\n---\n\n${update.body}\n`;
    files.push({ path: `${basePath}/index.md`, content: indexContent });

    // Build media.yml if media changed
    if (update.media && update.media.length > 0) {
      const mediaYaml = yaml.dump(
        update.media.map((m) => {
          const entry: Record<string, unknown> = { key: m.key };
          if (m.caption) entry.caption = m.caption;
          if (m.cover) entry.cover = true;
          return entry;
        }),
        { flowLevel: -1, lineWidth: -1 }
      );
      files.push({ path: `${basePath}/media.yml`, content: mediaYaml });
    }

    // Determine commit message
    const parts: string[] = [];
    if (update.frontmatter) parts.push('Update');
    if (update.media) parts.push(`${update.media.length} photo${update.media.length !== 1 ? 's' : ''}`);
    const message = parts.length > 0
      ? `${parts.join(' + ')} for ${slug}`
      : `Update ${slug}`;

    // Commit
    const sha = await git.writeFiles(files, message, {
      name: user.displayName,
      email: user.email,
    });

    // Cache the edit with the new SHA for future compare-and-swap checks
    const newFile = await git.readFile(`${basePath}/index.md`);
    if (newFile) {
      const renderedBody = await marked.parse(update.body);
      const cacheData = JSON.stringify({
        slug,
        name: update.frontmatter.name,
        tagline: update.frontmatter.tagline || '',
        tags: update.frontmatter.tags || [],
        distance: update.frontmatter.distance,
        status: update.frontmatter.status,
        body: renderedBody,
        media: update.media || [],
      });

      await db.insert(routeEdits).values({
        slug,
        data: cacheData,
        githubSha: newFile.sha,
        updatedAt: new Date().toISOString(),
      }).onConflictDoUpdate({
        target: routeEdits.slug,
        set: {
          data: cacheData,
          githubSha: newFile.sha,
          updatedAt: new Date().toISOString(),
        },
      });
    }

    // Trigger rebuild
    await git.triggerRebuild();

    return new Response(JSON.stringify({ success: true, sha }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    console.error('save route error:', err);
    return new Response(JSON.stringify({ error: err.message || 'Failed to save' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
