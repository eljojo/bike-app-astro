// AGENTS.md: See src/views/api/AGENTS.md for save pipeline rules.
// Key: always merge frontmatter, return new contentHash, cache stores blob SHAs (not commit SHAs).
import type { APIContext } from 'astro';
import { z } from 'astro/zod';
import adminEvents from 'virtual:bike-app/admin-events';
import { serializeMdFile, serializeYamlFile } from '../../lib/file-serializers';
import { CITY } from '../../lib/config';
import { env } from '../../lib/env';
import { jsonError } from '../../lib/api-response';
import { can } from '../../lib/authorize';
import { saveContent } from '../../lib/content-save';
import type { SaveHandlers, BuildResult, WithSlugValidation, WithExistenceCheck, WithAfterCommit } from '../../lib/content-save';
import type { IGitService, FileChange } from '../../lib/git-service';
import type { AdminEvent } from '../../types/admin';
import { resolveEffectivePrimary, eventMediaItemSchema } from '../../lib/models/event-model';
import { eventOps } from '../../lib/content-ops';
import { slugify } from '../../lib/slug';
import { buildPhotoKeyChanges, buildMediaKeyChanges, computeMediaKeyDiff, buildCommitTrailer, loadExistingMedia } from '../../lib/save-helpers';
import { extractFrontmatterField, parkOrphanedPhoto, updatePhotoRegistryCache } from '../../lib/photo-parking';
import type { ParkedPhotoEntry } from '../../lib/media-merge';
import sharedKeysData from 'virtual:bike-app/photo-shared-keys';

export const prerender = false;

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
  media: z.array(eventMediaItemSchema).optional(),
  slug: z.string().optional(),
});

export type EventUpdate = z.infer<typeof eventUpdateSchema>;

interface EventBuildResult extends BuildResult {
  oldPosterKey: string | undefined;
  newPosterKey: string | undefined;
  eventSlug: string;
  mergedParked: ParkedPhotoEntry[] | undefined;
  addedMediaKeys: string[];
  removedMediaKeys: string[];
}

function countOrganizerReferences(orgSlug: string, excludeEventId: string): number {
  return adminEvents.filter((e: AdminEvent) => {
    if (e.id === excludeEventId) return false;
    return typeof e.organizer === 'string' && e.organizer === orgSlug;
  }).length;
}

/** Resolve the primary file path for an event. Directory-based events use index.md. */
function resolveEventPath(eventId: string, isDirectory: boolean): string {
  const [year, slug] = eventId.split('/');
  return isDirectory
    ? `${CITY}/events/${year}/${slug}/index.md`
    : `${CITY}/events/${year}/${slug}.md`;
}

