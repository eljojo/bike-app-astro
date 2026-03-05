import type { APIContext } from 'astro';
import matter from 'gray-matter';
import yaml from 'js-yaml';
import adminEvents from 'virtual:bike-app/admin-events';
import { GIT_OWNER, GIT_DATA_REPO, CITY } from '../../lib/config';
import { jsonError } from '../../lib/api-response';
import { saveContent } from '../../lib/content-save';
import type { SaveHandlers, CurrentFiles } from '../../lib/content-save';
import type { IGitService, FileChange } from '../../lib/git-service';
import type { AdminEvent } from '../../types/admin';
import { eventDetailFromGit, eventDetailToCache, computeEventContentHash } from '../../lib/models/event-model';
import { slugify } from '../../lib/slug';

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

const eventHandlers: SaveHandlers<EventUpdate> = {
  parseRequest(body: unknown): EventUpdate {
    return body as EventUpdate;
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
    if (!slug || slug.length < 2) return 'Invalid slug';
    return null;
  },

  getFilePaths(eventId: string) {
    return { primary: resolveEventPath(eventId) };
  },

  computeContentHash(currentFiles: CurrentFiles): string {
    return computeEventContentHash(currentFiles.primaryFile!.content);
  },

  buildFreshData(eventId: string, currentFiles: CurrentFiles): string {
    const { data: ghFm, content: ghBody } = matter(currentFiles.primaryFile!.content);
    const detail = eventDetailFromGit(eventId, ghFm, ghBody);
    return eventDetailToCache(detail);
  },

  async checkExistence(git: IGitService, eventId: string): Promise<Response | null> {
    // Only check for new events (the pipeline calls this conditionally)
    // We need to determine if this is a new event by checking params
    // The pipeline passes contentId which for new events is the resolved year/slug
    const eventPath = resolveEventPath(eventId);
    const existing = await git.readFile(eventPath);
    if (existing) {
      return jsonError(`Event ${eventId} already exists`, 409);
    }
    return null;
  },

  async buildFileChanges(update, eventId, currentFiles, git): Promise<{ files: FileChange[]; deletePaths: string[]; isNew: boolean }> {
    const eventPath = resolveEventPath(eventId);
    const files: FileChange[] = [];
    const deletePaths: string[] = [];
    const isNew = !currentFiles.primaryFile;

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

    return { files, deletePaths, isNew };
  },

  buildCommitMessage(_update, eventId, isNew): string {
    const resourcePath = `${CITY}/events/${eventId}`;
    return isNew ? `Create ${resourcePath}` : `Update ${resourcePath}`;
  },

  buildCacheData(update, eventId): string {
    const fm: Record<string, unknown> = { ...update.frontmatter };
    if (update.organizer && update.organizer.name) {
      const orgSlug = update.organizer.slug || slugify(update.organizer.name);
      const otherRefs = countOrganizerReferences(orgSlug, eventId);
      if (otherRefs === 0) {
        const orgObj: Record<string, string> = { name: update.organizer.name };
        if (update.organizer.website) orgObj.website = update.organizer.website;
        if (update.organizer.instagram) orgObj.instagram = update.organizer.instagram;
        fm.organizer = orgObj;
      } else {
        fm.organizer = orgSlug;
      }
    }
    const detail = eventDetailFromGit(eventId, fm, update.body);
    return eventDetailToCache(detail);
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
    if (existing && isPastEvent(existing.start_date) && user?.role !== 'admin') {
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
