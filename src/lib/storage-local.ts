import fs from 'node:fs';
import path from 'node:path';

export function createLocalR2(uploadsDir: string) {
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

  return {
    async head(key: string) {
      const filePath = path.join(uploadsDir, key);
      if (!fs.existsSync(filePath)) return null;
      const stat = fs.statSync(filePath);
      return { size: stat.size, httpMetadata: { contentType: 'image/jpeg' } };
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
      return { arrayBuffer: async () => body.buffer, body };
    },
    async delete(key: string) {
      const filePath = path.join(uploadsDir, key);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    },
    async list() {
      return { objects: [] };
    },
  };
}
