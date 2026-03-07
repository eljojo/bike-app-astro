import { describe, it, expect } from 'vitest';
import { extractGpsCoordinates } from '../../src/lib/exif';

describe('extractGpsCoordinates', () => {
  it('returns null for a PNG buffer (no EXIF)', () => {
    // Minimal valid PNG: 8-byte signature + IHDR + IEND
    const png = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG signature
      0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, // IHDR chunk
      0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, // 1x1
      0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, 0xde,
      0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, // IEND
      0xae, 0x42, 0x60, 0x82,
    ]);
    const result = extractGpsCoordinates(png.buffer);
    expect(result).toBeNull();
  });

  it('returns null for an empty buffer', () => {
    const result = extractGpsCoordinates(new ArrayBuffer(0));
    expect(result).toBeNull();
  });

  it('returns null for a JPEG without GPS EXIF data', () => {
    // Minimal JPEG: SOI + EOI (no EXIF APP1 segment)
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
    const result = extractGpsCoordinates(jpeg.buffer);
    expect(result).toBeNull();
  });
});
