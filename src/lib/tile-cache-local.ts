import fs from 'node:fs';
import path from 'node:path';
import type { TileCache } from './tile-cache';

export function createLocalTileCache(cacheDir: string): TileCache {
  fs.mkdirSync(cacheDir, { recursive: true });

  function filePath(key: string): string {
    return path.join(cacheDir, key.replace(/[^a-zA-Z0-9._\-/]/g, '_'));
  }

  function metaPath(key: string): string {
    return filePath(key) + '.meta';
  }

  return {
    async get(key: string): Promise<ArrayBuffer | null> {
      const fp = filePath(key);
      const mp = metaPath(key);
      if (!fs.existsSync(fp) || !fs.existsSync(mp)) return null;

      const meta = JSON.parse(fs.readFileSync(mp, 'utf-8'));
      if (Date.now() >= meta.expiresAt) {
        fs.unlinkSync(fp);
        fs.unlinkSync(mp);
        return null;
      }

      const buf = fs.readFileSync(fp);
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    },

    async put(key: string, data: ArrayBuffer | Uint8Array, ttlSeconds: number): Promise<void> {
      const fp = filePath(key);
      fs.mkdirSync(path.dirname(fp), { recursive: true });
      fs.writeFileSync(fp, new Uint8Array(data));
      fs.writeFileSync(metaPath(key), JSON.stringify({
        expiresAt: Date.now() + ttlSeconds * 1000,
      }));
    },
  };
}
