export const prerender = false;

import type { APIContext } from 'astro';
import fs from 'node:fs';
import path from 'node:path';

const UPLOADS_DIR =
  process.env.LOCAL_UPLOADS_DIR ||
  path.resolve(import.meta.dirname, '..', '..', '..', '.data', 'uploads');

export async function GET({ params }: APIContext) {
  if (process.env.RUNTIME !== 'local') {
    return new Response('Not available', { status: 404 });
  }

  const reqPath = params.path;
  if (!reqPath) return new Response('Not found', { status: 404 });

  // Handle cdn-cgi/image/{transforms}/{blobKey} pattern
  const cdnMatch = reqPath.match(/^cdn-cgi\/image\/([^/]+)\/(.+)$/);
  if (cdnMatch) {
    const [, transformStr, blobKey] = cdnMatch;
    return serveTransformed(blobKey, transformStr);
  }

  // Direct file serving
  return serveRaw(reqPath);
}

function resolveFile(filePath: string): string | null {
  const fullPath = path.join(UPLOADS_DIR, filePath);
  if (!fullPath.startsWith(UPLOADS_DIR)) return null;
  if (!fs.existsSync(fullPath)) return null;
  return fullPath;
}

function serveRaw(filePath: string): Response {
  const fullPath = resolveFile(filePath);
  if (!fullPath) return new Response('Not found', { status: 404 });

  const data = fs.readFileSync(fullPath);
  return new Response(data, {
    headers: {
      'Content-Type': mimeType(fullPath),
      'Cache-Control': 'no-cache',
    },
  });
}

async function serveTransformed(blobKey: string, transformStr: string): Promise<Response> {
  const fullPath = resolveFile(blobKey);
  if (!fullPath) return new Response('Not found', { status: 404 });

  const transforms = parseTransforms(transformStr);
  const sharp = (await import('sharp')).default;

  let pipeline = sharp(fullPath);

  if (transforms.width || transforms.height) {
    pipeline = pipeline.resize({
      width: transforms.width,
      height: transforms.height,
      fit: transforms.fit || 'cover',
    });
  }

  const buffer = await pipeline.webp({ quality: 80 }).toBuffer();

  return new Response(buffer, {
    headers: {
      'Content-Type': 'image/webp',
      'Cache-Control': 'no-cache',
    },
  });
}

function parseTransforms(str: string): { width?: number; height?: number; fit?: string } {
  const result: Record<string, string> = {};
  for (const part of str.split(',')) {
    const [key, val] = part.split('=');
    if (key && val) result[key] = val;
  }
  return {
    width: result.width ? parseInt(result.width, 10) : undefined,
    height: result.height ? parseInt(result.height, 10) : undefined,
    fit: result.fit,
  };
}

function mimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const types: Record<string, string> = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.heic': 'image/heic',
  };
  return types[ext] || 'application/octet-stream';
}
