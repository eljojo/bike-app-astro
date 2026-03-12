// AGENTS.md: See src/components/admin/AGENTS.md for editor rules.
// All styles in admin.scss.
import { useState, useRef } from 'preact/hooks';
import { parseResultsCsv, type ParsedResult } from '../../lib/parse-results-csv';

export type { ParsedResult as Result };

interface Props {
  results: ParsedResult[];
  onChange: (results: ParsedResult[]) => void;
}

const STATUS_OPTIONS = [
  { value: '', label: 'Finished' },
  { value: 'DNS', label: 'DNS' },
  { value: 'DNF', label: 'DNF' },
  { value: 'DQ', label: 'DQ' },
];

export default function ResultsEditor({ results, onChange }: Props) {
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleFile(file: File) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const parsed = parseResultsCsv(text);
      if (parsed.length > 0) {
        onChange(parsed);
      }
    };
    reader.readAsText(file);
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer?.files[0];
    if (file) handleFile(file);
  }

  function handleFileInput(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (file) handleFile(file);
  }

  function updateResult(index: number, patch: Partial<ParsedResult>) {
    onChange(results.map((r, i) => i === index ? { ...r, ...patch } : r));
  }

  function removeResult(index: number) {
    onChange(results.filter((_, i) => i !== index));
  }

  function addResult() {
    onChange([...results, { last_name: '', first_name: '' }]);
  }

  return (
    <div class="results-editor">
      <div
        class={`csv-drop-zone ${dragOver ? 'drag-over' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
      >
        <p>Drop a CSV file here or <button type="button" class="btn-link" onClick={() => fileInputRef.current?.click()}>browse</button></p>
        <input ref={fileInputRef} type="file" accept=".csv,.tsv,.txt" onChange={handleFileInput} style="display:none" />
      </div>

      {results.length > 0 && (
        <table class="results-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Last name</th>
              <th>First name</th>
              <th>Time</th>
              <th>Status</th>
              <th>Homol.</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {results.map((r, i) => (
              <tr key={i}>
                <td>
                  <input type="number" value={r.brevet_no ?? ''} class="result-brevet"
                    onInput={(e) => {
                      const val = (e.target as HTMLInputElement).value;
                      updateResult(i, { brevet_no: val ? parseInt(val, 10) : undefined });
                    }} />
                </td>
                <td>
                  <input type="text" value={r.last_name}
                    onInput={(e) => updateResult(i, { last_name: (e.target as HTMLInputElement).value })} />
                </td>
                <td>
                  <input type="text" value={r.first_name || ''}
                    onInput={(e) => updateResult(i, { first_name: (e.target as HTMLInputElement).value || undefined })} />
                </td>
                <td>
                  <input type="text" value={r.time || ''} placeholder="HH:MM:SS"
                    disabled={!!r.status}
                    onInput={(e) => updateResult(i, { time: (e.target as HTMLInputElement).value || undefined })} />
                </td>
                <td>
                  <select value={r.status || ''}
                    onChange={(e) => {
                      const val = (e.target as HTMLSelectElement).value as ParsedResult['status'] | '';
                      updateResult(i, {
                        status: val || undefined,
                        ...(val ? { time: undefined } : {}),
                      });
                    }}>
                    {STATUS_OPTIONS.map(o => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </td>
                <td>
                  <input type="text" value={r.homologation || ''}
                    onInput={(e) => updateResult(i, { homologation: (e.target as HTMLInputElement).value || undefined })} />
                </td>
                <td>
                  <button type="button" class="btn-link btn-danger" onClick={() => removeResult(i)}>×</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <button type="button" class="btn-link" onClick={addResult}>
        Add result
      </button>

      {results.length > 0 && (
        <p class="results-count">{results.length} result{results.length !== 1 ? 's' : ''}</p>
      )}
    </div>
  );
}
