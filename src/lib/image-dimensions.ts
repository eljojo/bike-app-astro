/**
 * Parse image dimensions from raw bytes. Pure JS — no dependencies.
 * Supports JPEG, PNG, and WebP. Returns null for invalid/unrecognized data.
 */

export interface ImageDimensions {
  width: number;
  height: number;
  format: 'jpeg' | 'png' | 'webp';
}

export function parseImageDimensions(buffer: ArrayBuffer): ImageDimensions | null {
  const bytes = new Uint8Array(buffer);
  if (bytes.length < 12) return null;

  // PNG: 8-byte signature then IHDR with width at byte 16, height at byte 20
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) {
    return parsePng(bytes);
  }

  // JPEG: starts with FF D8
  if (bytes[0] === 0xFF && bytes[1] === 0xD8) {
    return parseJpeg(bytes);
  }

  // WebP: starts with "RIFF" ... "WEBP"
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
      bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
    return parseWebP(bytes);
  }

  return null;
}

function parsePng(bytes: Uint8Array): ImageDimensions | null {
  // IHDR chunk starts at byte 8 (4 length + 4 type + 4 width + 4 height)
  if (bytes.length < 24) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  if (width === 0 || height === 0) return null;
  return { width, height, format: 'png' };
}

function parseJpeg(bytes: Uint8Array): ImageDimensions | null {
  // Scan for SOF0 (0xFFC0) or SOF2 (0xFFC2) marker
  let offset = 2;
  while (offset < bytes.length - 9) {
    if (bytes[offset] !== 0xFF) return null;
    const marker = bytes[offset + 1];
    // SOF0 or SOF2 — frame header contains dimensions
    if (marker === 0xC0 || marker === 0xC2) {
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const height = view.getUint16(offset + 5);
      const width = view.getUint16(offset + 7);
      if (width === 0 || height === 0) return null;
      return { width, height, format: 'jpeg' };
    }
    // Skip to next marker
    if (marker === 0xD9) return null; // EOI — end of image
    if (marker === 0xD8 || (marker >= 0xD0 && marker <= 0xD7)) {
      offset += 2; // standalone markers (no length)
    } else {
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const segmentLen = view.getUint16(offset + 2);
      offset += 2 + segmentLen;
    }
  }
  return null;
}

function parseWebP(bytes: Uint8Array): ImageDimensions | null {
  if (bytes.length < 30) return null;
  const chunk = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]);

  if (chunk === 'VP8 ') {
    // Lossy WebP: dimensions at offset 26-29 (little-endian 14-bit values)
    if (bytes.length < 30) return null;
    const width = (bytes[26] | (bytes[27] << 8)) & 0x3FFF;
    const height = (bytes[28] | (bytes[29] << 8)) & 0x3FFF;
    if (width === 0 || height === 0) return null;
    return { width, height, format: 'webp' };
  }

  if (chunk === 'VP8L') {
    // Lossless WebP: dimensions packed in 4 bytes starting at offset 21
    if (bytes.length < 25) return null;
    const b0 = bytes[21], b1 = bytes[22], b2 = bytes[23], b3 = bytes[24];
    const width = ((b0 | (b1 << 8)) & 0x3FFF) + 1;
    const height = (((b1 >> 6) | (b2 << 2) | (b3 << 10)) & 0x3FFF) + 1;
    if (width === 0 || height === 0) return null;
    return { width, height, format: 'webp' };
  }

  if (chunk === 'VP8X') {
    // Extended WebP: canvas dimensions at offset 24-29
    if (bytes.length < 30) return null;
    const width = (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16)) + 1;
    const height = (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16)) + 1;
    if (width === 0 || height === 0) return null;
    return { width, height, format: 'webp' };
  }

  return null;
}
