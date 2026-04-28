import { useState, useRef } from 'preact/hooks';
import { useFileUpload } from '../../lib/hooks';
import { buildImageUrl } from '../../lib/media/image-service';

export interface CoverItem {
  key: string;
  type?: 'photo' | 'video';
  caption?: string;
  width?: number;
  height?: number;
  cover: true;
}

interface Props {
  cover: CoverItem | undefined;
  cdnUrl: string;
  onCoverChange: (cover: CoverItem | undefined) => void;
  label?: string;
}

export default function CoverPhotoField({ cover, cdnUrl, onCoverChange, label = 'Cover photo' }: Props) {
  const upload = useFileUpload();
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState('');

  async function handleUpload(file: File) {
    setError('');
    const results = await upload.upload(file);
    if (results && results.length > 0) {
      const r = results[0];
      onCoverChange({
        key: r.key,
        type: 'photo',
        ...(r.width && { width: r.width }),
        ...(r.height && { height: r.height }),
        cover: true,
      });
    } else if (upload.error) {
      setError(upload.error);
    }
  }

  function handleFileSelect(e: Event) {
    const input = e.target as HTMLInputElement;
    if (input.files?.[0]) handleUpload(input.files[0]);
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    const file = e.dataTransfer?.files[0];
    if (file) handleUpload(file);
  }

  return (
    <div class="cover-photo-field">
      <label>{label}</label>
      {cover ? (
        <div class="cover-photo-field-preview">
          <img src={buildImageUrl(cdnUrl, cover.key, { width: 1200 })} alt="" />
          <div class="cover-photo-field-actions">
            <button
              type="button"
              class="btn-secondary"
              onClick={() => inputRef.current?.click()}
              disabled={upload.uploading}
            >
              {upload.uploading ? 'Uploading...' : 'Replace'}
            </button>
            <button
              type="button"
              class="btn-remove-photo"
              onClick={() => onCoverChange(undefined)}
            >
              Remove
            </button>
          </div>
          <input ref={inputRef} type="file" accept="image/*" onChange={handleFileSelect} hidden />
        </div>
      ) : (
        <div
          class="cover-photo-field-upload"
          onDragOver={(e: DragEvent) => { e.preventDefault(); e.dataTransfer!.dropEffect = 'copy'; }}
          onDrop={handleDrop}
        >
          <input ref={inputRef} type="file" accept="image/*" onChange={handleFileSelect} hidden />
          <button type="button" class="btn-secondary" onClick={() => inputRef.current?.click()} disabled={upload.uploading}>
            {upload.uploading ? 'Uploading...' : 'Upload cover photo'}
          </button>
          <span class="drop-hint">or drag and drop a wide photo (3:1 looks best)</span>
        </div>
      )}
      {error && <div class="auth-error">{error}</div>}
    </div>
  );
}
