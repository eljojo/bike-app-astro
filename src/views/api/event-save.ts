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
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    });
  }

  const id = params.id;  // e.g. "2025/bike-fest" or "new"

  let update: EventUpdate;
  try {
    update = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const branch = env.GIT_BRANCH || 'main';
    const git = createGitService({
      token: env.GITHUB_TOKEN, owner: 'eljojo', repo: 'bike-routes', branch,
    });

    const city = 'ottawa';
    const database = db();
    const files: Array<{ path: string; content: string }> = [];
    const deletePaths: string[] = [];

    let eventId: string;
    let eventPath: string;
    let isNew = false;

    if (id === 'new') {
      isNew = true;
      const startDate = update.frontmatter.start_date as string;
      const year = startDate?.substring(0, 4) || new Date().getFullYear().toString();
      const slug = update.slug || slugify(update.frontmatter.name as string);

      if (!slug || slug.length < 2) {
        return new Response(JSON.stringify({ error: 'Invalid slug' }), {
          status: 400, headers: { 'Content-Type': 'application/json' },
        });
      }

      eventId = `${year}/${slug}`;
      eventPath = `${city}/events/${year}/${slug}.md`;

      // Check if file already exists
      const existing = await git.readFile(eventPath);
      if (existing) {
        return new Response(JSON.stringify({ error: `Event ${eventId} already exists` }), {
          status: 409, headers: { 'Content-Type': 'application/json' },
        });
      }
    } else {
      // Existing event
      eventId = id!;
      const [year, slug] = eventId.split('/');
      eventPath = `${city}/events/${year}/${slug}.md`;

      // Conflict detection
      const currentFile = await git.readFile(eventPath);
      if (currentFile) {
        const cached = await database.select().from(contentEdits).where(and(eq(contentEdits.contentType, 'events'), eq(contentEdits.contentSlug, eventId))).get();

        let hasConflict = false;
        if (cached) {
          hasConflict = cached.githubSha !== currentFile.sha;
        } else if (update.contentHash) {
          const currentHash = createHash('md5').update(currentFile.content).digest('hex');
          hasConflict = currentHash !== update.contentHash;
        }

        if (hasConflict) {
          // Sync scratchpad with fresh data
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

          return new Response(JSON.stringify({
            error: 'This event was modified on GitHub since you started editing.',
            githubUrl: `https://github.com/eljojo/bike-routes/blob/${branch}/${eventPath}`,
            conflict: true,
          }), { status: 409, headers: { 'Content-Type': 'application/json' } });
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

    // Commit
    const message = isNew ? `Create event ${eventId}` : `Update event ${eventId}`;
    const sha = await git.writeFiles(files, message, {
      name: user.displayName, email: user.email || `${user.displayName}@users.ottawabybike.ca`,
    }, deletePaths.length > 0 ? deletePaths : undefined);

    // Cache for conflict detection
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

    return new Response(JSON.stringify({ success: true, sha, id: eventId }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    console.error('save event error:', err);
    return new Response(JSON.stringify({ error: err.message || 'Failed to save' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
}
