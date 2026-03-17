import { useState, useRef } from 'preact/hooks';
import { useFileUpload } from '../../lib/hooks';
import { buildImageUrl } from '../../lib/media/image-service';

interface Props {
  photoKey: string;
  cdnUrl: string;
  onPhotoChange: (key: string, contentType: string) => void;
  label?: string;
}

export default function PhotoField({ photoKey, cdnUrl, onPhotoChange, label = 'Photo' }: Props) {
  const upload = useFileUpload();
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState('');

  async function handleUpload(file: File) {
    setError('');
    const results = await upload.upload(file);
    if (results && results.length > 0) {
      onPhotoChange(results[0].key, results[0].contentType || file.type);
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
    <div class="photo-field">
      <label>{label}</label>
      {photoKey ? (
        <div class="photo-field-preview">
          <img src={buildImageUrl(cdnUrl, photoKey, { width: 400 })} alt="" />
          <button type="button" class="btn-remove-photo" onClick={() => onPhotoChange('', '')}>
            Remove
          </button>
        </div>
      ) : (
        <div
          class="photo-field-upload"
          onDragOver={(e: DragEvent) => { e.preventDefault(); e.dataTransfer!.dropEffect = 'copy'; }}
          onDrop={handleDrop}
        >
          <input ref={inputRef} type="file" accept="image/*" onChange={handleFileSelect} hidden />
          <button type="button" class="btn-secondary" onClick={() => inputRef.current?.click()} disabled={upload.uploading}>
            {upload.uploading ? 'Uploading...' : 'Upload Photo'}
          </button>
          <span class="drop-hint">or drag and drop</span>
        </div>
      )}
      {error && <div class="auth-error">{error}</div>}
    </div>
  );
}
