import { useState, useEffect, useRef } from 'preact/hooks';

/**
 * Workaround for Preact hydration bug: textarea value prop
 * is not applied during hydrate(), leaving textarea empty.
 * Re-applies value after mount if textarea is empty.
 */
export function useTextareaValue(initialValue: string) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (ref.current && initialValue && !ref.current.value) {
      ref.current.value = initialValue;
    }
  }, []);
  return ref;
}

/**
 * Generic drag-to-reorder for ordered lists.
 * Returns drag handlers and current drag index.
 */
export function useDragReorder<T>(items: T[], onChange: (items: T[]) => void) {
  const [dragIdx, setDragIdx] = useState<number | null>(null);

  return {
    dragIdx,
    handleDragStart(idx: number) {
      setDragIdx(idx);
    },
    handleDragOver(e: DragEvent, idx: number) {
      e.preventDefault();
      if (dragIdx === null || dragIdx === idx) return;
      const updated = [...items];
      const [moved] = updated.splice(dragIdx, 1);
      updated.splice(idx, 0, moved);
      onChange(updated);
      setDragIdx(idx);
    },
    handleDragEnd() {
      setDragIdx(null);
    },
  };
}

/**
 * Full-page drag-and-drop for file uploads.
 * Handles dragenter/leave/over/drop with counter-based tracking
 * to avoid flicker from nested element enter/leave events.
 */
export function useDragDrop(onFilesDropped: (files: File[]) => void) {
  const [dragging, setDragging] = useState(false);
  const dragCounterRef = useRef(0);

  useEffect(() => {
    function handleDragEnter(e: DragEvent) {
      e.preventDefault();
      dragCounterRef.current++;
      if (e.dataTransfer?.types.includes('Files')) setDragging(true);
    }
    function handleDragLeave(e: DragEvent) {
      e.preventDefault();
      dragCounterRef.current--;
      if (dragCounterRef.current === 0) setDragging(false);
    }
    function handleDragOver(e: DragEvent) { e.preventDefault(); }
    function handleDrop(e: DragEvent) {
      e.preventDefault();
      dragCounterRef.current = 0;
      setDragging(false);
      const files = e.dataTransfer?.files;
      if (files?.length) onFilesDropped(Array.from(files));
    }

    document.addEventListener('dragenter', handleDragEnter);
    document.addEventListener('dragleave', handleDragLeave);
    document.addEventListener('dragover', handleDragOver);
    document.addEventListener('drop', handleDrop);
    return () => {
      document.removeEventListener('dragenter', handleDragEnter);
      document.removeEventListener('dragleave', handleDragLeave);
      document.removeEventListener('dragover', handleDragOver);
      document.removeEventListener('drop', handleDrop);
    };
  }, []);

  return { dragging };
}

export interface VideoUploadState {
  key: string;
  status: 'uploading' | 'transcoding' | 'ready' | 'failed';
  title: string;
  progress: string;
}

/**
 * Video upload flow: extract metadata → presign → upload → transcode → poll.
 */
