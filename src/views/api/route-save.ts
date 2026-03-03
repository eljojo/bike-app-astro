import { createHash } from 'node:crypto';
import type { APIContext } from 'astro';
import { env } from '../../lib/env';
import { createGitService } from '../../lib/git-factory';
import { db } from '../../lib/get-db';
import { contentEdits } from '../../db/schema';
import { eq, and } from 'drizzle-orm';
import matter from 'gray-matter';
import yaml from 'js-yaml';
import { mergeMedia } from '../../lib/media-merge';
import { parseGpx } from '../../lib/gpx';
import { resolveBranch, isDirectCommit } from '../../lib/draft-branch';
import { findDraft, createDraft, updateDraftTimestamp } from '../../lib/draft-service';
import { GIT_OWNER, GIT_DATA_REPO } from '../../lib/config';
import { jsonResponse, jsonError } from '../../lib/api-response';

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
    return jsonError('Unauthorized', 401);
  }

  if (!slug || !/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(slug)) {
    return jsonError('Invalid slug');
  }

  let update: RouteUpdate;
  try {
    update = await request.json();
  } catch {
    return jsonError('Invalid JSON body');
  }

  // Validate frontmatter keys
  const allowedKeys = new Set(['name', 'tagline', 'tags', 'status', 'difficulty', 'surface', 'title']);
  const unknownKeys = Object.keys(update.frontmatter || {}).filter(k => !allowedKeys.has(k));
  if (unknownKeys.length > 0) {
    return jsonError(`Unknown frontmatter keys: ${unknownKeys.join(', ')}`);
  }

  try {
    const baseBranch = env.GIT_BRANCH || 'main';
    const editorMode = request.headers.get('cookie')?.includes('editor_mode=1') ?? false;
    const targetBranch = resolveBranch(user, editorMode, baseBranch, 'routes', slug);
    const isDirect = isDirectCommit(user, editorMode);

    const git = createGitService({
      token: env.GITHUB_TOKEN,
      owner: GIT_OWNER,
      repo: GIT_DATA_REPO,
      branch: targetBranch,
    });

    const city = 'ottawa';
    const basePath = `${city}/routes/${slug}`;
    const database = db();
    const authorInfo = {
      name: user.displayName,
      email: user.email || `${user.displayName}@users.ottawabybike.ca`,
    };

    // For draft saves, check/create the draft branch before reading files
    let draft = isDirect ? null : await findDraft(database, user.id, 'routes', slug);
    const isFirstDraftSave = !isDirect && !draft;

    if (isFirstDraftSave) {
      // Create draft branch from main HEAD.
      // Wrap in try/catch to handle double-click race: if a concurrent request
      // already created the branch, we proceed normally.
      const mainGit = createGitService({
        token: env.GITHUB_TOKEN, owner: GIT_OWNER, repo: GIT_DATA_REPO, branch: baseBranch,
      });
      const mainSha = await mainGit.getRef(baseBranch);
      if (!mainSha) throw new Error('Cannot resolve main branch');
      try {
        await mainGit.createRef(targetBranch, mainSha);
      } catch (e: any) {
        if (e.message?.includes('already exists') || e.message?.includes('Reference already exists')) {
          // Branch was created by a concurrent request — proceed
        } else {
          throw e;
        }
      }
    }

    // Read current files from target branch
    const currentFile = await git.readFile(`${basePath}/index.md`);
    const currentMedia = await git.readFile(`${basePath}/media.yml`);

    // Compare-and-swap conflict detection (direct commits only)
    if (isDirect && currentFile) {
      const cached = await database.select().from(contentEdits).where(and(eq(contentEdits.contentType, 'routes'), eq(contentEdits.contentSlug, slug))).get();

      let hasConflict = false;

      if (cached) {
        hasConflict = cached.githubSha !== currentFile.sha;
      } else if (update.contentHash) {
        const currentHash = createHash('md5')
          .update(currentFile.content)
          .update(currentMedia?.content || '')
          .digest('hex');
        hasConflict = currentHash !== update.contentHash;
      }

      if (hasConflict) {
        const { data: ghFrontmatter, content: ghBody } = matter(currentFile.content);

        let ghMedia: Array<{ key: string; caption?: string; cover?: boolean }> = [];
        if (currentMedia) {
          const mediaEntries = (yaml.load(currentMedia.content) as any[]) || [];
          // TODO(C7): include all media types when video management is added to admin UI
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

        await database.insert(contentEdits).values({
          contentType: 'routes',
          contentSlug: slug,
          data: freshData,
          githubSha: currentFile.sha,
          updatedAt: new Date().toISOString(),
        }).onConflictDoUpdate({
          target: [contentEdits.contentType, contentEdits.contentSlug],
          set: {
            data: freshData,
            githubSha: currentFile.sha,
            updatedAt: new Date().toISOString(),
          },
        });

        return jsonResponse({
          error: 'This route was modified on GitHub since you started editing. Your edits are preserved in the form — review the changes on GitHub and re-apply.',
          githubUrl: `https://github.com/${GIT_OWNER}/${GIT_DATA_REPO}/blob/${baseBranch}/ottawa/routes/${slug}/index.md`,
          conflict: true,
        }, 409);
      }
    }

    const files: Array<{ path: string; content: string }> = [];
    const deletePaths: string[] = [];
    const isNewRoute = !currentFile;

    // Build frontmatter
    let mergedFrontmatter: Record<string, unknown>;
    let existingFrontmatter: Record<string, unknown> = {};

    if (isNewRoute) {
      const adminFields: Record<string, unknown> = { ...update.frontmatter };
      adminFields.status = 'draft';
      adminFields.created_at = new Date().toISOString().split('T')[0];
      adminFields.updated_at = new Date().toISOString().split('T')[0];
      mergedFrontmatter = adminFields;
    } else {
      const { data } = matter(currentFile.content);
      existingFrontmatter = data;
      mergedFrontmatter = { ...existingFrontmatter, ...update.frontmatter };
    }

    // Process variants — update frontmatter and commit new GPX files
    if (update.variants) {
      const variantMeta = update.variants.map(v => {
        const entry: Record<string, unknown> = { name: v.name, gpx: v.gpx };
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

      const firstDistance = (variantMeta[0] as Record<string, unknown>)?.distance_km;
      if (firstDistance) {
        mergedFrontmatter.distance_km = firstDistance;
      }

      for (const v of update.variants) {
        if (v.isNew && v.gpxContent) {
          files.push({ path: `${basePath}/${v.gpx}`, content: v.gpxContent });
        }
      }

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

    // Commit to target branch
    const sha = await git.writeFiles(files, message, authorInfo,
      deletePaths.length > 0 ? deletePaths : undefined);

    // Draft saves: create PR on first save, update timestamp on subsequent saves
    if (!isDirect) {
      if (isFirstDraftSave) {
        // Re-check for draft in case a concurrent request created one
        const existingDraft = await findDraft(database, user.id, 'routes', slug);
        if (existingDraft) {
          await updateDraftTimestamp(database, existingDraft.id);
          draft = existingDraft;
        } else {
          const mainGit = createGitService({
            token: env.GITHUB_TOKEN, owner: GIT_OWNER, repo: GIT_DATA_REPO, branch: baseBranch,
          });
          const prNumber = await mainGit.createPullRequest(
            targetBranch, baseBranch,
            `${user.displayName}: Update ${slug}`,
            `Community edit by ${user.displayName}`,
          );

          draft = await createDraft(database, {
            userId: user.id, contentType: 'routes', contentSlug: slug,
            branchName: targetBranch, prNumber,
          });
        }
      } else if (draft) {
        await updateDraftTimestamp(database, draft.id);
      }

      return jsonResponse({ success: true, sha, draft: true });
    }

    // Direct commits: cache the edit for future compare-and-swap checks
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

      await database.insert(contentEdits).values({
        contentType: 'routes',
        contentSlug: slug,
        data: cacheData,
        githubSha: newFile.sha,
        updatedAt: new Date().toISOString(),
      }).onConflictDoUpdate({
        target: [contentEdits.contentType, contentEdits.contentSlug],
        set: {
          data: cacheData,
          githubSha: newFile.sha,
          updatedAt: new Date().toISOString(),
        },
      });
    }

    return jsonResponse({ success: true, sha });
  } catch (err: any) {
    console.error('save route error:', err);
    return jsonError(err.message || 'Failed to save', 500);
  }
}
