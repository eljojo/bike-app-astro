import { createHash } from 'node:crypto';
import type { APIContext } from 'astro';
import { env } from '../../lib/env';
import { createGitService } from '../../lib/git-factory';
import { db } from '../../lib/get-db';
import { routeEdits } from '../../db/schema';
import { eq } from 'drizzle-orm';
import matter from 'gray-matter';
import yaml from 'js-yaml';
import { mergeMedia } from '../../lib/media-merge';
import { parseGpx } from '../../lib/gpx';

export const prerender = false;

interface VariantPayload {
  name: string;
  gpx: string;
  distance_km?: number;
  strava_url?: string;
  rwgps_url?: string;
  isNew?: boolean;
  gpxContent?: string;
}

interface RouteUpdate {
  frontmatter: Record<string, unknown>;
  body: string;
  media: Array<{
    key: string;
    caption?: string;
    cover?: boolean;
    width?: number;
    height?: number;
  }>;
  variants?: VariantPayload[];
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
  const allowedKeys = new Set(['name', 'tagline', 'tags', 'status', 'difficulty', 'surface', 'title']);
  const unknownKeys = Object.keys(update.frontmatter || {}).filter(k => !allowedKeys.has(k));
  if (unknownKeys.length > 0) {
    return new Response(JSON.stringify({ error: `Unknown frontmatter keys: ${unknownKeys.join(', ')}` }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const branch = env.GIT_BRANCH || 'main';
    const git = createGitService({
      token: env.GITHUB_TOKEN,
      owner: 'eljojo',
      repo: 'bike-routes',
      branch,
    });

    const city = 'ottawa';
    const basePath = `${city}/routes/${slug}`;
    const database = db();

    // Compare-and-swap: detect if GitHub has diverged
    const currentFile = await git.readFile(`${basePath}/index.md`);
    const currentMedia = await git.readFile(`${basePath}/media.yml`);

    if (currentFile) {
      const cached = await database.select().from(routeEdits).where(eq(routeEdits.slug, slug)).get();

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
          body: ghBody.trim(),
          media: ghMedia,
          variants: (ghFrontmatter.variants as any[]) || [],
        });

        await database.insert(routeEdits).values({
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
    const deletePaths: string[] = [];
    const isNewRoute = !currentFile;

    // Build frontmatter
    let mergedFrontmatter: Record<string, unknown>;
    let existingFrontmatter: Record<string, unknown> = {};

    if (isNewRoute) {
      // New route — build frontmatter from scratch
      const adminFields: Record<string, unknown> = { ...update.frontmatter };
      adminFields.status = 'draft';
      adminFields.created_at = new Date().toISOString().split('T')[0];
      adminFields.updated_at = new Date().toISOString().split('T')[0];
      mergedFrontmatter = adminFields;
    } else {
      // Existing route — merge admin-editable fields into existing frontmatter
      // so that fields the admin doesn't edit (created_at, etc.) are preserved.
      const { data } = matter(currentFile.content);
      existingFrontmatter = data;
      mergedFrontmatter = { ...existingFrontmatter, ...update.frontmatter };
    }

    // Process variants — update frontmatter and commit new GPX files
    if (update.variants) {
      const variantMeta = update.variants.map(v => {
        const entry: Record<string, unknown> = { name: v.name, gpx: v.gpx };
        // Compute distance from GPX content for new uploads
        if (v.isNew && v.gpxContent) {
          const track = parseGpx(v.gpxContent);
          entry.distance_km = Math.round(track.distance_m / 100) / 10;
        } else if (v.distance_km) {
          entry.distance_km = v.distance_km;
        }
        if (v.strava_url) entry.strava_url = v.strava_url;
        if (v.rwgps_url) entry.rwgps_url = v.rwgps_url;
        return entry;
      });
      mergedFrontmatter.variants = variantMeta;

      // Set route-level distance_km from the first variant
      const firstDistance = (variantMeta[0] as Record<string, unknown>)?.distance_km;
      if (firstDistance) {
        mergedFrontmatter.distance_km = firstDistance;
      }

      // Add new GPX files to the commit
      for (const v of update.variants) {
        if (v.isNew && v.gpxContent) {
          files.push({ path: `${basePath}/${v.gpx}`, content: v.gpxContent });
        }
      }

      // Detect removed variants — delete their GPX files
      if (existingFrontmatter.variants) {
        const existingGpxFiles = new Set(
          (existingFrontmatter.variants as Array<{ gpx: string }>).map(v => v.gpx)
        );
        const newGpxFiles = new Set(update.variants.map(v => v.gpx));
        for (const gpx of existingGpxFiles) {
          if (!newGpxFiles.has(gpx)) {
            deletePaths.push(`${basePath}/${gpx}`);
          }
        }
      }
    }

    // Build index.md from final merged frontmatter
    const frontmatterStr = yaml.dump(mergedFrontmatter, {
      lineWidth: -1,
      quotingType: '"',
      forceQuotes: false,
    }).trimEnd();

    const indexContent = `---\n${frontmatterStr}\n---\n\n${update.body}\n`;
    files.push({ path: `${basePath}/index.md`, content: indexContent });

    // Build media.yml by merging admin changes into existing entries
    if (update.media) {
      let existingMedia: Array<Record<string, unknown>> = [];
      if (currentMedia) {
        existingMedia = (yaml.load(currentMedia.content) as Array<Record<string, unknown>>) || [];
      }
      const merged = mergeMedia(update.media, existingMedia);
      if (merged.length > 0) {
        const mediaYaml = yaml.dump(merged, { flowLevel: -1, lineWidth: -1 });
        files.push({ path: `${basePath}/media.yml`, content: mediaYaml });
      }
    }

    // Determine commit message
    const parts: string[] = [];
    if (update.frontmatter) parts.push('Update');
    if (update.media) {
      let existingCount = 0;
      if (currentMedia) {
        const entries = (yaml.load(currentMedia.content) as Array<Record<string, unknown>>) || [];
        existingCount = entries.length;
      }
      const added = update.media.length - existingCount;
      if (added > 0) {
        parts.push(`${added} media`);
      }
    }
    if (update.variants) {
      const newVariants = update.variants.filter(v => v.isNew);
      if (newVariants.length > 0) {
        parts.push(`${newVariants.length} variant${newVariants.length > 1 ? 's' : ''}`);
      }
    }
    const message = isNewRoute
      ? `Create ${slug}`
      : parts.length > 0
        ? `${parts.join(' + ')} for ${slug}`
        : `Update ${slug}`;

    // Commit
    const sha = await git.writeFiles(files, message, {
      name: user.displayName,
      email: user.email,
    }, deletePaths.length > 0 ? deletePaths : undefined);

    // Cache the edit with the new SHA for future compare-and-swap checks
    const newFile = await git.readFile(`${basePath}/index.md`);
    if (newFile) {
      const cacheData = JSON.stringify({
        slug,
        name: update.frontmatter.name,
        tagline: update.frontmatter.tagline || '',
        tags: update.frontmatter.tags || [],
        distance: mergedFrontmatter.distance_km || 0,
        status: update.frontmatter.status,
        body: update.body,
        media: update.media || [],
        variants: update.variants?.map(v => ({
          name: v.name, gpx: v.gpx, distance_km: v.distance_km,
          strava_url: v.strava_url, rwgps_url: v.rwgps_url,
        })) || [],
      });

      await database.insert(routeEdits).values({
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

    // Rebuild is triggered automatically by GitHub Actions in bike-routes
    // (notify-astro.yml) when the commit is pushed — no manual dispatch needed.

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
