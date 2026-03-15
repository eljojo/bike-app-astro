import type { AppEnv } from '../config/app-env';
import { createLocalTranscodeService } from './transcode.adapter-local';

export interface TranscodeService {
  /** Check whether a key already exists in the originals bucket. */
  headObject(key: string): Promise<boolean>;
  presignUpload(key: string, contentType: string): Promise<string>;
}

/**
 * Resolution scaling: fit within 1080p (1920x1080), preserving aspect ratio.
 * Long edge capped at 1920, short edge capped at 1080.
 * MediaConvert requires even dimensions.
 */
export function outputSize(
  width: number,
  height: number,
): { width: number; height: number } {
  const maxLong = 1920;
  const maxShort = 1080;
  const landscape = width >= height;
  const longEdge = landscape ? width : height;
  const shortEdge = landscape ? height : width;
  const scale = Math.min(maxLong / longEdge, maxShort / shortEdge, 1);
  if (scale >= 1) return { width, height };
  return {
    width: Math.round((width * scale) / 2) * 2,
    height: Math.round((height * scale) / 2) * 2,
  };
}

export async function createTranscodeService(env: AppEnv): Promise<TranscodeService> {
  if (process.env.RUNTIME === 'local') {
    return createLocalTranscodeService();
  }
  const { createAwsTranscodeService } = await import('./transcode.adapter-aws');
  return createAwsTranscodeService(env);
}
