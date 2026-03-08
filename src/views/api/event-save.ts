import type { APIContext } from 'astro';
import yaml from 'js-yaml';
import { z } from 'zod';
import adminEvents from 'virtual:bike-app/admin-events';
import { GIT_OWNER, GIT_DATA_REPO, CITY } from '../../lib/config';
import { jsonError } from '../../lib/api-response';
import { can } from '../../lib/authorize';
import { saveContent } from '../../lib/content-save';
import type { SaveHandlers, BuildResult, CurrentFiles } from '../../lib/content-save';
import type { IGitService, FileChange } from '../../lib/git-service';
import type { AdminEvent } from '../../types/admin';
import { buildFreshEventData, computeEventContentHashFromFiles } from '../../lib/models/event-model';
import { slugify } from '../../lib/slug';
import { extractFrontmatterField, parkOrphanedPhoto, updatePhotoRegistryCache } from '../../lib/photo-parking';
import type { ParkedPhotoEntry } from '../../lib/media-merge';
import sharedKeysData from 'virtual:bike-app/photo-shared-keys';

export const prerender = false;

interface OrganizerPayload {
  slug: string;
  name: string;
  website?: string;
  instagram?: string;
}

const eventUpdateSchema = z.object({
  frontmatter: z.record(z.string(), z.unknown()),
  body: z.string(),
  contentHash: z.string().optional(),
  organizer: z.object({
    slug: z.string(),
    name: z.string(),
    website: z.string().optional(),
    instagram: z.string().optional(),
  }).optional(),
  slug: z.string().optional(),
});

export interface EventUpdate {
  frontmatter: Record<string, unknown>;
  body: string;
  contentHash?: string;
  organizer?: OrganizerPayload;
  slug?: string;   // for new events
}

interface EventBuildResult extends BuildResult {
  oldPosterKey: string | undefined;
  newPosterKey: string | undefined;
  eventSlug: string;
  mergedParked: ParkedPhotoEntry[] | undefined;
}

function countOrganizerReferences(orgSlug: string, excludeEventId: string): number {
  return adminEvents.filter((e: AdminEvent) => {
    if (e.id === excludeEventId) return false;
    return typeof e.organizer === 'string' && e.organizer === orgSlug;
  }).length;
}

function resolveEventPath(eventId: string): string {
  const [year, slug] = eventId.split('/');
  return `${CITY}/events/${year}/${slug}.md`;
}

export const eventHandlers: SaveHandlers<EventUpdate, EventBuildResult> = {
  parseRequest(body: unknown): EventUpdate {
    return eventUpdateSchema.parse(body);
  },

  resolveContentId(params, update): string {
    const id = params.id;
    if (id === 'new') {
      const startDate = update.frontmatter.start_date as string;
      const year = startDate?.substring(0, 4) || new Date().getFullYear().toString();
      const slug = update.slug || slugify(update.frontmatter.name as string);
      return `${year}/${slug}`;
    }
    return id!;
  },

  validateSlug(eventId: string): string | null {
    const slug = eventId.split('/')[1];
    if (!slug) return 'Event name is required';
    if (slug.length < 2) return 'Event name is too short';
    return null;
  },

  getFilePaths(eventId: string) {
    return { primary: resolveEventPath(eventId) };
  },

  computeContentHash(currentFiles: CurrentFiles): string {
    return computeEventContentHashFromFiles(currentFiles);
  },

  buildFreshData(eventId: string, currentFiles: CurrentFiles): string {
    return buildFreshEventData(eventId, currentFiles);
  },

  async checkExistence(git: IGitService, eventId: string): Promise<Response | null> {
    const eventPath = resolveEventPath(eventId);
    const existing = await git.readFile(eventPath);
    if (existing) {
      return jsonError(`Event ${eventId} already exists`, 409);
    }
    return null;
  },

  async buildFileChanges(update, eventId, currentFiles, git) {
    const eventPath = resolveEventPath(eventId);
    const files: FileChange[] = [];
    const deletePaths: string[] = [];
    const isNew = !currentFiles.primaryFile;

    // Detect poster_key change and park orphaned photo
    const oldPosterKey = currentFiles.primaryFile
      ? extractFrontmatterField(currentFiles.primaryFile.content, 'poster_key')
      : undefined;
    const newPosterKey = update.frontmatter.poster_key as string | undefined;

    let mergedParked: ParkedPhotoEntry[] | undefined;
    const parked = await parkOrphanedPhoto({
      oldKey: oldPosterKey,
      newKey: newPosterKey,
      contentType: 'event',
      contentId: eventId,
      sharedKeysData,
      git,
    });
    if (parked) {
      mergedParked = parked.mergedParked;
      files.push(parked.fileChange);
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
        const orgFilePath = `${CITY}/organizers/${orgSlug}.md`;
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
        files.push({ path: `${CITY}/organizers/${orgSlug}.md`, content: orgContent });
      }
    }

    // Serialize event file
    const frontmatterStr = yaml.dump(fm, {
      lineWidth: -1, quotingType: '"', forceQuotes: false,
    }).trimEnd();

    const eventContent = update.body.trim()
      ? `---\n${frontmatterStr}\n---\n\n${update.body}\n`
      : `---\n${frontmatterStr}\n---\n`;

    // Event file goes first in the commit
    files.unshift({ path: eventPath, content: eventContent });

    return { files, deletePaths, isNew, oldPosterKey, newPosterKey, eventSlug: eventId, mergedParked };
  },

  async afterCommit(result, database) {
    const { oldPosterKey, newPosterKey, eventSlug, mergedParked } = result;
    const changes = [];
    if (oldPosterKey !== newPosterKey) {
      if (oldPosterKey) changes.push({ key: oldPosterKey, usage: { type: 'event' as const, slug: eventSlug }, action: 'remove' as const });
      if (newPosterKey) changes.push({ key: newPosterKey, usage: { type: 'event' as const, slug: eventSlug }, action: 'add' as const });
    }
    await updatePhotoRegistryCache({ database, sharedKeysData, keyChanges: changes, mergedParked });
  },

  buildCommitMessage(update, eventId, isNew): string {
    const resourcePath = `${CITY}/events/${eventId}`;
    const title = (update.frontmatter as Record<string, unknown>)?.name as string || eventId;
    const trailer = `\n\nChanges: ${resourcePath}`;
    return isNew ? `Create ${title}${trailer}` : `Update ${title}${trailer}`;
  },

  buildGitHubUrl(eventId: string, baseBranch: string): string {
    return `https://github.com/${GIT_OWNER}/${GIT_DATA_REPO}/blob/${baseBranch}/${resolveEventPath(eventId)}`;
  },
};

export function isPastEvent(startDate: string | undefined): boolean {
  if (!startDate) return false;
  const today = new Date().toISOString().slice(0, 10);
  return startDate < today;
}

export async function POST({ params, request, locals }: APIContext) {
  const user = locals.user;

  // For existing past events, only admins can edit
  if (params.id && params.id !== 'new') {
    const existing = adminEvents.find((e: AdminEvent) => e.id === params.id);
    if (existing && isPastEvent(existing.start_date) && !can(user, 'edit-past-event')) {
      return jsonError('Only admins can edit past events', 403);
    }
  }

  // For new events, checkExistence should run; for existing events, it shouldn't
  const id = params.id;
  const handlers = id === 'new'
    ? eventHandlers
    : { ...eventHandlers, checkExistence: undefined };

  return saveContent(request, locals, params, 'events', handlers);
}
