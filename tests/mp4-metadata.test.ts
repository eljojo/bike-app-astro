import { describe, it, expect } from 'vitest';
import { extractVideoMetadata } from '../src/lib/mp4-metadata';

// Helper to build a minimal MP4 atom structure
function buildAtom(type: string, content: Uint8Array): Uint8Array {
  const size = 8 + content.byteLength;
  const header = new Uint8Array(8);
  const view = new DataView(header.buffer);
  view.setUint32(0, size);
  header[4] = type.charCodeAt(0);
  header[5] = type.charCodeAt(1);
  header[6] = type.charCodeAt(2);
  header[7] = type.charCodeAt(3);
  const result = new Uint8Array(size);
  result.set(header, 0);
  result.set(content, 8);
  return result;
}

function buildMvhd(opts: { creationTime: number; timescale: number; duration: number }): Uint8Array {
  // Version 0 mvhd: version(1) + flags(3) + creation_time(4) + mod_time(4) + timescale(4) + duration(4) = 20 bytes minimum
  const data = new Uint8Array(20);
  const view = new DataView(data.buffer);
  view.setUint8(0, 0); // version 0
  // flags: 0,0,0
  view.setUint32(4, opts.creationTime); // creation_time
  view.setUint32(8, 0); // modification_time
  view.setUint32(12, opts.timescale); // timescale
  view.setUint32(16, opts.duration); // duration
  return data;
}

function buildTkhd(opts: { width: number; height: number }): Uint8Array {
  // Version 0 tkhd: 84 bytes minimum
  const data = new Uint8Array(84);
  const view = new DataView(data.buffer);
  view.setUint8(0, 0); // version 0
  // Width and height at offsets 76 and 80 in 16.16 fixed-point
  view.setUint32(76, opts.width << 16);
  view.setUint32(80, opts.height << 16);
  return data;
}

function buildXyzAtom(gpsText: string): Uint8Array {
  const textBytes = new TextEncoder().encode(gpsText);
  // 2 bytes length + 2 bytes language + text
  const content = new Uint8Array(4 + textBytes.byteLength);
  const view = new DataView(content.buffer);
  view.setUint16(0, textBytes.byteLength);
  view.setUint16(2, 0); // language
  content.set(textBytes, 4);
  return content;
}

function buildMoov(opts: {
  width: number;
  height: number;
  timescale?: number;
  duration?: number;
  creationTime?: number;
  gps?: string;
}): Uint8Array {
  const parts: Uint8Array[] = [];

  // mvhd
  const mvhd = buildMvhd({
    creationTime: opts.creationTime || 0,
    timescale: opts.timescale || 600,
    duration: opts.duration || 18600, // 31 seconds at 600 timescale
  });
  parts.push(buildAtom('mvhd', mvhd));

  // trak → tkhd
  const tkhd = buildTkhd({ width: opts.width, height: opts.height });
  const tkhdAtom = buildAtom('tkhd', tkhd);
  parts.push(buildAtom('trak', tkhdAtom));

  // udta → ©xyz
  if (opts.gps) {
    const xyzContent = buildXyzAtom(opts.gps);
    const xyzAtom = buildAtom('\u00A9xyz', xyzContent);
    parts.push(buildAtom('udta', xyzAtom));
  }

  // Combine all parts
  let totalLen = 0;
  for (const p of parts) totalLen += p.byteLength;
  const combined = new Uint8Array(totalLen);
  let offset = 0;
  for (const p of parts) {
    combined.set(p, offset);
    offset += p.byteLength;
  }

  return buildAtom('moov', combined);
}

function moovToFile(moov: Uint8Array): File {
  // Add ftyp atom before moov
  const ftyp = buildAtom('ftyp', new TextEncoder().encode('isom\x00\x00\x02\x00'));
  const buf = new Uint8Array(ftyp.byteLength + moov.byteLength);
  buf.set(ftyp, 0);
  buf.set(moov, ftyp.byteLength);
  return new File([buf], 'test.mp4', { type: 'video/mp4' });
}

describe('extractVideoMetadata', () => {
  it('extracts dimensions from tkhd', async () => {
    const moov = buildMoov({ width: 1920, height: 1080 });
    const file = moovToFile(moov);
    const meta = await extractVideoMetadata(file);
    expect(meta).not.toBeNull();
    expect(meta!.width).toBe(1920);
    expect(meta!.height).toBe(1080);
  });

  it('extracts duration from mvhd', async () => {
    const moov = buildMoov({ width: 1920, height: 1080, timescale: 600, duration: 18600 });
    const file = moovToFile(moov);
    const meta = await extractVideoMetadata(file);
    expect(meta!.duration).toBe(31);
  });

  it('extracts GPS from ©xyz', async () => {
    const moov = buildMoov({ width: 1920, height: 1080, gps: '+45.4215-075.6972/' });
    const file = moovToFile(moov);
    const meta = await extractVideoMetadata(file);
    expect(meta!.lat).toBeCloseTo(45.4215, 4);
    expect(meta!.lng).toBeCloseTo(-75.6972, 4);
  });

  it('extracts creation time as ISO 8601', async () => {
    // 2024-06-15T10:00:00Z in MP4 epoch (seconds since 1904-01-01)
    const mp4Time = 2082844800 + Math.floor(new Date('2024-06-15T10:00:00Z').getTime() / 1000);
    const moov = buildMoov({ width: 1920, height: 1080, creationTime: mp4Time });
    const file = moovToFile(moov);
    const meta = await extractVideoMetadata(file);
    expect(meta!.capturedAt).toBe('2024-06-15T10:00:00.000Z');
  });

  it('returns null for non-MP4 input', async () => {
    const file = new File([new Uint8Array(100)], 'test.txt', { type: 'text/plain' });
    const meta = await extractVideoMetadata(file);
    expect(meta).toBeNull();
  });

  it('handles file with no GPS gracefully', async () => {
    const moov = buildMoov({ width: 640, height: 480 });
    const file = moovToFile(moov);
    const meta = await extractVideoMetadata(file);
    expect(meta!.lat).toBeUndefined();
    expect(meta!.lng).toBeUndefined();
  });

  it('handles portrait dimensions', async () => {
    const moov = buildMoov({ width: 1080, height: 1920 });
    const file = moovToFile(moov);
    const meta = await extractVideoMetadata(file);
    expect(meta!.width).toBe(1080);
    expect(meta!.height).toBe(1920);
  });
});
