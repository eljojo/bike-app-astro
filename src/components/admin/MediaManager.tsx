import { useState, useRef, useEffect } from 'preact/hooks';
import { useDragReorder, useFileUpload } from '../../lib/hooks';
import type { AdminMediaItem } from '../../lib/models/route-model';

export type MediaItem = AdminMediaItem;

interface Props {
  media: MediaItem[];
  onChange: (media: MediaItem[]) => void;
  cdnUrl: string;
  pendingFiles?: File[];
  onPendingProcessed?: () => void;
  onSuggestionDrop?: (photo: MediaItem, wasParked: boolean) => void;
  userRole?: string;
  onParkPhoto?: (photo: MediaItem) => void;
}

export default function MediaManager({ media, onChange, cdnUrl, pendingFiles, onPendingProcessed, onSuggestionDrop, userRole, onParkPhoto }: Props) {
  const fileUpload = useFileUpload();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [suggestionDragOver, setSuggestionDragOver] = useState(false);
  const drag = useDragReorder(media, onChange);

  useEffect(() => {
    if (pendingFiles && pendingFiles.length > 0) {
      uploadFiles(pendingFiles);
      onPendingProcessed?.();
    }
  }, [pendingFiles]);

  function thumbnailUrl(key: string): string {
    return `${cdnUrl}/cdn-cgi/image/width=200,height=150,fit=cover/${key}`;
  }

  async function uploadFiles(files: FileList | File[]) {
    const results = await fileUpload.upload(Array.from(files));
    if (results.length > 0) {
      const newItems: MediaItem[] = results.map(r => ({
        key: r.key,
        width: r.width,
        height: r.height,
        ...(r.lat != null && { lat: r.lat }),
        ...(r.lng != null && { lng: r.lng }),
        ...(r.uploaded_by && { uploaded_by: r.uploaded_by }),
        ...(r.captured_at && { captured_at: r.captured_at }),
      }));
      onChange([...media, ...newItems]);
    }
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer?.files?.length) {
      uploadFiles(e.dataTransfer.files);
    }
  }

  function handleGridDragOver(e: DragEvent) {
    if (e.dataTransfer?.types.includes('text/suggestion-data')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      setSuggestionDragOver(true);
    }
  }

  function handleGridDragLeave(e: DragEvent) {
    const target = e.currentTarget as HTMLElement;
    const related = e.relatedTarget as Node | null;
    if (!related || !target.contains(related)) {
      setSuggestionDragOver(false);
    }
  }

  function handleGridDrop(e: DragEvent) {
    const suggestionData = e.dataTransfer?.getData('text/suggestion-data');
    if (suggestionData) {
      e.preventDefault();
      e.stopPropagation();
      setSuggestionDragOver(false);
      const { wasParked, routeSlug: _, ...photo } = JSON.parse(suggestionData);
      if (onSuggestionDrop) {
        onSuggestionDrop(photo as MediaItem, wasParked);
      }
    }
  }

  function handlePhotoDragStart(e: DragEvent, item: MediaItem, idx: number) {
    drag.handleDragStart(idx);
    e.dataTransfer!.setData('text/photo-key', item.key);
    e.dataTransfer!.setData('text/photo-data', JSON.stringify(item));
    e.dataTransfer!.effectAllowed = 'move';
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
    const photo = media[idx];
    if (userRole !== 'admin' && onParkPhoto) {
      onParkPhoto(photo);
    }
    onChange(media.filter((_, i) => i !== idx));
  }

  function updateCaption(idx: number, caption: string) {
    const updated = [...media];
    updated[idx] = { ...updated[idx], caption };
    onChange(updated);
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
        {fileUpload.uploading ? 'Uploading...' : 'Drop photos here or click to add'}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/heic"
          multiple
          style="display:none"
          onChange={handleFileSelect}
        />
      </div>

      {fileUpload.error && <div class="auth-error">{fileUpload.error}</div>}

      <div
        class={`photo-grid${suggestionDragOver ? ' photo-grid--drop-target' : ''}`}
        onDragOver={handleGridDragOver}
        onDragLeave={handleGridDragLeave}
        onDrop={handleGridDrop}
      >
        {media.map((item, idx) => (
          <div
            key={item.key}
            class={`photo-card ${drag.dragIdx === idx ? 'photo-card--dragging' : ''}`}
            draggable
            onDragStart={(e: DragEvent) => handlePhotoDragStart(e, item, idx)}
            onDragOver={(e: DragEvent) => drag.handleDragOver(e, idx)}
            onDragEnd={drag.handleDragEnd}
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
