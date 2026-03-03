import { createHash } from 'node:crypto';
import type { APIContext } from 'astro';
import { env } from '../../lib/env';
import { createGitService } from '../../lib/git-factory';
import { db } from '../../lib/get-db';
import { contentEdits } from '../../db/schema';
import { eq, and } from 'drizzle-orm';
import matter from 'gray-matter';
import yaml from 'js-yaml';
import adminEvents from 'virtual:bike-app/admin-events';
import { resolveBranch, isDirectCommit } from '../../lib/draft-branch';
import { findDraft, ensureDraftBranch, handleDraftAfterCommit } from '../../lib/draft-service';
import { GIT_OWNER, GIT_DATA_REPO } from '../../lib/config';
import { jsonResponse, jsonError } from '../../lib/api-response';

export const prerender = false;

interface OrganizerPayload {
  slug: string;
  name: string;
  website?: string;
  instagram?: string;
}

interface EventUpdate {
  frontmatter: Record<string, unknown>;
  body: string;
  contentHash?: string;
  organizer?: OrganizerPayload;
  slug?: string;   // for new events
}

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/**
 * Count how many OTHER events reference a given organizer slug.
 * Uses the build-time virtual module data (works in both local and production).
 */
function countOrganizerReferences(orgSlug: string, excludeEventId: string): number {
  return adminEvents.filter(e => {
    if (e.id === excludeEventId) return false;
    return typeof e.organizer === 'string' && e.organizer === orgSlug;
  }).length;
}

