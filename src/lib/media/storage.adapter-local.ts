import fs from 'node:fs';
import path from 'node:path';

const EXTENSION_CONTENT_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.heic': 'image/heic',
};

function contentTypeFromKey(key: string): string {
  const ext = path.extname(key).toLowerCase();
  return EXTENSION_CONTENT_TYPES[ext] ?? 'application/octet-stream';
}

export function createLocalBucket(uploadsDir: string) {
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

  return {
    async head(key: string) {
      const filePath = path.join(uploadsDir, key);
      if (!fs.existsSync(filePath)) return null;
      const stat = fs.statSync(filePath);
      return { size: stat.size, httpMetadata: { contentType: contentTypeFromKey(key) } };
    },
    async put(key: string, data: ArrayBuffer | ReadableStream | string | Uint8Array) {
      const filePath = path.join(uploadsDir, key);
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      if (data instanceof ArrayBuffer) {
        fs.writeFileSync(filePath, Buffer.from(data));
      } else if (ArrayBuffer.isView(data)) {
        fs.writeFileSync(filePath, Buffer.from(data.buffer, data.byteOffset, data.byteLength));
      } else if (typeof data === 'string') {
        fs.writeFileSync(filePath, data);
      }
      return {};
    },
    async get(key: string) {
      const filePath = path.join(uploadsDir, key);
      if (!fs.existsSync(filePath)) return null;
      const body = fs.readFileSync(filePath);
      return {
        arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
        body,
      };
    },
    async delete(key: string) {
      const filePath = path.join(uploadsDir, key);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    },
    async list() {
      // Stub: not used by admin features. Implement if needed.
      return { objects: [] };
    },
  };
}
