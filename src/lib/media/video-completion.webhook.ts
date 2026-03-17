import { eq, and } from 'drizzle-orm';
import yaml from 'js-yaml';
import { videoJobs, contentEdits } from '../../db/schema';
import { CITY } from '../config/config';
import { env } from '../env/env.service';
import { createGitService } from '../git/git-factory';
import { commitToContentRepo } from '../git/commit';
import { db } from '../get-db';
import { serializeYamlFile } from '../content/file-serializers';
import { upsertContentCache } from '../content/cache';
import { buildVideoMetadata } from './video-metadata';
import { bareVideoKey } from './video-service';
import { computeBlobSha } from '../git/git-utils';
import { rideFilePathsFromRelPath, deriveGpxRelativePath } from '../ride-paths';
import { rideDetailFromCache } from '../models/ride-model';

interface WebhookPersistResult {
  persisted: boolean;
  reason?: string;
}

/**
 * After the webhook updates a videoJobs row to 'ready', attempt to persist
 * the metadata into the content's media.yml in git.
 *
 * Returns { persisted: true } if metadata was committed, or
 * { persisted: false, reason } if the video isn't in git yet (user hasn't saved).
 */
export async function persistVideoMetadataToGit(
  videoKey: string,
): Promise<WebhookPersistResult> {
  const database = db();

  // 1. Load the videoJobs row
  const job = await database.select().from(videoJobs)
    .where(eq(videoJobs.key, videoKey))
    .get();
  if (!job || job.status !== 'ready') {
    return { persisted: false, reason: 'Job not found or not ready' };
  }

  const contentType = job.contentKind === 'ride' ? 'rides' : 'routes';
  const contentSlug = job.contentSlug;
  const metadata = buildVideoMetadata(job);

  // 2. Determine media.yml path
  const mediaPath = job.contentKind === 'ride'
    ? await resolveRideMediaPath(database, contentSlug)
    : `${CITY}/routes/${contentSlug}/media.yml`;

  if (!mediaPath) {
    return { persisted: false, reason: 'Could not resolve media path for ride' };
  }

  // 3. Read media.yml from git
  const baseBranch = env.GIT_BRANCH || 'main';
  const git = createGitService({
    token: env.GITHUB_TOKEN,
    owner: env.GIT_OWNER,
    repo: env.GIT_DATA_REPO,
    branch: baseBranch,
  });

  const mediaFile = await git.readFile(mediaPath);
  if (!mediaFile) {
    return { persisted: false, reason: 'Media file not found in git — user has not saved yet' };
  }

  // 4. Parse media.yml and find the video entry
  const mediaEntries = yaml.load(mediaFile.content) as Array<Record<string, unknown>> | null;
  if (!mediaEntries || !Array.isArray(mediaEntries)) {
    return { persisted: false, reason: 'Invalid media.yml' };
  }

  const videoIndex = mediaEntries.findIndex(e => bareVideoKey(e.key as string) === videoKey);
  if (videoIndex === -1) {
    return { persisted: false, reason: 'Video key not found in media.yml' };
  }

  // 5. Merge metadata into the entry
  mediaEntries[videoIndex] = { ...mediaEntries[videoIndex], ...metadata };

  // 6. Commit to git
  const updatedContent = serializeYamlFile(mediaEntries);
  const message = `Add video metadata for ${job.title || videoKey}`;
  const authorInfo = { name: 'whereto.bike', email: 'bot@whereto.bike' };

  await commitToContentRepo(
    message,
    [{ path: mediaPath, content: updatedContent }],
    authorInfo,
    git,
  );

  // 7. Update D1 cache if it exists (refresh the cached media data)
  const cached = await database.select().from(contentEdits)
    .where(and(
      eq(contentEdits.city, CITY),
      eq(contentEdits.contentType, contentType),
      eq(contentEdits.contentSlug, contentSlug),
    ))
    .get();

  if (cached) {
    try {
      const cachedData = JSON.parse(cached.data);
      if (cachedData.media && Array.isArray(cachedData.media)) {
        const cachedVideoIndex = cachedData.media.findIndex((e: Record<string, unknown>) => bareVideoKey(e.key as string) === videoKey);
        if (cachedVideoIndex !== -1) {
          cachedData.media[cachedVideoIndex] = { ...cachedData.media[cachedVideoIndex], ...metadata };
          await upsertContentCache(database, {
            contentType,
            contentSlug,
            data: JSON.stringify(cachedData),
            githubSha: computeBlobSha(updatedContent),
          });
        }
      }
    } catch {
      // Cache update is best-effort — the git commit is what matters
    }
  }

  // 8. Delete the consumed videoJobs row
  await database.delete(videoJobs).where(eq(videoJobs.key, videoKey));

  return { persisted: true };
}

/**
 * Resolve ride media path by looking up the D1 cache for the ride's data,
 * then deriving the gpxRelativePath from ride_date + variants + tour_slug.
 */
async function resolveRideMediaPath(database: ReturnType<typeof db>, contentSlug: string): Promise<string | null> {
  const cached = await database.select().from(contentEdits)
    .where(and(
      eq(contentEdits.city, CITY),
      eq(contentEdits.contentType, 'rides'),
      eq(contentEdits.contentSlug, contentSlug),
    ))
    .get();

  if (!cached) return null;

  try {
    const detail = rideDetailFromCache(cached.data);
    const gpxFilename = detail.variants?.[0]?.gpx;
    if (!detail.ride_date || !gpxFilename) return null;

    const gpxRelPath = deriveGpxRelativePath(detail.ride_date, gpxFilename, detail.tour_slug);
    return rideFilePathsFromRelPath(gpxRelPath, CITY).media;
  } catch {
    return null;
  }
}
