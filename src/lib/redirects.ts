import yaml from 'js-yaml';
import type { FileChange } from './git/git.adapter-github';
import { CITY } from './config/config';

interface RedirectEntry {
  from: string;
  to: string;
}

/**
 * Update redirects.yml content with a new redirect entry.
 * Handles chain collapsing and duplicate detection.
 */
export function updateRedirectsYaml(
  existingContent: string,
  section: string,
  fromSlug: string,
  toSlug: string,
): string {
  const data = (existingContent ? yaml.load(existingContent) : {}) as Record<string, RedirectEntry[]> || {};

  if (!data[section]) {
    data[section] = [];
  }

  const entries = data[section];

  // Check for duplicate
  if (entries.some(e => e.from === fromSlug && e.to === toSlug)) {
    return existingContent;
  }

  // Collapse chains: if any entry points TO fromSlug, update it to point to toSlug
  for (const entry of entries) {
    if (entry.to === fromSlug) {
      entry.to = toSlug;
    }
  }

  // Add new entry
  entries.push({ from: fromSlug, to: toSlug });

  return yaml.dump(data, { lineWidth: -1 });
}

/**
 * Build a FileChange that adds a redirect entry to the city's redirects.yml.
 * Reads the current file via git, applies the redirect, returns the updated file.
 */
export async function buildRedirectFileChange(
  git: { readFile(path: string): Promise<{ content: string } | null> },
  section: string,
  fromSlug: string,
  toSlug: string,
): Promise<FileChange> {
  const redirectsPath = `${CITY}/redirects.yml`;
  const existing = await git.readFile(redirectsPath);
  const content = updateRedirectsYaml(existing?.content || '', section, fromSlug, toSlug);
  return { path: redirectsPath, content };
}
