import yaml from 'js-yaml';

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
