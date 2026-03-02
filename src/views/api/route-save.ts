import { createHash } from 'node:crypto';
import type { APIContext } from 'astro';
import { env } from '../../lib/env';
import { GitService } from '../../lib/git-service';
import { getDb } from '../../db';
import { routeEdits } from '../../db/schema';
import { eq } from 'drizzle-orm';
import matter from 'gray-matter';
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
  contentHash?: string;
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
      branch: env.GIT_BRANCH || 'main',
    });

    const city = 'ottawa';
    const basePath = `${city}/routes/${slug}`;
    const db = getDb(env.DB);

    // Compare-and-swap: detect if GitHub has diverged
    const currentFile = await git.readFile(`${basePath}/index.md`);
    const currentMedia = await git.readFile(`${basePath}/media.yml`);

    if (currentFile) {
      const cached = await db.select().from(routeEdits).where(eq(routeEdits.slug, slug)).get();

      let hasConflict = false;

      if (cached) {
        // Case A: scratchpad exists — compare SHA
        hasConflict = cached.githubSha !== currentFile.sha;
      } else if (update.contentHash) {
        // Case B: first save after deploy — compare content hash
        const currentHash = createHash('md5')
          .update(currentFile.content)
          .update(currentMedia?.content || '')
          .digest('hex');
        hasConflict = currentHash !== update.contentHash;
      }

      if (hasConflict) {
        // Sync scratchpad with fresh GitHub data so reload shows current state
        const { data: ghFrontmatter, content: ghBody } = matter(currentFile.content);
        const ghRenderedBody = await marked.parse(ghBody);

        let ghMedia: Array<{ key: string; caption?: string; cover?: boolean }> = [];
        if (currentMedia) {
          const mediaEntries = (yaml.load(currentMedia.content) as any[]) || [];
          ghMedia = mediaEntries
            .filter((m: any) => m.type === 'photo')
            .map((m: any) => {
              const item: Record<string, unknown> = { key: m.key };
              if (m.caption) item.caption = m.caption;
              if (m.cover) item.cover = m.cover;
              return item;
            }) as Array<{ key: string; caption?: string; cover?: boolean }>;
        }

        const freshData = JSON.stringify({
          slug,
          name: ghFrontmatter.name,
          tagline: ghFrontmatter.tagline || '',
          tags: ghFrontmatter.tags || [],
          distance: ghFrontmatter.distance_km,
          status: ghFrontmatter.status,
          body: ghRenderedBody,
          media: ghMedia,
        });

        await db.insert(routeEdits).values({
          slug,
          data: freshData,
          githubSha: currentFile.sha,
          updatedAt: new Date().toISOString(),
        }).onConflictDoUpdate({
          target: routeEdits.slug,
          set: {
            data: freshData,
            githubSha: currentFile.sha,
            updatedAt: new Date().toISOString(),
          },
        });

        const branch = env.GIT_BRANCH || 'main';
        return new Response(JSON.stringify({
          error: 'This route was modified on GitHub since you started editing. Your edits are preserved in the form — review the changes on GitHub and re-apply.',
          githubUrl: `https://github.com/eljojo/bike-routes/blob/${branch}/ottawa/routes/${slug}/index.md`,
          conflict: true,
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
