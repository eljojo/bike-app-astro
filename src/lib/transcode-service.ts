import type { AppEnv } from './app-env';
import { createLocalTranscodeService } from './transcode-local';

export interface TranscodeParams {
  key: string;
  width: number;
  height: number;
}

export interface TranscodeJob {
  jobId: string;
  key: string;
}

export interface TranscodeService {
  presignUpload(key: string, contentType: string): Promise<string>;
  createJob(params: TranscodeParams): Promise<TranscodeJob>;
}

/**
 * Resolution scaling: fit within 1080p, preserving aspect ratio.
 * MediaConvert requires even dimensions.
 */
export function outputSize(
  width: number,
  height: number,
): { width: number; height: number } {
  const maxDimension = 1080;
  const landscape = width >= height;
  const scale = maxDimension / (landscape ? width : height);
  if (scale >= 1) return { width, height };
  return {
    width: Math.round((width * scale) / 2) * 2,
    height: Math.round((height * scale) / 2) * 2,
  };
}

export function createTranscodeService(env: AppEnv): TranscodeService {
  if (process.env.RUNTIME === 'local') {
    return createLocalTranscodeService();
  }
  // Dynamic import to avoid bundling AWS code locally
  const { createAwsTranscodeService } = require('./transcode-aws');
  return createAwsTranscodeService(env);
}
