// events.ts — Content collection loader for events.
//
// Reads both flat .md files and directory-based events (index.md + media.yml).
// Media is included in the collection data so views don't need filesystem access
// at prerender time (Workerd can't read the host filesystem).

import type { Loader } from 'astro/loaders';
import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import yaml from 'js-yaml';
import { cityDir } from '../lib/config/config.server';

export interface EventMediaItem {
  type?: string;
  key: string;
  caption?: string;
  width?: number;
  height?: number;
}

function walkMdFiles(dir: string, base: string): { id: string; filePath: string }[] {
  const results: { id: string; filePath: string }[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      results.push(...walkMdFiles(path.join(dir, entry.name), base));
    } else if (entry.isFile() && entry.name.endsWith('.md') && !entry.name.match(/\.\w{2}\.md$/)) {
      const fullPath = path.join(dir, entry.name);
      const rel = path.relative(base, fullPath);
      // ID: strip .md or /index.md to get the slug
      const id = rel.replace(/\/index\.md$/, '').replace(/\.md$/, '');
      results.push({ id, filePath: fullPath });
    }
  }
  return results;
}

export function eventLoader(): Loader {
  return {
    name: 'event-loader',
    load: async ({ store, logger }) => {
      const eventsDir = path.join(cityDir, 'events');
      if (!fs.existsSync(eventsDir)) {
        logger.warn(`Events directory not found: ${eventsDir}`);
        return;
      }

      const files = walkMdFiles(eventsDir, eventsDir);

      for (const { id, filePath } of files) {
        const raw = fs.readFileSync(filePath, 'utf-8');
        let frontmatter: Record<string, unknown>;
        let body: string;
        try {
          const parsed = matter(raw);
          frontmatter = parsed.data;
          body = parsed.content;
        } catch (err) {
          // Malformed community-edited frontmatter degrades to one skipped
          // event, not a dead build. IO errors are not caught here.
          console.error(
            `[event-loader] Malformed frontmatter in event "${id}" (${filePath}): ${(err as Error).message} — skipping event`,
          );
          continue;
        }

        // Read sidecar media.yml for directory-based events
        let media: EventMediaItem[] | undefined;
        const dir = path.dirname(filePath);
        const mediaPath = path.join(dir, 'media.yml');
        if (fs.existsSync(mediaPath)) {
          const mediaRaw = fs.readFileSync(mediaPath, 'utf-8');
          try {
            const parsedMedia = yaml.load(mediaRaw);
            // media.yml must be a list; a mapping or scalar is bad shape → ignore.
            media = Array.isArray(parsedMedia) ? (parsedMedia as EventMediaItem[]) : undefined;
            if (parsedMedia != null && !Array.isArray(parsedMedia)) {
              console.error(
                `[event-loader] media.yml for event "${id}" (${mediaPath}) is not a list — ignoring media`,
              );
            }
          } catch (err) {
            console.error(
              `[event-loader] Malformed media.yml in event "${id}" (${mediaPath}): ${(err as Error).message} — ignoring media`,
            );
          }
        }

        store.set({
          id,
          data: { ...frontmatter, media },
          body,
        });
      }

      logger.info(`Loaded ${files.length} events`);
    },
  };
}
