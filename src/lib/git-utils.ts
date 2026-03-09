import { createHash } from 'node:crypto';

/** Compute the SHA-1 blob hash matching Git's `git hash-object` format. */
export function computeBlobSha(content: string): string {
  return createHash('sha1')
    .update(`blob ${Buffer.byteLength(content)}\0${content}`)
    .digest('hex');
}
