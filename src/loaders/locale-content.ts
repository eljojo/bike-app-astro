import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import { renderMarkdownHtml } from '../lib/markdown-render';

export interface LocaleContent {
  name?: string;
  tagline?: string;
  body?: string;
  renderedBody?: string;
  [key: string]: any;
}

/**
 * Merge translated content over base content.
 * Translation overrides text fields; base fields are kept as fallback.
 */
export function mergeLocaleContent(base: LocaleContent, translation: LocaleContent | undefined): LocaleContent {
  if (!translation) return base;
  return { ...base, ...Object.fromEntries(Object.entries(translation).filter(([_, v]) => v != null)) };
}

/**
 * Find and parse all locale translations for a content directory.
 * Looks for index.{locale}.md files.
 */
export async function loadLocaleTranslations(dir: string, locales: string[]): Promise<Record<string, LocaleContent>> {
  const result: Record<string, LocaleContent> = {};
  for (const locale of locales) {
    const filePath = path.join(dir, `index.${locale}.md`);
    if (!fs.existsSync(filePath)) continue;
    const raw = fs.readFileSync(filePath, 'utf-8');
    const { data: frontmatter, content: body } = matter(raw);
    const trimmedBody = body.trim();
    const renderedBody = trimmedBody ? await renderMarkdownHtml(trimmedBody) : undefined;
    result[locale] = {
      ...frontmatter,
      ...(trimmedBody ? { body: trimmedBody } : {}),
      ...(renderedBody ? { renderedBody } : {}),
    };
  }
  return result;
}
