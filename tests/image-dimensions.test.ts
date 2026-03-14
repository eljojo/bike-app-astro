import { describe, it, expect } from 'vitest';
import { parseImageDimensions } from '../src/lib/media/image-dimensions';

// Minimal valid 1x1 PNG (67 bytes)
const VALID_PNG = new Uint8Array([
  0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, // PNG signature
  0x00, 0x00, 0x00, 0x0D, // IHDR length
  0x49, 0x48, 0x44, 0x52, // "IHDR"
  0x00, 0x00, 0x00, 0x01, // width: 1
  0x00, 0x00, 0x00, 0x01, // height: 1
  0x08, 0x02,             // bit depth 8, color type 2 (RGB)
  0x00, 0x00, 0x00,       // compression, filter, interlace
  0x90, 0x77, 0x53, 0xDE, // IHDR CRC
  0x00, 0x00, 0x00, 0x0C, // IDAT length
  0x49, 0x44, 0x41, 0x54, // "IDAT"
  0x08, 0xD7, 0x63, 0xF8, 0xCF, 0xC0, 0x00, 0x00,
  0x00, 0x02, 0x00, 0x01, // compressed data
  0xE2, 0x21, 0xBC, 0x33, // IDAT CRC
  0x00, 0x00, 0x00, 0x00, // IEND length
  0x49, 0x45, 0x4E, 0x44, // "IEND"
  0xAE, 0x42, 0x60, 0x82, // IEND CRC
]);

// Minimal valid 1x1 JPEG
// SOI + SOF0 with 1x1 dimensions + EOI
const VALID_JPEG = new Uint8Array([
  0xFF, 0xD8,             // SOI
  0xFF, 0xC0,             // SOF0
  0x00, 0x0B,             // length: 11
  0x08,                   // precision: 8
  0x00, 0x01,             // height: 1
  0x00, 0x01,             // width: 1
  0x01,                   // components: 1
  0x01, 0x11, 0x00,       // component data
  0xFF, 0xD9,             // EOI
]);

// Minimal valid 1x1 WebP (lossy VP8)
const VALID_WEBP = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, // "RIFF"
  0x24, 0x00, 0x00, 0x00, // file size - 8
  0x57, 0x45, 0x42, 0x50, // "WEBP"
  0x56, 0x50, 0x38, 0x20, // "VP8 "
  0x18, 0x00, 0x00, 0x00, // chunk size
  0x30, 0x01, 0x00, 0x9D, 0x01, 0x2A, // VP8 bitstream header
  0x01, 0x00,             // width: 1 (14 bits, little-endian)
  0x01, 0x00,             // height: 1 (14 bits, little-endian)
  // remaining bytes (padding)
  0x01, 0x42, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
]);

describe('parseImageDimensions', () => {
  it('parses PNG dimensions', () => {
    const result = parseImageDimensions(VALID_PNG.buffer);
    expect(result).toEqual({ width: 1, height: 1, format: 'png' });
  });

  it('parses JPEG dimensions', () => {
    const result = parseImageDimensions(VALID_JPEG.buffer);
    expect(result).toEqual({ width: 1, height: 1, format: 'jpeg' });
  });

  it('parses WebP dimensions', () => {
    const result = parseImageDimensions(VALID_WEBP.buffer);
    expect(result).toEqual({ width: 1, height: 1, format: 'webp' });
  });

  it('returns null for non-image data', () => {
    const garbage = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04]);
    expect(parseImageDimensions(garbage.buffer)).toBeNull();
  });

  it('returns null for empty buffer', () => {
    expect(parseImageDimensions(new ArrayBuffer(0))).toBeNull();
  });

  it('returns null for truncated PNG', () => {
    const truncated = VALID_PNG.slice(0, 20);
    expect(parseImageDimensions(truncated.buffer)).toBeNull();
  });
});
