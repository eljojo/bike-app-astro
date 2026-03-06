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

export interface UploadedFile {
  key: string;
  width?: number;
  height?: number;
  contentType?: string;
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
          body: JSON.stringify({ contentType: file.type }),
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
