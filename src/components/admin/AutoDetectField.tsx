import { useState } from 'preact/hooks';

interface Props {
  label: string;
  value: string;
  autoDetected?: boolean;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
}

/** Field that shows as read-only span when auto-detected, click to edit. */
export default function AutoDetectField({ label, value, autoDetected = false, onChange, type = 'text', placeholder }: Props) {
  const [editing, setEditing] = useState(!autoDetected || !value);

  if (!editing && value) {
    return (
      <div class="auto-detect-field">
        <label>{label}</label>
        <button
          type="button"
          class="auto-detect-value"
          onClick={() => setEditing(true)}
          title="Click to edit"
        >
          {value} <span class="auto-detect-edit-hint">&#9998;</span>
        </button>
      </div>
    );
  }

  return (
    <div class="auto-detect-field">
      <label>{label}</label>
      <input
        type={type}
        value={value}
        onInput={(e) => onChange((e.target as HTMLInputElement).value)}
        placeholder={placeholder}
        autoFocus={autoDetected && !!value}
      />
    </div>
  );
}
