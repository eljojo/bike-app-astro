import ExifReader from 'exif-reader';

export interface PhotoMetadata {
  lat: number;
  lng: number;
  capturedAt?: string;
}

/**
 * Extract GPS coordinates and capture timestamp from a JPEG image buffer.
 * Returns { lat, lng, capturedAt? } or null if no GPS data found.
 *
 * Only JPEG files contain EXIF data. PNG and WebP are silently skipped.
 */
export function extractPhotoMetadata(
  buffer: ArrayBuffer,
): PhotoMetadata | null {
  try {
    const view = new Uint8Array(buffer);
    // Only JPEG files have EXIF — check for SOI marker (FF D8)
    if (view.length < 2 || view[0] !== 0xff || view[1] !== 0xd8) {
      return null;
    }

    // Find the APP1 EXIF segment
    const exifOffset = findExifOffset(view);
    if (exifOffset < 0) return null;

    const exifBuffer = Buffer.from(buffer, exifOffset);
    const exif = ExifReader(exifBuffer);
    const gps = exif?.GPSInfo;
    if (!gps?.GPSLatitude || !gps?.GPSLongitude) return null;

    const lat = dmsToDecimal(
      gps.GPSLatitude as [number, number, number],
      gps.GPSLatitudeRef as string,
    );
    const lng = dmsToDecimal(
      gps.GPSLongitude as [number, number, number],
      gps.GPSLongitudeRef as string,
    );

    if (!isFinite(lat) || !isFinite(lng)) return null;

    let capturedAt: string | undefined;
    const dto = exif?.Photo?.DateTimeOriginal;
    if (dto instanceof Date) {
      capturedAt = dto.toISOString();
    }

    return { lat: round6(lat), lng: round6(lng), capturedAt };
  } catch {
    return null;
  }
}

/** @deprecated Use extractPhotoMetadata instead */
export function extractGpsCoordinates(
  buffer: ArrayBuffer,
): { lat: number; lng: number } | null {
  const meta = extractPhotoMetadata(buffer);
  if (!meta) return null;
  return { lat: meta.lat, lng: meta.lng };
}

/**
 * Find the byte offset of the TIFF header inside a JPEG's APP1 segment.
 * Returns -1 if no EXIF APP1 segment is found.
 */
function findExifOffset(data: Uint8Array): number {
  // Scan JPEG markers for APP1 (FF E1) containing "Exif\0\0"
  let offset = 2; // skip SOI
  while (offset < data.length - 1) {
    if (data[offset] !== 0xff) return -1;
    const marker = data[offset + 1];
    if (marker === 0xd9) return -1; // EOI
    if (marker === 0xda) return -1; // SOS — end of metadata

    const segLen = (data[offset + 2] << 8) | data[offset + 3];
    if (marker === 0xe1) {
      // Check for "Exif\0\0" signature
      if (
        data[offset + 4] === 0x45 && // E
        data[offset + 5] === 0x78 && // x
        data[offset + 6] === 0x69 && // i
        data[offset + 7] === 0x66 && // f
        data[offset + 8] === 0x00 &&
        data[offset + 9] === 0x00
      ) {
        // TIFF header starts after "Exif\0\0" (6 bytes after APP1 data start)
        return offset + 10;
      }
    }
    offset += 2 + segLen;
  }
  return -1;
}

/** Convert DMS (degrees, minutes, seconds) + ref to decimal degrees. */
function dmsToDecimal(dms: [number, number, number], ref: string): number {
  const [deg, min, sec] = dms;
  let decimal = deg + min / 60 + sec / 3600;
  if (ref === 'S' || ref === 'W') decimal = -decimal;
  return decimal;
}

/** Round to 6 decimal places (~0.11m precision). */
function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}
