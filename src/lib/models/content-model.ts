import type { z } from 'astro/zod';

export interface GitFileSnapshot {
  content: string;
  sha: string;
}

export interface GitFiles {
  primaryFile: GitFileSnapshot | null;
  auxiliaryFiles?: Record<string, GitFileSnapshot | null>;
}

/**
 * Contract that every content model must satisfy. Each content type
 * (route, event, place, ride) exports functions matching this shape,
 * using the naming convention {contentType}DetailSchema, compute{Type}ContentHash, etc.
 *
 * The contract is verified by tests/content-model-contract.test.ts.
 */
export interface ContentModelContract<T, F extends GitFiles = GitFiles> {
  schema: z.ZodType<T>;
  computeContentHash(...contents: (string | undefined)[]): string;
  computeContentHashFromFiles(files: F): string;
  detailFromGit(id: string, frontmatter: Record<string, unknown>, body: string, ...aux: unknown[]): T;
  detailToCache(detail: T): string;
  buildFreshData(id: string, files: F): string;
  detailFromCache(blob: string): T;
}
