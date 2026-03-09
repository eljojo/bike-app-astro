export interface TileCache {
  get(key: string): Promise<ArrayBuffer | null>;
  put(key: string, data: ArrayBuffer | Uint8Array, ttlSeconds: number): Promise<void>;
}
