import { useState, useRef, useEffect } from 'preact/hooks';
import { useDragReorder, useFileUpload, useVideoUpload } from '../../lib/hooks';
import type { AdminMediaItem } from '../../lib/models/route-model';

export type MediaItem = AdminMediaItem & {
  videoStatus?: 'uploading' | 'transcoding' | 'ready' | 'failed';
  uploadPercent?: number;
  transcodingStartedAt?: number;
  posterChecked?: boolean;
};

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
  videoPrefix?: string;
  onUpdateItem?: (key: string, patch: Record<string, unknown>) => void;
}

function TranscodingOverlay({ startedAt }: { startedAt?: number }) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!startedAt) return;
    const timer = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, [startedAt]);

  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;
  const display = `${mins}:${String(secs).padStart(2, '0')}`;

  return (
    <div class="video-transcoding-overlay">
      <span class="video-transcoding-timer">
        {`Processing \u2014 ${display} / ~10 min`}
      </span>
    </div>
  );
}

export default function MediaManager({ media, onChange, cdnUrl, videosCdnUrl, pendingFiles, onPendingProcessed, onSuggestionDrop, userRole, onParkPhoto, contentSlug, contentKind, videoPrefix, onUpdateItem }: Props) {
  const fileUpload = useFileUpload();

  const updateMedia = onUpdateItem || ((key: string, patch: Record<string, unknown>) => {
    onChange(media.map(item => item.key === key ? { ...item, ...patch } : item));
  });

  const videoUpload = useVideoUpload(updateMedia);
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

  // Resume polling for videos that are still transcoding (page reload case)
  useEffect(() => {
    for (const item of media) {
      if (item.type === 'video' && !item.width && !item.videoStatus) {
        fetch(`/api/video/status/${item.key}`)
          .then(res => res.ok ? res.json() : null)
          .then(data => {
            if (!data) return;
            if (data.status === 'transcoding') {
              updateMedia(item.key, {
                videoStatus: 'transcoding',
                transcodingStartedAt: Date.now(),
              });
              videoUpload.resumePolling(item.key, videosCdnUrl, videoPrefix);
            } else if (data.status === 'ready') {
              const patch: Record<string, unknown> = { videoStatus: 'ready' };
              if (data.width != null) patch.width = data.width;
              if (data.height != null) patch.height = data.height;
              if (data.duration != null) patch.duration = data.duration;
              if (data.orientation != null) patch.orientation = data.orientation;
              updateMedia(item.key, patch);
            } else if (data.status === 'failed') {
              updateMedia(item.key, { videoStatus: 'failed' });
            }
          })
          .catch(() => {});
      }
    }
  }, []);

  function thumbnailUrl(key: string): string {
    return `${cdnUrl}/cdn-cgi/image/width=200,height=150,fit=cover/${key}`;
  }

  function videoPosterUrl(item: MediaItem): string {
    const base = videosCdnUrl || cdnUrl;
    const slashIdx = item.key.indexOf('/');
    const prefix = slashIdx !== -1 ? item.key.slice(0, slashIdx) : (videoPrefix || '');
    const bareKey = slashIdx !== -1 ? item.key.slice(slashIdx + 1) : item.key;
    return prefix
      ? `${base}/${prefix}/${bareKey}/${bareKey}-poster.0000000.jpg`
      : `${base}/${bareKey}/${bareKey}-poster.0000000.jpg`;
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
        const item = await videoUpload.startUpload(
          file, contentSlug, contentKind || 'route',
          videosCdnUrl, videoPrefix,
        );
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
    if (photo.type === 'video' && photo.videoStatus) {
      videoUpload.cancelPolling(photo.key);
    }
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
        {fileUpload.uploading || media.some(m => m.videoStatus === 'uploading')
          ? 'Uploading...'
          : 'Drop photos or videos here, or click to add'}
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
                {(item.videoStatus === 'ready' || item.posterChecked || (!item.videoStatus && item.width)) ? (
                  <img src={videoPosterUrl(item)} alt={item.title || ''} loading="lazy" />
                ) : (
                  <div class="video-placeholder" />
                )}
                {item.videoStatus === 'uploading' && (
                  <div class="video-upload-progress">
                    <div class="video-upload-progress-bar" style={{ width: `${item.uploadPercent || 0}%` }} />
                    <span class="video-upload-progress-label">
                      {`Uploading ${item.uploadPercent || 0}%`}
                    </span>
                  </div>
                )}
                {item.videoStatus === 'transcoding' && (
                  <TranscodingOverlay startedAt={item.transcodingStartedAt} />
                )}
                {item.videoStatus === 'failed' && (
                  <span class="video-transcoding-indicator video-transcoding-indicator--failed">
                    Processing failed
                  </span>
                )}
                {!item.videoStatus && <span class="video-play-icon" />}
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
                {'\u00d7'}
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