export const eventHandlers: SaveHandlers<EventUpdate, EventBuildResult> & WithSlugValidation & WithExistenceCheck & WithAfterCommit<EventBuildResult> = {
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

  getFilePaths: eventOps.getFilePaths,
  computeContentHash: eventOps.computeContentHash,
  buildFreshData: eventOps.buildFreshData,

  async checkExistence(git: IGitService, eventId: string): Promise<Response | null> {
    const [year, slug] = eventId.split('/');
    // Check both flat and directory formats
    const flatPath = `${CITY}/events/${year}/${slug}.md`;
    const dirPath = `${CITY}/events/${year}/${slug}/index.md`;
    const [flat, dir] = await Promise.all([git.readFile(flatPath), git.readFile(dirPath)]);
    if (flat || dir) {
      return jsonError(`Event ${eventId} already exists`, 409);
    }
    return null;
  },

  async buildFileChanges(update, eventId, currentFiles, git) {
    const files: FileChange[] = [];
    const deletePaths: string[] = [];
    const effectivePrimary = resolveEffectivePrimary(currentFiles);
    const isNew = !effectivePrimary;
    const [year, slug] = eventId.split('/');

    // Determine layout: directory if already directory-based or update includes media
    const wasDirectory = currentFiles.primaryFile != null; // primary is index.md path
    const useDirectory = wasDirectory || (update.media != null && update.media.length > 0);
    const eventPath = resolveEventPath(eventId, useDirectory);

    // If switching from flat to directory, delete the old flat file
    if (!isNew && !wasDirectory && useDirectory) {
      deletePaths.push(`${CITY}/events/${year}/${slug}.md`);
    }

    // Detect poster_key change and park orphaned photo
    const oldPosterKey = effectivePrimary
      ? extractFrontmatterField(effectivePrimary.content, 'poster_key')
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
        const orgObj: Record<string, string> = { name: update.organizer.name };
        if (update.organizer.website) orgObj.website = update.organizer.website;
        if (update.organizer.instagram) orgObj.instagram = update.organizer.instagram;
        fm.organizer = orgObj;

        const orgFilePath = `${CITY}/organizers/${orgSlug}.md`;
        const existingOrg = await git.readFile(orgFilePath);
        if (existingOrg) {
          deletePaths.push(orgFilePath);
        }
      } else {
        fm.organizer = orgSlug;

        const orgFm: Record<string, string> = { name: update.organizer.name };
        if (update.organizer.website) orgFm.website = update.organizer.website;
        if (update.organizer.instagram) orgFm.instagram = update.organizer.instagram;

        const orgContent = serializeMdFile(orgFm);
        files.push({ path: `${CITY}/organizers/${orgSlug}.md`, content: orgContent });
      }
    }

    // Serialize event file
    files.unshift({ path: eventPath, content: serializeMdFile(fm, update.body) });

    // Build media.yml for directory-based events
    let addedMediaKeys: string[] = [];
    let removedMediaKeys: string[] = [];
    if (useDirectory && update.media) {
      const dirBase = `${CITY}/events/${year}/${slug}`;
      const mediaPath = `${dirBase}/media.yml`;
      const existingMedia = loadExistingMedia(currentFiles.auxiliaryFiles);
      ({ addedKeys: addedMediaKeys, removedKeys: removedMediaKeys } = computeMediaKeyDiff(existingMedia, update.media));

      if (update.media.length > 0) {
        const mediaItems = update.media.map(m => {
          const entry: Record<string, unknown> = { key: m.key };
          if (m.caption != null) entry.caption = m.caption;
          if (m.cover != null) entry.cover = m.cover;
          if (m.width != null) entry.width = m.width;
          if (m.height != null) entry.height = m.height;
          if (m.lat != null) entry.lat = m.lat;
          if (m.lng != null) entry.lng = m.lng;
          if (m.type != null) entry.type = m.type;
          return entry;
        });
        files.push({ path: mediaPath, content: serializeYamlFile(mediaItems) });
      } else if (existingMedia.length > 0) {
        deletePaths.push(mediaPath);
      }
    }

    return {
      files, deletePaths, isNew,
      oldPosterKey, newPosterKey, eventSlug: eventId,
      mergedParked, addedMediaKeys, removedMediaKeys,
    };
  },

  async afterCommit(result, database) {
    const { oldPosterKey, newPosterKey, eventSlug, mergedParked, addedMediaKeys, removedMediaKeys } = result;
    const changes = [
      ...buildPhotoKeyChanges(oldPosterKey, newPosterKey, 'event', eventSlug),
      ...buildMediaKeyChanges(addedMediaKeys, removedMediaKeys, 'event', eventSlug),
    ];
    await updatePhotoRegistryCache({ database, sharedKeysData, keyChanges: changes, mergedParked });
  },

  buildCommitMessage(update, eventId, isNew): string {
    const resourcePath = `${CITY}/events/${eventId}`;
    const title = (update.frontmatter as Record<string, unknown>)?.name as string || eventId;
    const trailer = buildCommitTrailer(resourcePath);
    return isNew ? `Create ${title}${trailer}` : `Update ${title}${trailer}`;
  },

  buildGitHubUrl(eventId: string, baseBranch: string): string {
    const [year, slug] = eventId.split('/');
    return `https://github.com/${env.GIT_OWNER}/${env.GIT_DATA_REPO}/blob/${baseBranch}/${CITY}/events/${year}/${slug}`;
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
  if (params.id === 'new') {
    return saveContent(request, locals, params, 'events', eventHandlers);
  }
  const { checkExistence, ...editHandlers } = eventHandlers;
  return saveContent(request, locals, params, 'events', editHandlers);
}
