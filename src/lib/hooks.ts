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

/** Pure reorder: move item at fromIdx to toIdx. Used by useDragReorder. */
export function reorderItems<T>(items: T[], fromIdx: number, toIdx: number): T[] {
  const updated = [...items];
  const [moved] = updated.splice(fromIdx, 1);
  updated.splice(toIdx, 0, moved);
  return updated;
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
      onChange(reorderItems(items, dragIdx, idx));
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
  const callbackRef = useRef(onFilesDropped);
  callbackRef.current = onFilesDropped;

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
      if (files?.length) callbackRef.current(Array.from(files));
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

export interface VideoUploadItem {
  key: string;
  type: 'video';
  title: string;
  handle: string;
  videoStatus: 'uploading';
  uploadPercent: 0;
}

export interface VideoUploadHook {
  startUpload: (file: File, contentSlug: string, contentKind: string, videosCdnUrl?: string, videoPrefix?: string) => Promise<VideoUploadItem | null>;
  cancelPolling: (key: string) => void;
  resumePolling: (key: string, videosCdnUrl?: string, videoPrefix?: string) => void;
  error: string;
  setError: (e: string) => void;
}

/**
 * Video upload flow: presign → upload with progress → poll for transcode completion.
 * Updates media items in place via updateMedia callback (ref-stable).
 */
export function useVideoUpload(
  updateMedia: (key: string, patch: Record<string, unknown>) => void,
): VideoUploadHook {
  const [error, setError] = useState('');
  const updateRef = useRef(updateMedia);
  updateRef.current = updateMedia;
  const pollTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const pollStarts = useRef<Map<string, number>>(new Map());

  function derivePosterUrl(key: string, videosCdnUrl?: string, videoPrefix?: string): string {
    const slashIdx = key.indexOf('/');
    const prefix = slashIdx !== -1 ? key.slice(0, slashIdx) : (videoPrefix || '');
    const bareKey = slashIdx !== -1 ? key.slice(slashIdx + 1) : key;
    const base = videosCdnUrl || '';
    return prefix
      ? `${base}/${prefix}/${bareKey}/${bareKey}-poster.0000000.jpg`
      : `${base}/${bareKey}/${bareKey}-poster.0000000.jpg`;
  }

  function startPolling(key: string, videosCdnUrl?: string, videoPrefix?: string) {
    if (pollTimers.current.has(key)) return;
    const started = Date.now();
    pollStarts.current.set(key, started);
    let pollCount = 0;
    // Status endpoint uses bare key (DB stores bare keys, route captures one segment)
    const slashIdx = key.indexOf('/');
    const statusKey = slashIdx !== -1 ? key.slice(slashIdx + 1) : key;

    function poll() {
      const interval = pollCount < 12 ? 5_000 : 15_000;
      const timer = setTimeout(async () => {
        pollTimers.current.delete(key);
        pollCount++;

        if (Date.now() - started > 15 * 60 * 1000) {
          updateRef.current(key, { videoStatus: 'failed' });
          pollStarts.current.delete(key);
          return;
        }

        try {
          const res = await fetch(`/api/video/status/${statusKey}`);
          if (!res.ok) { poll(); return; }
          const data = await res.json();

          if (data.status === 'ready') {
            const patch: Record<string, unknown> = { videoStatus: 'ready' };
            if (data.width != null) patch.width = data.width;
            if (data.height != null) patch.height = data.height;
            if (data.duration != null) patch.duration = data.duration;
            if (data.orientation != null) patch.orientation = data.orientation;
            if (data.lat != null) patch.lat = data.lat;
            if (data.lng != null) patch.lng = data.lng;
            if (data.capturedAt != null) patch.captured_at = data.capturedAt;
            updateRef.current(key, patch);
            pollStarts.current.delete(key);
            return;
          }

          if (data.status === 'failed') {
            updateRef.current(key, { videoStatus: 'failed' });
            pollStarts.current.delete(key);
            return;
          }

          // Still transcoding — merge any metadata that arrived
          const patch: Record<string, unknown> = {};
          if (data.width != null) patch.width = data.width;
          if (data.height != null) patch.height = data.height;
          if (data.duration != null) patch.duration = data.duration;
          if (data.orientation != null) patch.orientation = data.orientation;
          if (Object.keys(patch).length > 0) updateRef.current(key, patch);

          // Early poster check
          if (videosCdnUrl || videoPrefix) {
            try {
              const posterUrl = derivePosterUrl(key, videosCdnUrl, videoPrefix);
              if (posterUrl) {
                const posterRes = await fetch(posterUrl, { method: 'HEAD' });
                if (posterRes.ok) {
                  updateRef.current(key, { posterChecked: true });
                }
              }
            } catch { /* poster not ready yet */ }
          }
        } catch { /* network error, retry */ }

        poll();
      }, interval);
      pollTimers.current.set(key, timer);
    }

    poll();
  }

  function cancelPolling(key: string) {
    const timer = pollTimers.current.get(key);
    if (timer) {
      clearTimeout(timer);
      pollTimers.current.delete(key);
    }
    pollStarts.current.delete(key);
  }

  function resumePolling(key: string, videosCdnUrl?: string, videoPrefix?: string) {
    startPolling(key, videosCdnUrl, videoPrefix);
  }

  async function startUpload(
    file: File,
    contentSlug: string,
    contentKind: string,
    videosCdnUrl?: string,
    videoPrefix?: string,
  ): Promise<VideoUploadItem | null> {
    setError('');

    try {
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
      const handle = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

      const item: VideoUploadItem = {
        key,
        type: 'video',
        title,
        handle,
        videoStatus: 'uploading',
        uploadPercent: 0,
      };

      // Deferred XHR so caller can add item to grid before progress events fire
      setTimeout(() => {
        const xhr = new XMLHttpRequest();
        xhr.open('PUT', uploadUrl);
        xhr.setRequestHeader('Content-Type', file.type);
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            const pct = Math.round((e.loaded / e.total) * 100);
            updateRef.current(key, { uploadPercent: pct });
          }
        };
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            updateRef.current(key, {
              videoStatus: 'transcoding',
              uploadPercent: 100,
              transcodingStartedAt: Date.now(),
            });
            startPolling(key, videosCdnUrl, videoPrefix);
          } else {
            updateRef.current(key, { videoStatus: 'failed' });
          }
        };
        xhr.onerror = () => {
          updateRef.current(key, { videoStatus: 'failed' });
        };
        xhr.send(file);
      }, 0);

      return item;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Video upload failed');
      return null;
    }
  }

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      for (const timer of pollTimers.current.values()) clearTimeout(timer);
    };
  }, []);

  return { startUpload, cancelPolling, resumePolling, error, setError };
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
