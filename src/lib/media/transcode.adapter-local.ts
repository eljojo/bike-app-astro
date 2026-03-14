import type { TranscodeService, TranscodeParams, TranscodeJob } from './transcode.service';

/**
 * Local dev adapter: skips transcoding entirely.
 * Videos are considered "ready" immediately.
 * Original file serves directly from .data/uploads/.
 */
export function createLocalTranscodeService(): TranscodeService {
  return {
    async headObject(_key: string): Promise<boolean> {
      return false;
    },
    async presignUpload(key: string, _contentType: string): Promise<string> {
      return `/api/video/upload-local?key=${encodeURIComponent(key)}`;
    },
    async createJob(params: TranscodeParams): Promise<TranscodeJob> {
      return { jobId: `local-${params.key}`, key: params.key };
    },
  };
}
