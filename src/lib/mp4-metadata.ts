/**
 * Client-side MP4/MOV metadata extraction via moov atom parsing.
 * No external libraries — pure DataView/ArrayBuffer parsing.
 *
 * Extracts: dimensions, duration, creation time, GPS coordinates.
 */

export interface VideoMetadata {
  width: number;
  height: number;
  duration: number;       // seconds
  capturedAt?: string;    // ISO 8601
  lat?: number;
  lng?: number;
}

// MP4 epoch: 1904-01-01 00:00:00 UTC
const MP4_EPOCH_OFFSET = 2082844800;

/**
 * Extract metadata from an MP4/MOV file by parsing the moov atom tree.
 * Reads only the first 10MB of the file (moov is usually near the start).
 * If moov isn't found in the first 10MB, reads the last 10MB (fragmented MP4s
 * sometimes put moov at the end).
 * Returns null if the file isn't MP4/MOV or moov can't be found.
 */
export async function extractVideoMetadata(file: File): Promise<VideoMetadata | null> {
  const CHUNK_SIZE = 10 * 1024 * 1024; // 10MB

  // Try beginning of file first
  let buffer = await readSlice(file, 0, Math.min(CHUNK_SIZE, file.size));
  let moov = findAtom(buffer, 'moov');

  // If not found, try end of file
  if (!moov && file.size > CHUNK_SIZE) {
    const offset = file.size - CHUNK_SIZE;
    buffer = await readSlice(file, offset, file.size);
    moov = findAtom(buffer, 'moov');
  }

  if (!moov) return null;

  const result: Partial<VideoMetadata> = {};

  // Parse mvhd (movie header) for duration and creation time
  const mvhd = findAtom(moov, 'mvhd');
  if (mvhd) {
    parseMvhd(mvhd, result);
  }

  // Parse trak → tkhd for dimensions
  const trak = findAtom(moov, 'trak');
  if (trak) {
    const tkhd = findAtom(trak, 'tkhd');
    if (tkhd) {
      parseTkhd(tkhd, result);
    }
  }

  // Parse udta → ©xyz for GPS
  const udta = findAtom(moov, 'udta');
  if (udta) {
    parseGps(udta, result);
  }

  if (!result.width || !result.height) return null;

  return {
    width: result.width,
    height: result.height,
    duration: result.duration || 0,
    capturedAt: result.capturedAt,
    lat: result.lat,
    lng: result.lng,
  };
}

function readSlice(file: File, start: number, end: number): Promise<ArrayBuffer> {
  return file.slice(start, end).arrayBuffer();
}

/**
 * Find an atom (box) by type within a buffer.
 * Returns the atom's content (excluding size and type header).
 */
function findAtom(buffer: ArrayBuffer, type: string): ArrayBuffer | null {
  const view = new DataView(buffer);
  const typeCode = atomTypeCode(type);
  let offset = 0;

  while (offset + 8 <= buffer.byteLength) {
    let size = view.getUint32(offset);
    const atomType = view.getUint32(offset + 4);

    if (size === 0) break; // box extends to end of file — skip

    let headerSize = 8;
    if (size === 1) {
      // 64-bit extended size
      if (offset + 16 > buffer.byteLength) break;
      const hi = view.getUint32(offset + 8);
      const lo = view.getUint32(offset + 12);
      size = hi * 0x100000000 + lo;
      headerSize = 16;
    }

    if (size < headerSize) break; // invalid

    if (atomType === typeCode) {
      const contentStart = offset + headerSize;
      const contentEnd = Math.min(offset + size, buffer.byteLength);
      return buffer.slice(contentStart, contentEnd);
    }

    offset += size;
  }

  return null;
}

function atomTypeCode(type: string): number {
  return (
    (type.charCodeAt(0) << 24) |
    (type.charCodeAt(1) << 16) |
    (type.charCodeAt(2) << 8) |
    type.charCodeAt(3)
  ) >>> 0;
}

function parseMvhd(data: ArrayBuffer, result: Partial<VideoMetadata>): void {
  const view = new DataView(data);
  if (data.byteLength < 4) return;

  const version = view.getUint8(0);

  if (version === 0 && data.byteLength >= 20) {
    const creationTime = view.getUint32(4);
    const timescale = view.getUint32(12);
    const duration = view.getUint32(16);

    if (timescale > 0) {
      result.duration = duration / timescale;
    }
    if (creationTime > MP4_EPOCH_OFFSET) {
      result.capturedAt = mp4TimeToIso(creationTime);
    }
  } else if (version === 1 && data.byteLength >= 32) {
    const creationHi = view.getUint32(4);
    const creationLo = view.getUint32(8);
    const creationTime = creationHi * 0x100000000 + creationLo;
    const timescale = view.getUint32(20);
    const durationHi = view.getUint32(24);
    const durationLo = view.getUint32(28);
    const duration = durationHi * 0x100000000 + durationLo;

    if (timescale > 0) {
      result.duration = duration / timescale;
    }
    if (creationTime > MP4_EPOCH_OFFSET) {
      result.capturedAt = mp4TimeToIso(creationTime);
    }
  }
}

function parseTkhd(data: ArrayBuffer, result: Partial<VideoMetadata>): void {
  const view = new DataView(data);
  if (data.byteLength < 4) return;

  const version = view.getUint8(0);

  // Width and height are at fixed-point 16.16 format at the end
  if (version === 0 && data.byteLength >= 84) {
    const width = view.getUint32(76) >>> 16;
    const height = view.getUint32(80) >>> 16;
    if (width > 0 && height > 0) {
      result.width = width;
      result.height = height;
    }
  } else if (version === 1 && data.byteLength >= 96) {
    const width = view.getUint32(88) >>> 16;
    const height = view.getUint32(92) >>> 16;
    if (width > 0 && height > 0) {
      result.width = width;
      result.height = height;
    }
  }
}

function parseGps(udta: ArrayBuffer, result: Partial<VideoMetadata>): void {
  // Look for ©xyz atom (GPS coordinates as text)
  const xyzAtom = findAtom(udta, '\u00A9xyz');
  if (!xyzAtom || xyzAtom.byteLength < 4) return;

  // The content is typically: 2 bytes length + 2 bytes language + text
  const view = new DataView(xyzAtom);
  const textLen = view.getUint16(0);
  if (textLen === 0 || textLen + 4 > xyzAtom.byteLength) return;

  const textBytes = new Uint8Array(xyzAtom, 4, textLen);
  const text = new TextDecoder().decode(textBytes);

  // Format: "+45.4215-075.6972/" or "+45.4215-075.6972+100.00/"
  const match = text.match(/([+-]\d+\.\d+)([+-]\d+\.\d+)/);
  if (match) {
    result.lat = parseFloat(match[1]);
    result.lng = parseFloat(match[2]);
  }
}

function mp4TimeToIso(seconds: number): string {
  const unixMs = (seconds - MP4_EPOCH_OFFSET) * 1000;
  return new Date(unixMs).toISOString();
}
