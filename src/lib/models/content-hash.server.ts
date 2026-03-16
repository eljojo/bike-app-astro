import { createHash } from 'node:crypto';

/** MD5 hash from one or more content parts. Used for content change detection. */
export function computeHashFromParts(...parts: (string | undefined)[]): string {
  const hash = createHash('md5');
  for (const part of parts) {
    if (part !== undefined) hash.update(part);
  }
  return hash.digest('hex');
}
