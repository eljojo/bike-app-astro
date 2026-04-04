// AGENTS.md: See src/views/api/AGENTS.md for save pipeline rules.
// Key: always merge frontmatter, return new contentHash, cache stores blob SHAs (not commit SHAs).
import type { APIContext } from 'astro';
import { z } from 'zod/v4';
import matter from 'gray-matter';
import { serializeMdFile, serializeYamlFile } from '../../lib/content/file-serializers';
import { mergeMedia } from '../../lib/media/media-merge';
import { CITY } from '../../lib/config/config';
import { jsonError } from '../../lib/api-response';
import { can } from '../../lib/auth/authorize';
import { saveContent } from '../../lib/content/content-save';
import type { SaveHandlers, BuildResult, WithSlugValidation, WithExistenceCheck, WithAfterCommit } from '../../lib/content/content-save';
import type { IGitService, FileChange } from '../../lib/git/git.adapter-github';
import type { AdminEvent } from '../../types/admin';
import { resolveEffectivePrimary } from '../../lib/models/event-model.server';
import { eventMediaItemSchema } from '../../lib/models/event-model';
import { eventOps } from '../../lib/content/content-ops.server';
import { expandSeriesOccurrences } from '../../lib/series-utils';
import { slugify } from '../../lib/slug';
import { buildSingleMediaKeyChanges, buildMediaKeyChanges, computeMediaKeyDiff, loadExistingMedia, afterCommitMediaCleanup, mergeFrontmatter, buildSimpleCommitMessage, buildGitHubUrl as buildGitHubUrlHelper } from '../../lib/content/save-helpers.server';
import { extractFrontmatterField, parkOrphanedMedia } from '../../lib/media/media-parking.server';
import type { ParkedMediaEntry } from '../../lib/media/media-merge';
import { fetchSharedKeysData, fetchJson } from '../../lib/content/load-admin-content.server';

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
    photo_key: z.string().optional(),
    photo_content_type: z.string().optional(),
    photo_width: z.number().optional(),
    photo_height: z.number().optional(),
    isExistingRef: z.boolean().optional(),
  }).optional(),
  media: z.array(eventMediaItemSchema).optional(),
  slug: z.string().optional(),
});

export type EventUpdate = z.infer<typeof eventUpdateSchema>;

interface EventBuildResult extends BuildResult {
  oldPosterKey: string | undefined;
  newPosterKey: string | undefined;
  oldOrgPhotoKey: string | undefined;
  newOrgPhotoKey: string | undefined;
  eventSlug: string;
  mergedParked: ParkedMediaEntry[] | undefined;
  addedMediaKeys: string[];
  removedMediaKeys: string[];
}

/** Resolve the primary file path for an event. Directory-based events use index.md. */
function resolveEventPath(eventId: string, isDirectory: boolean): string {
  const [year, slug] = eventId.split('/');
  return isDirectory
    ? `${CITY}/events/${year}/${slug}/index.md`
    : `${CITY}/events/${year}/${slug}.md`;
}

/**
 * Create event save handlers. Returns a fresh instance per request
 * to safely encapsulate sharedKeysData, adminEvents, and lastOrganizerUpdate
 * from concurrent request contamination.
 */