export async function POST({ params, request, locals }: APIContext) {
  const user = locals.user;
  if (!user) {
    return jsonError('Unauthorized', 401);
  }

  const id = params.id;  // e.g. "2025/bike-fest" or "new"

  let update: EventUpdate;
  try {
    update = await request.json();
  } catch {
    return jsonError('Invalid JSON body');
  }

  try {
    const baseBranch = env.GIT_BRANCH || 'main';
    const city = 'ottawa';
    const database = db();
    const files: Array<{ path: string; content: string }> = [];
    const deletePaths: string[] = [];
    const authorInfo = {
      name: user.displayName,
      email: user.email || `${user.displayName}@users.ottawabybike.ca`,
    };

    let eventId: string;
    let eventPath: string;
    let isNew = false;

    // Resolve eventId and eventPath first (needed for branch resolution)
    if (id === 'new') {
      isNew = true;
      const startDate = update.frontmatter.start_date as string;
      const year = startDate?.substring(0, 4) || new Date().getFullYear().toString();
      const slug = update.slug || slugify(update.frontmatter.name as string);

      if (!slug || slug.length < 2) {
        return jsonError('Invalid slug');
      }

      eventId = `${year}/${slug}`;
      eventPath = `${city}/events/${year}/${slug}.md`;
    } else {
      eventId = id!;
      const [year, slug] = eventId.split('/');
      eventPath = `${city}/events/${year}/${slug}.md`;
    }

    const editorMode = request.headers.get('cookie')?.includes('editor_mode=1') ?? false;
    const targetBranch = resolveBranch(user, editorMode, baseBranch, 'events', eventId);
    const isDirect = isDirectCommit(user, editorMode);

    const git = createGitService({
      token: env.GITHUB_TOKEN, owner: GIT_OWNER, repo: GIT_DATA_REPO, branch: targetBranch,
    });

    // For draft saves, check/create the draft branch
    let draft = isDirect ? null : await findDraft(database, user.id, 'events', eventId);
    const isFirstDraftSave = !isDirect && !draft;

    if (isFirstDraftSave) {
      await ensureDraftBranch(env.GITHUB_TOKEN, baseBranch, targetBranch);
    }

    if (isNew) {
      // Check if file already exists on the target branch
      const existing = await git.readFile(eventPath);
      if (existing) {
        return jsonError(`Event ${eventId} already exists`, 409);
      }
    } else {
      // Existing event — conflict detection (direct commits only)
      const currentFile = await git.readFile(eventPath);
      if (isDirect && currentFile) {
        const cached = await database.select().from(contentEdits).where(and(eq(contentEdits.contentType, 'events'), eq(contentEdits.contentSlug, eventId))).get();

        let hasConflict = false;
        if (cached) {
          hasConflict = cached.githubSha !== currentFile.sha;
        } else if (update.contentHash) {
          const currentHash = createHash('md5').update(currentFile.content).digest('hex');
          hasConflict = currentHash !== update.contentHash;
        }

        if (hasConflict) {
          const { data: ghFm, content: ghBody } = matter(currentFile.content);
          const freshData = JSON.stringify({
            id: eventId, slug: eventId.split('/')[1], year: eventId.split('/')[0],
            ...ghFm, body: ghBody.trim(),
          });

          await database.insert(contentEdits).values({
            contentType: 'events', contentSlug: eventId, data: freshData, githubSha: currentFile.sha,
            updatedAt: new Date().toISOString(),
          }).onConflictDoUpdate({
            target: [contentEdits.contentType, contentEdits.contentSlug],
            set: { data: freshData, githubSha: currentFile.sha, updatedAt: new Date().toISOString() },
          });

          return jsonResponse({
            error: 'This event was modified on GitHub since you started editing.',
            githubUrl: `https://github.com/${GIT_OWNER}/${GIT_DATA_REPO}/blob/${baseBranch}/${eventPath}`,
            conflict: true,
          }, 409);
        }
      }
    }

    // Build the event frontmatter
    const fm: Record<string, unknown> = { ...update.frontmatter };

    // Organizer handling: inline vs separate file
    if (update.organizer && update.organizer.name) {
      const orgSlug = update.organizer.slug || slugify(update.organizer.name);
      const otherRefs = countOrganizerReferences(orgSlug, eventId);

      if (otherRefs === 0) {
        // This is the only event for this organizer — inline it
        const orgObj: Record<string, string> = { name: update.organizer.name };
        if (update.organizer.website) orgObj.website = update.organizer.website;
        if (update.organizer.instagram) orgObj.instagram = update.organizer.instagram;
        fm.organizer = orgObj;

        // Delete the separate organizer file if it exists
        const orgFilePath = `${city}/organizers/${orgSlug}.md`;
        const existingOrg = await git.readFile(orgFilePath);
        if (existingOrg) {
          deletePaths.push(orgFilePath);
        }
      } else {
        // Other events reference this organizer — keep/create separate file
        fm.organizer = orgSlug;

        const orgFm: Record<string, string> = { name: update.organizer.name };
        if (update.organizer.website) orgFm.website = update.organizer.website;
        if (update.organizer.instagram) orgFm.instagram = update.organizer.instagram;

        const orgContent = `---\n${yaml.dump(orgFm, { lineWidth: -1, quotingType: '"', forceQuotes: false }).trimEnd()}\n---\n`;
        files.push({ path: `${city}/organizers/${orgSlug}.md`, content: orgContent });
      }
    }
    // If no organizer data sent, remove any existing organizer reference
    // (the user cleared the organizer field)

    // Serialize event file
    const frontmatterStr = yaml.dump(fm, {
      lineWidth: -1, quotingType: '"', forceQuotes: false,
    }).trimEnd();

    const eventContent = update.body.trim()
      ? `---\n${frontmatterStr}\n---\n\n${update.body}\n`
      : `---\n${frontmatterStr}\n---\n`;

    // Event file goes first in the commit
    files.unshift({ path: eventPath, content: eventContent });

    // Commit to target branch
    const message = isNew ? `Create event ${eventId}` : `Update event ${eventId}`;
    const sha = await git.writeFiles(files, message, authorInfo,
      deletePaths.length > 0 ? deletePaths : undefined);

    // Draft saves: create PR on first save, update timestamp on subsequent saves
    if (!isDirect) {
      await handleDraftAfterCommit(database, {
        token: env.GITHUB_TOKEN,
        user,
        contentType: 'events',
        contentSlug: eventId,
        baseBranch,
        targetBranch,
        isFirstDraftSave,
        existingDraft: draft,
        prTitle: `${user.displayName}: ${isNew ? 'Create' : 'Update'} event ${eventId}`,
      });

      return jsonResponse({ success: true, sha, id: eventId, draft: true });
    }

    // Direct commits: cache for conflict detection
    const newFile = await git.readFile(eventPath);
    if (newFile) {
      const cacheData = JSON.stringify({
        id: eventId, slug: eventId.split('/')[1], year: eventId.split('/')[0],
        ...fm, body: update.body,
      });

      await database.insert(contentEdits).values({
        contentType: 'events', contentSlug: eventId, data: cacheData, githubSha: newFile.sha,
        updatedAt: new Date().toISOString(),
      }).onConflictDoUpdate({
        target: [contentEdits.contentType, contentEdits.contentSlug],
        set: { data: cacheData, githubSha: newFile.sha, updatedAt: new Date().toISOString() },
      });
    }

    return jsonResponse({ success: true, sha, id: eventId });
  } catch (err: any) {
    console.error('save event error:', err);
    return jsonError(err.message || 'Failed to save', 500);
  }
}