export function useVideoUpload() {
  const [videos, setVideos] = useState<Map<string, VideoUploadState>>(new Map());
  const [error, setError] = useState('');
  const pollTimers = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map());

  async function uploadVideo(
    file: File,
    contentSlug: string,
    contentKind: string,
  ): Promise<{ key: string; type: 'video'; title: string; handle: string; width?: number; height?: number; duration?: string; lat?: number; lng?: number; captured_at?: string } | null> {
    setError('');

    try {
      // 1. Extract metadata from MP4
      const { extractVideoMetadata } = await import('./mp4-metadata');
      const meta = await extractVideoMetadata(file);

      // 2. Presign
      const presignRes = await fetch('/api/video/presign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contentType: file.type,
          contentLength: file.size,
          contentSlug,
          contentKind,
          filename: file.name,
        }),
      });
      if (!presignRes.ok) {
        const data = await presignRes.json();
        throw new Error(data.error || 'Failed to get video upload URL');
      }
      const { key, uploadUrl } = await presignRes.json();

      const title = file.name.replace(/\.[^.]+$/, '');
      setVideos(prev => new Map(prev).set(key, {
        key, status: 'uploading', title, progress: 'Uploading...',
      }));

      // 3. Upload to S3 (or local)
      await fetch(uploadUrl, {
        method: 'PUT',
        body: file,
        headers: { 'Content-Type': file.type },
      });

      // 4. Start transcoding
      const handle = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      const duration = meta?.duration ? `PT${Math.round(meta.duration)}S` : undefined;
      const transcodeRes = await fetch('/api/video/transcode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          key,
          width: meta?.width,
          height: meta?.height,
          duration,
          capturedAt: meta?.capturedAt,
          lat: meta?.lat,
          lng: meta?.lng,
          title,
          handle,
        }),
      });
      if (!transcodeRes.ok) {
        const data = await transcodeRes.json();
        throw new Error(data.error || 'Failed to start transcoding');
      }

      setVideos(prev => new Map(prev).set(key, {
        key, status: 'transcoding', title, progress: 'Processing...',
      }));

      // 5. Start polling for completion
      startPolling(key);

      // 6. Return item for immediate addition to media list
      return {
        key,
        type: 'video',
        title,
        handle,
        width: meta?.width,
        height: meta?.height,
        duration,
        lat: meta?.lat,
        lng: meta?.lng,
        captured_at: meta?.capturedAt,
      };
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Video upload failed');
      return null;
    }
  }

  function startPolling(key: string) {
    const timer = setInterval(async () => {
      try {
        const res = await fetch(`/api/video/status/${key}`);
        if (!res.ok) return;
        const data = await res.json();

        if (data.status === 'ready') {
          setVideos(prev => {
            const next = new Map(prev);
            const existing = next.get(key);
            if (existing) next.set(key, { ...existing, status: 'ready', progress: 'Ready' });
            return next;
          });
          clearInterval(timer);
          pollTimers.current.delete(key);
        } else if (data.status === 'failed') {
          setVideos(prev => {
            const next = new Map(prev);
            const existing = next.get(key);
            if (existing) next.set(key, { ...existing, status: 'failed', progress: 'Failed' });
            return next;
          });
          clearInterval(timer);
          pollTimers.current.delete(key);
        }
      } catch {
        // Ignore polling errors — will retry on next interval
      }
    }, 30_000); // every 30 seconds
    pollTimers.current.set(key, timer);
  }

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      for (const timer of pollTimers.current.values()) clearInterval(timer);
    };
  }, []);

  return { uploadVideo, videos, error, setError };
}

export interface UploadedFile {
  key: string;
  width?: number;
  height?: number;
  contentType?: string;
  lat?: number;
  lng?: number;
  uploaded_by?: string;
  captured_at?: string;
}

/**
 * Presign → upload → confirm flow for media files.
 * Works for single or multiple files.
 */
export function useFileUpload() {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');

  async function upload(files: File | File[]): Promise<UploadedFile[]> {
    setError('');
    setUploading(true);

    try {
      const fileArray = Array.isArray(files) ? files : [files];
      const uploaded: UploadedFile[] = [];

      const MAX_UPLOAD_SIZE = 25 * 1024 * 1024; // 25MB
      for (const file of fileArray) {
        if (file.size > MAX_UPLOAD_SIZE) {
          const sizeMB = (file.size / (1024 * 1024)).toFixed(1);
          throw new Error(`File too large (${sizeMB}MB). Maximum size is 25MB.`);
        }

        const presignRes = await fetch('/api/media/presign', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contentType: file.type, contentLength: file.size }),
        });
        if (!presignRes.ok) {
          const data = await presignRes.json();
          throw new Error(data.error || 'Failed to get upload URL');
        }
        const { key, uploadUrl } = await presignRes.json();

        await fetch(uploadUrl, {
          method: 'PUT',
          body: file,
          headers: { 'Content-Type': file.type },
        });

        const confirmRes = await fetch('/api/media/confirm', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key }),
        });
        if (!confirmRes.ok) {
          const data = await confirmRes.json();
          throw new Error(data.error || 'Upload confirmation failed');
        }
        const confirmed = await confirmRes.json();
        uploaded.push({
          key: confirmed.key,
          width: confirmed.width,
          height: confirmed.height,
          contentType: confirmed.contentType,
          lat: confirmed.lat,
          lng: confirmed.lng,
          uploaded_by: confirmed.uploaded_by,
          captured_at: confirmed.captured_at,
        });
      }

      return uploaded;
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Upload failed');
      return [];
    } finally {
      setUploading(false);
    }
  }

  return { upload, uploading, error, setError };
}
