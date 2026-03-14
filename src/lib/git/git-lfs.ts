/**
 * Git LFS Batch API integration.
 *
 * Uploads file content to GitHub's LFS storage and returns
 * a pointer file string for committing instead of raw content.
 * This ensures GPX files are stored as LFS objects, not git blobs.
 *
 * Spec: https://github.com/git-lfs/git-lfs/blob/main/docs/api/batch.md
 */

import { createHash } from 'node:crypto';

const GITHUB_LFS_ENDPOINT = 'https://github.com';

export function buildLfsPointer(oid: string, size: number): string {
  return (
    'version https://git-lfs.github.com/spec/v1\n' +
    `oid sha256:${oid}\n` +
    `size ${size}\n`
  );
}

/**
 * Upload content to Git LFS and return the pointer file text.
 *
 * Flow:
 * 1. Compute SHA-256 of content
 * 2. POST to LFS Batch API to get upload URL
 * 3. PUT content to the presigned upload URL
 * 4. Call verify endpoint if provided
 * 5. Return pointer text for git commit
 */
export async function uploadToLfs(
  token: string,
  owner: string,
  repo: string,
  content: string,
): Promise<string> {
  const contentBytes = new TextEncoder().encode(content);
  const size = contentBytes.byteLength;
  const oid = createHash('sha256').update(contentBytes).digest('hex');

  // 1. Request upload via LFS Batch API
  // LFS uses Basic auth: base64("username:token")
  const basicAuth = btoa(`${owner}:${token}`);

  const batchResponse = await fetch(
    `${GITHUB_LFS_ENDPOINT}/${owner}/${repo}.git/info/lfs/objects/batch`,
    {
      method: 'POST',
      headers: {
        'Accept': 'application/vnd.git-lfs+json',
        'Content-Type': 'application/vnd.git-lfs+json',
        'Authorization': `Basic ${basicAuth}`,
        'User-Agent': 'whereto-bike',
      },
      body: JSON.stringify({
        operation: 'upload',
        transfers: ['basic'],
        objects: [{ oid, size }],
      }),
    }
  );

  if (!batchResponse.ok) {
    const text = await batchResponse.text();
    throw new Error(`LFS batch API error: ${batchResponse.status} — ${text}`);
  }

  const batchData = await batchResponse.json();
  const obj = batchData.objects?.[0];

  if (obj?.error) {
    throw new Error(`LFS object error: ${obj.error.message}`);
  }

  // 2. Upload content if needed (object may already exist)
  const uploadAction = obj?.actions?.upload;
  if (uploadAction) {
    const uploadHeaders: Record<string, string> = {
      'Content-Type': 'application/octet-stream',
      'User-Agent': 'whereto-bike',
      ...(uploadAction.header || {}),
    };

    const uploadResponse = await fetch(uploadAction.href, {
      method: 'PUT',
      headers: uploadHeaders,
      body: contentBytes,
    });

    if (!uploadResponse.ok) {
      throw new Error(`LFS upload failed: ${uploadResponse.status} ${uploadResponse.statusText}`);
    }

    // 3. Verify if endpoint provided
    const verifyAction = obj?.actions?.verify;
    if (verifyAction) {
      const verifyHeaders: Record<string, string> = {
        'Accept': 'application/vnd.git-lfs+json',
        'Content-Type': 'application/vnd.git-lfs+json',
        'Authorization': `Basic ${basicAuth}`,
        'User-Agent': 'whereto-bike',
        ...(verifyAction.header || {}),
      };

      const verifyResponse = await fetch(verifyAction.href, {
        method: 'POST',
        headers: verifyHeaders,
        body: JSON.stringify({ oid, size }),
      });

      if (!verifyResponse.ok) {
        const body = await verifyResponse.text();
        throw new Error(`LFS verify failed: ${verifyResponse.status} — ${body}`);
      }
    }
  }

  // 4. Return pointer text
  return buildLfsPointer(oid, size);
}
