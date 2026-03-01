import type { Loader } from 'astro/loaders';
import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import { marked } from 'marked';
import { cityDir } from '../lib/config';

export function pageLoader(): Loader {
  return {
    name: 'page-loader',
    load: async ({ store, logger }) => {
      const pagesDir = path.join(cityDir, 'pages');
      if (!fs.existsSync(pagesDir)) {
        logger.warn(`Pages directory not found: ${pagesDir}`);
        return;
      }

      // Match files like about.md but NOT about.fr.md
      const files = fs.readdirSync(pagesDir).filter(f =>
        f.endsWith('.md') && !f.slice(0, -3).includes('.')
      );

      for (const file of files) {
        const slug = file.replace('.md', '');
        const filePath = path.join(pagesDir, file);
        const raw = fs.readFileSync(filePath, 'utf-8');
        const { data: frontmatter, content: body } = matter(raw);
        const renderedBody = await marked.parse(body);

        // Look for locale translations (e.g. about.fr.md)
        const translations: Record<string, { title?: string; renderedBody: string }> = {};
        const localeFiles = fs.readdirSync(pagesDir).filter(f =>
          f.startsWith(`${slug}.`) && f.endsWith('.md') && f !== file
        );
        for (const lf of localeFiles) {
          const locale = lf.replace(`${slug}.`, '').replace('.md', '');
          const lfPath = path.join(pagesDir, lf);
          const lfRaw = fs.readFileSync(lfPath, 'utf-8');
          const { data: lfFrontmatter, content: lfBody } = matter(lfRaw);
          translations[locale] = {
            title: lfFrontmatter.title,
            renderedBody: await marked.parse(lfBody),
          };
        }

        store.set({
          id: slug,
          data: { ...frontmatter, renderedBody, translations },
          body,
        });
      }

      logger.info(`Loaded ${files.length} pages`);
    },
  };
}
