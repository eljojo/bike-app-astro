import { useState, useRef } from 'preact/hooks';

export interface MediaItem {
  key: string;
  caption?: string;
  cover?: boolean;
  width?: number;
  height?: number;
}

interface Props {
  media: MediaItem[];
  onChange: (media: MediaItem[]) => void;
  cdnUrl: string;
}

export default function MediaManager({ media, onChange, cdnUrl }: Props) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [dragIdx, setDragIdx] = useState<number | null>(null);

  function thumbnailUrl(key: string): string {
    return `${cdnUrl}/cdn-cgi/image/width=200,height=150,fit=cover/${key}`;
  }

  async function uploadFiles(files: FileList | File[]) {
    setError('');
    setUploading(true);

    try {
      const newItems: MediaItem[] = [];

      for (const file of Array.from(files)) {
        // Get presigned URL
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

        // Upload to R2
        await fetch(uploadUrl, {
          method: 'PUT',
          body: file,
          headers: { 'Content-Type': file.type },
        });

        // Confirm upload
        const confirmRes = await fetch('/api/media/confirm', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key }),
        });

        if (!confirmRes.ok) {
          const errData = await confirmRes.json();
          throw new Error(errData.error || 'Upload confirmation failed');
        }

        const confirmed = await confirmRes.json();
        newItems.push({
          key,
          width: confirmed.width,
          height: confirmed.height,
        });
      }

      onChange([...media, ...newItems]);
    } catch (err: any) {
      setError(err.message || 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer?.files?.length) {
      uploadFiles(e.dataTransfer.files);
    }
  }

  function handleFileSelect(e: Event) {
    const input = e.target as HTMLInputElement;
    if (input.files?.length) {
      uploadFiles(input.files);
      input.value = '';
    }
  }

  function setCover(idx: number) {
    const updated = media.map((m, i) => ({ ...m, cover: i === idx }));
    onChange(updated);
  }

  function removePhoto(idx: number) {
    onChange(media.filter((_, i) => i !== idx));
  }

  function updateCaption(idx: number, caption: string) {
    const updated = [...media];
    updated[idx] = { ...updated[idx], caption };
    onChange(updated);
  }

  // Drag reorder handlers
  function handleDragStart(idx: number) {
    setDragIdx(idx);
  }

  function handleDragOver(e: DragEvent, idx: number) {
    e.preventDefault();
    if (dragIdx === null || dragIdx === idx) return;

    const updated = [...media];
    const [moved] = updated.splice(dragIdx, 1);
    updated.splice(idx, 0, moved);
    onChange(updated);
    setDragIdx(idx);
  }

  function handleDragEnd() {
    setDragIdx(null);
  }

  return (
    <div class="media-manager">
      <div
        class={`drop-zone ${dragOver ? 'drop-zone--active' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
      >
        {uploading ? 'Uploading...' : 'Drop photos here or click to add'}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/heic"
          multiple
          style="display:none"
          onChange={handleFileSelect}
        />
      </div>

      {error && <div class="auth-error">{error}</div>}

      <div class="photo-grid">
        {media.map((item, idx) => (
          <div
            key={item.key}
            class={`photo-card ${dragIdx === idx ? 'photo-card--dragging' : ''}`}
            draggable
            onDragStart={() => handleDragStart(idx)}
            onDragOver={(e: DragEvent) => handleDragOver(e, idx)}
            onDragEnd={handleDragEnd}
          >
            <img src={thumbnailUrl(item.key)} alt={item.caption || ''} loading="lazy" />
            <div class="photo-actions">
              <button
                type="button"
                class={`btn-star ${item.cover ? 'btn-star--active' : ''}`}
                onClick={() => setCover(idx)}
                title="Set as cover"
              >
                {item.cover ? '\u2605' : '\u2606'}
              </button>
              <button
                type="button"
                class="btn-remove"
                onClick={() => removePhoto(idx)}
                title="Remove"
              >
                {'×'}
              </button>
            </div>
            <input
              type="text"
              class="photo-caption"
              placeholder="Caption"
              value={item.caption || ''}
              onInput={(e) => updateCaption(idx, (e.target as HTMLInputElement).value)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
