import type { TileCache } from './tile-cache';

interface KVNamespace {
  get(key: string, type: 'arrayBuffer'): Promise<ArrayBuffer | null>;
  put(key: string, value: ArrayBuffer, options?: { expirationTtl?: number }): Promise<void>;
}

export function createKvTileCache(kv: KVNamespace): TileCache {
  return {
    async get(key: string): Promise<ArrayBuffer | null> {
      return kv.get(`tile:${key}`, 'arrayBuffer');
    },
    async put(key: string, data: ArrayBuffer | Uint8Array, ttlSeconds: number): Promise<void> {
      const buf = data instanceof Uint8Array
        ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer
        : data;
      await kv.put(`tile:${key}`, buf, { expirationTtl: ttlSeconds });
    },
  };
}