export function createEventHandlers(
  sharedKeysData: Record<string, Array<{ type: string; slug: string }>> = {},
): SaveHandlers<EventUpdate, EventBuildResult> & WithSlugValidation & WithExistenceCheck & WithAfterCommit<EventBuildResult> {
  // Captured from the current save request so buildFreshData can enrich the D1 cache
  let lastOrganizerUpdate: EventUpdate['organizer'] | undefined;

  return {
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
    buildFreshData(contentId, currentFiles) {
      // Build base cache data from committed git files
      const json = eventOps.buildFreshData(contentId, currentFiles);
      // Enrich organizer: if the git file stores a slug reference but we have
      // the full organizer details from the save payload, embed the inline
      // object in the D1 cache so the editor doesn't depend on the stale
      // build-time organizers virtual module.
      if (lastOrganizerUpdate?.name) {
        const data = JSON.parse(json);
        if (typeof data.organizer === 'string') {
          const org: Record<string, unknown> = { name: lastOrganizerUpdate.name };
          if (lastOrganizerUpdate.website) org.website = lastOrganizerUpdate.website;
          if (lastOrganizerUpdate.instagram) org.instagram = lastOrganizerUpdate.instagram;
          if (lastOrganizerUpdate.photo_key) {
            org.photo_key = lastOrganizerUpdate.photo_key;
            if (lastOrganizerUpdate.photo_content_type) org.photo_content_type = lastOrganizerUpdate.photo_content_type;
            if (lastOrganizerUpdate.photo_width) org.photo_width = lastOrganizerUpdate.photo_width;
            if (lastOrganizerUpdate.photo_height) org.photo_height = lastOrganizerUpdate.photo_height;
          }
          data.organizer = org;
          return JSON.stringify(data);
        }
      }
      return json;
    },

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
      // Capture organizer details for buildFreshData to enrich the D1 cache
      lastOrganizerUpdate = update.organizer;
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

      let mergedParked: ParkedMediaEntry[] | undefined;
      const parked = await parkOrphanedMedia({
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

      // Build the event frontmatter — merge with existing to preserve fields the editor doesn't manage
      const fm: Record<string, unknown> = isNew
        ? { ...update.frontmatter }
        : { ...matter(effectivePrimary!.content).data, ...update.frontmatter };

      // Organizer handling: inline vs separate file
      let oldOrgPhotoKey: string | undefined;
      let newOrgPhotoKey: string | undefined;
      if (update.organizer && update.organizer.name) {
        const orgSlug = update.organizer.slug || slugify(update.organizer.name);
        newOrgPhotoKey = update.organizer.photo_key;

        // Read existing organizer file to detect old photo key for media parking
        const orgFilePath = `${CITY}/organizers/${orgSlug}.md`;
        const existingOrgFile = await git.readFile(orgFilePath);
        if (existingOrgFile) {
          oldOrgPhotoKey = extractFrontmatterField(existingOrgFile.content, 'photo_key');
        }

        // Build organizer fields from the event editor form
        function buildOrgFields(): Record<string, unknown> {
          const fields: Record<string, unknown> = { name: update.organizer!.name };
          if (update.organizer!.website) fields.website = update.organizer!.website;
          if (update.organizer!.instagram) fields.instagram = update.organizer!.instagram;
          if (update.organizer!.photo_key) {
            fields.photo_key = update.organizer!.photo_key;
            if (update.organizer!.photo_content_type) fields.photo_content_type = update.organizer!.photo_content_type;
            if (update.organizer!.photo_width) fields.photo_width = update.organizer!.photo_width;
            if (update.organizer!.photo_height) fields.photo_height = update.organizer!.photo_height;
          }
          return fields;
        }

        // Write organizer file, merging with existing frontmatter and body
        // to preserve fields the event editor doesn't manage (tags, featured,
        // social_links, body text, etc).
        function buildOrgFileChange(): FileChange {
          const orgFields = buildOrgFields();
          const merged = existingOrgFile
            ? mergeFrontmatter(false, existingOrgFile.content, orgFields)
            : orgFields;
          const existingBody = existingOrgFile
            ? matter(existingOrgFile.content).content.trim() || undefined
            : undefined;
          return { path: orgFilePath, content: serializeMdFile(merged, existingBody) };
        }

        if (update.organizer.isExistingRef || existingOrgFile) {
          // Existing organizer file — always write/update as external reference.
          // Never inline+delete an existing file: adminEvents may be stale (prerendered),
          // and the file may contain fields the inline format can't represent.
          fm.organizer = orgSlug;
          files.push(buildOrgFileChange());
        } else {
          // No existing file — new organizer, safe to inline into the event
          fm.organizer = buildOrgFields();
        }

        // Park orphaned organizer photo if key changed
        const orgPhotoParked = await parkOrphanedMedia({
          oldKey: oldOrgPhotoKey,
          newKey: newOrgPhotoKey,
          contentType: 'event',
          contentId: `organizer/${orgSlug}`,
          sharedKeysData,
          git,
        });
        if (orgPhotoParked) {
          if (!mergedParked) mergedParked = [];
          mergedParked.push(...(orgPhotoParked.mergedParked || []));
          files.push(orgPhotoParked.fileChange);
        }
      }

      // Compute start_date/end_date from series occurrences
      if (fm.series) {
        const occurrences = expandSeriesOccurrences(fm as Parameters<typeof expandSeriesOccurrences>[0]);
        if (occurrences.length > 0) {
          fm.start_date = occurrences[0].date;
          fm.end_date = occurrences[occurrences.length - 1].date;
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
          const typedMedia = update.media as Array<{ key: string; type?: 'photo' | 'video'; caption?: string; cover?: boolean; width?: number; height?: number; lat?: number; lng?: number; title?: string; handle?: string; duration?: string; orientation?: string }>;
          const merged = mergeMedia(typedMedia, existingMedia);
          files.push({ path: mediaPath, content: serializeYamlFile(merged) });
        } else if (existingMedia.length > 0) {
          deletePaths.push(mediaPath);
        }
      }

      return {
        files, deletePaths, isNew,
        oldPosterKey, newPosterKey,
        oldOrgPhotoKey, newOrgPhotoKey,
        eventSlug: eventId,
        mergedParked, addedMediaKeys, removedMediaKeys,
      };
    },

    async afterCommit(result, database) {
      const { oldPosterKey, newPosterKey, oldOrgPhotoKey, newOrgPhotoKey, eventSlug, mergedParked, addedMediaKeys, removedMediaKeys } = result;
      const changes = [
        ...buildSingleMediaKeyChanges(oldPosterKey, newPosterKey, 'event', eventSlug),
        ...buildSingleMediaKeyChanges(oldOrgPhotoKey, newOrgPhotoKey, 'event', eventSlug),
        ...buildMediaKeyChanges(addedMediaKeys, removedMediaKeys, 'event', eventSlug),
      ];
      await afterCommitMediaCleanup({ database, sharedKeysData, mediaKeyChanges: changes, mergedParked });
    },

    buildCommitMessage(update, eventId, isNew): string {
      const title = (update.frontmatter as Record<string, unknown>)?.name as string || eventId;
      return buildSimpleCommitMessage(title, `${CITY}/events/${eventId}`, isNew);
    },

    buildGitHubUrl(eventId: string, baseBranch: string): string {
      const [year, slug] = eventId.split('/');
      return buildGitHubUrlHelper(`${CITY}/events/${year}/${slug}`, baseBranch);
    },
  };
}

export function isPastEvent(startDate: string | undefined): boolean {
  if (!startDate) return false;
  const today = new Date().toISOString().slice(0, 10);
  return startDate < today;
}

export async function POST({ params, request, locals }: APIContext) {
  const baseUrl = new URL(request.url);
  const [sharedKeysData, adminEvents] = await Promise.all([
    fetchSharedKeysData(baseUrl),
    fetchJson<{ events: AdminEvent[] }>(new URL('/admin/data/events.json', baseUrl)).then(d => d.events),
  ]);

  const user = locals.user;

  // For existing past events, only admins can edit
  if (params.id && params.id !== 'new') {
    const existing = adminEvents.find((e: AdminEvent) => e.id === params.id);
    if (existing && isPastEvent(existing.start_date) && !can(user, 'edit-past-event')) {
      return jsonError('Only admins can edit past events', 403);
    }
  }

  const handlers = createEventHandlers(sharedKeysData);

  // For new events, checkExistence should run; for existing events, it shouldn't
  if (params.id === 'new') {
    return saveContent(request, locals, params, 'events', handlers);
  }
  const { checkExistence: _checkExistence, ...editHandlers } = handlers;
  return saveContent(request, locals, params, 'events', editHandlers);
}
