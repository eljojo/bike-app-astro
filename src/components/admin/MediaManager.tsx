import { useState, useRef, useEffect, useCallback } from 'preact/hooks';
import { useDragReorder, useFileUpload, useVideoUpload } from '../../lib/hooks';
import type { AdminMediaItem } from '../../lib/models/route-model';

export type MediaItem = AdminMediaItem;

function formatDuration(iso: string): string {
  const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return '';
  const h = parseInt(match[1] || '0');
  const m = parseInt(match[2] || '0');
  const s = parseInt(match[3] || '0');
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

interface Props {
  media: MediaItem[];
  onChange: (media: MediaItem[]) => void;
  cdnUrl: string;
  videosCdnUrl?: string;
  pendingFiles?: File[];
  onPendingProcessed?: () => void;
  onSuggestionDrop?: (photo: MediaItem, wasParked: boolean) => void;
  userRole?: string;
  onParkPhoto?: (photo: MediaItem) => void;
  contentSlug?: string;
  contentKind?: string;
}

export default function MediaManager({ media, onChange, cdnUrl, videosCdnUrl, pendingFiles, onPendingProcessed, onSuggestionDrop, userRole, onParkPhoto, contentSlug, contentKind }: Props) {
  const fileUpload = useFileUpload();

  const handleVideoReady = useCallback((key: string, metadata: Record<string, unknown>) => {
    onChange(media.map(item =>
      item.key === key ? { ...item, ...metadata } : item
    ));
  }, [media, onChange]);

  const videoUpload = useVideoUpload(handleVideoReady);
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

  function videoPosterThumbUrl(item: MediaItem): string {
    if (item.poster_key) {
      return `${cdnUrl}/cdn-cgi/image/width=200,height=150,fit=cover/${item.poster_key}`;
    }
    const base = videosCdnUrl || cdnUrl;
    return `${base}/${item.key}/${item.key}-poster.0000000.jpg`;
  }

  function updateTitle(idx: number, title: string) {
    const updated = [...media];
    updated[idx] = { ...updated[idx], title };
    onChange(updated);
  }

  async function uploadFiles(files: FileList | File[]) {
    const imageFiles: File[] = [];
    const videoFiles: File[] = [];

    for (const file of Array.from(files)) {
      if (file.type.startsWith('video/')) {
        videoFiles.push(file);
      } else {
        imageFiles.push(file);
      }
    }

    const newItems: MediaItem[] = [];

    // Upload images (existing flow)
    if (imageFiles.length > 0) {
      const results = await fileUpload.upload(imageFiles);
      for (const r of results) {
        newItems.push({
          key: r.key,
          width: r.width,
          height: r.height,
          ...(r.lat != null && { lat: r.lat }),
          ...(r.lng != null && { lng: r.lng }),
          ...(r.uploaded_by && { uploaded_by: r.uploaded_by }),
          ...(r.captured_at && { captured_at: r.captured_at }),
        });
      }
    }

    // Upload videos (new flow)
    if (contentSlug && videoFiles.length > 0) {
      for (const file of videoFiles) {
        const item = await videoUpload.uploadVideo(file, contentSlug, contentKind || 'route');
        if (item) newItems.push(item as MediaItem);
      }
    }

    if (newItems.length > 0) {
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
        {fileUpload.uploading || videoUpload.videos.size > 0 ? 'Uploading...' : 'Drop photos or videos here, or click to add'}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/heic,video/mp4,video/quicktime,video/webm"
          multiple
          style="display:none"
          onChange={handleFileSelect}
        />
      </div>

      {(fileUpload.error || videoUpload.error) && (
        <div class="auth-error">{fileUpload.error || videoUpload.error}</div>
      )}

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
            {item.type === 'video' ? (
              <div class="video-thumb">
                <img src={videoPosterThumbUrl(item)} alt={item.title || ''} loading="lazy" />
                {(() => {
                  const state = videoUpload.videos.get(item.key);
                  if (!state) return <span class="video-play-icon" />;
                  if (state.status === 'uploading') return (
                    <div class="video-upload-progress">
                      <div class="video-upload-progress-bar" style={{ width: `${state.uploadPercent}%` }} />
                      <span class="video-upload-progress-label">{state.progress}</span>
                    </div>
                  );
                  if (state.status === 'transcoding') return (
                    <span class="video-transcoding-indicator">{state.progress}</span>
                  );
                  if (state.status === 'failed') return (
                    <span class="video-transcoding-indicator video-transcoding-indicator--failed">Failed</span>
                  );
                  return <span class="video-play-icon" />;
                })()}
              </div>
            ) : (
              <img src={thumbnailUrl(item.key)} alt={item.caption || ''} loading="lazy" />
            )}
            <div class="photo-actions">
              {item.type !== 'video' && (
                <button
                  type="button"
                  class={`btn-star ${item.cover ? 'btn-star--active' : ''}`}
                  onClick={() => setCover(idx)}
                  title="Set as cover"
                >
                  {item.cover ? '\u2605' : '\u2606'}
                </button>
              )}
              <button
                type="button"
                class="btn-remove"
                onClick={() => removePhoto(idx)}
                title="Remove"
              >
                {'×'}
              </button>
            </div>
            {item.type === 'video' ? (
              <div class="video-meta">
                <input
                  type="text"
                  class="photo-caption"
                  value={item.title || ''}
                  placeholder="Video title"
                  onInput={(e) => updateTitle(idx, (e.target as HTMLInputElement).value)}
                />
                {item.duration && <span class="video-duration">{formatDuration(item.duration)}</span>}
              </div>
            ) : (
              <input
                type="text"
                class="photo-caption"
                placeholder="Caption"
                value={item.caption || ''}
                onInput={(e) => updateCaption(idx, (e.target as HTMLInputElement).value)}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
