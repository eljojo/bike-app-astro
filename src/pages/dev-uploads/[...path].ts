export const prerender = false;

import type { APIContext } from 'astro';
import fs from 'node:fs';
import path from 'node:path';

export async function GET({ params }: APIContext) {
  if (process.env.RUNTIME !== 'local') {
    return new Response('Not available', { status: 404 });
  }

  const filePath = params.path;
  if (!filePath) return new Response('Not found', { status: 404 });

  const uploadsDir =
    process.env.LOCAL_UPLOADS_DIR ||
    path.resolve(import.meta.dirname, '..', '..', '..', '.data', 'uploads');
  const fullPath = path.join(uploadsDir, filePath);

  if (!fullPath.startsWith(uploadsDir)) {
    return new Response('Forbidden', { status: 403 });
  }

  if (!fs.existsSync(fullPath)) {
    return new Response('Not found', { status: 404 });
  }

  const data = fs.readFileSync(fullPath);
  const ext = path.extname(fullPath).toLowerCase();
  const contentTypes: Record<string, string> = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.heic': 'image/heic',
  };

  return new Response(data, {
    headers: {
      'Content-Type': contentTypes[ext] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    },
  });
}
