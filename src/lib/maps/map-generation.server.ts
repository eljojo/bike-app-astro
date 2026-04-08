/**
 * GPX content hashing — used by manifest generation.
 */
import crypto from 'node:crypto';

export function gpxHash(gpxContent: string): string {
  return crypto.createHash('sha256').update(gpxContent).digest('hex').slice(0, 16);
}
